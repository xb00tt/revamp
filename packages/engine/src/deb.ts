import { closeSync, createReadStream, fstatSync, linkSync, mkdirSync, openSync, readSync, symlinkSync, writeSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip, createZstdDecompress } from "node:zlib";
import xz from "xz-decompress"; // CommonJS/UMD: only the default export exists at runtime

export class DebError extends Error {}

export interface ArMember {
  name: string;
  offset: number;
  size: number;
}

export function readArMembers(path: string): ArMember[] {
  const fd = openSync(path, "r");
  try {
    const total = fstatSync(fd).size;
    const magic = Buffer.alloc(8);
    readSync(fd, magic, 0, 8, 0);
    if (magic.toString("latin1") !== "!<arch>\n") throw new DebError(`${path} is not an ar archive (bad magic)`);
    const members: ArMember[] = [];
    const header = Buffer.alloc(60);
    let pos = 8;
    while (pos + 60 <= total) {
      readSync(fd, header, 0, 60, pos);
      if (header.toString("latin1", 58, 60) !== "`\n") throw new DebError(`corrupt ar header at offset ${pos}`);
      const name = header.toString("latin1", 0, 16).trimEnd().replace(/\/$/, "");
      const size = Number.parseInt(header.toString("latin1", 48, 58).trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0 || pos + 60 + size > total) {
        throw new DebError(`bad ar member size for "${name}"`);
      }
      members.push({ name, offset: pos + 60, size });
      pos += 60 + size + (size % 2);
    }
    return members;
  } finally {
    closeSync(fd);
  }
}

function dataStream(path: string, m: ArMember): AsyncIterable<Uint8Array> {
  const raw = createReadStream(path, { start: m.offset, end: m.offset + m.size - 1 });
  const through = (t: NodeJS.ReadWriteStream) => {
    raw.on("error", (e) => (t as unknown as Readable).destroy(e));
    return raw.pipe(t) as unknown as AsyncIterable<Uint8Array>;
  };
  if (m.name === "data.tar") return raw;
  if (m.name === "data.tar.gz") return through(createGunzip());
  if (m.name === "data.tar.zst") return through(createZstdDecompress());
  const web = Readable.toWeb(raw) as unknown as ReadableStream<Uint8Array>;
  return new xz.XzReadableStream(web) as unknown as WebReadableStream<Uint8Array>;
}

export interface ExtractResult {
  files: number;
  dirs: number;
  symlinks: number;
  hardlinks: number;
}

/** Streams data.tar.* out of a .deb into outDir. Never executes anything and never writes outside outDir. */
export async function extractDeb(
  debPath: string,
  outDir: string,
  select: (archivePath: string) => string | null,
): Promise<ExtractResult> {
  const member = readArMembers(debPath).find((m) => /^data\.tar(\.(gz|xz|zst))?$/.test(m.name));
  if (!member) throw new DebError(`${debPath} has no data.tar member`);
  const tar = new TarExtractor(resolve(outDir), select);
  for await (const chunk of dataStream(debPath, member)) {
    tar.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  tar.end();
  return tar.result;
}

const BLOCK = 512;
const META_LIMIT = 1 << 20; // long names and pax records larger than 1 MiB are hostile

type Body =
  | { kind: "skip" }
  | { kind: "file"; fd: number; dest: string; mode: number }
  | { kind: "meta"; type: "L" | "K" | "x"; chunks: Buffer[]; length: number };

class TarExtractor {
  result: ExtractResult = { files: 0, dirs: 0, symlinks: 0, hardlinks: 0 };
  private header = Buffer.alloc(BLOCK);
  private headerFill = 0;
  private body: Body | undefined;
  private bodyLeft = 0;
  private padLeft = 0;
  private done = false;
  private longName: string | undefined;
  private longLink: string | undefined;
  private pax: Record<string, string> = {};
  private seen = new Set<string>();
  /** archive path → extracted destination, for hardlinks */
  private extracted = new Map<string, string>();
  /** Output-relative paths of symlinks this archive created; nothing may be written below them. */
  private symlinks = new Set<string>();
  private readonly rootDir: string;
  private readonly select: (archivePath: string) => string | null;

  constructor(rootDir: string, select: (archivePath: string) => string | null) {
    this.rootDir = rootDir;
    this.select = select;
  }

  write(chunk: Buffer): void {
    let off = 0;
    while (off < chunk.length && !this.done) {
      if (this.bodyLeft > 0) {
        const n = Math.min(this.bodyLeft, chunk.length - off);
        this.consume(chunk.subarray(off, off + n));
        off += n;
        this.bodyLeft -= n;
        if (this.bodyLeft === 0) this.finishBody();
      } else if (this.padLeft > 0) {
        const n = Math.min(this.padLeft, chunk.length - off);
        off += n;
        this.padLeft -= n;
      } else {
        const n = Math.min(BLOCK - this.headerFill, chunk.length - off);
        chunk.copy(this.header, this.headerFill, off, off + n);
        this.headerFill += n;
        off += n;
        if (this.headerFill === BLOCK) {
          this.headerFill = 0;
          this.onHeader(this.header);
        }
      }
    }
  }

  end(): void {
    if (this.bodyLeft > 0 || this.headerFill > 0) throw new DebError("tar stream ended in the middle of an entry");
  }

  private onHeader(h: Buffer): void {
    if (h.every((b) => b === 0)) {
      this.done = true;
      return;
    }
    verifyChecksum(h);
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
    let size = parseSize(h.subarray(124, 136));
    const magic = h.toString("latin1", 257, 263);
    let name = cstring(h, 0, 100);
    if (magic === "ustar\0") {
      const prefix = cstring(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (type === "L" || type === "K" || type === "x" || type === "g") {
      if (size > META_LIMIT) throw new DebError(`oversized tar metadata entry (${size} bytes)`);
      this.startBody(type === "g" ? { kind: "skip" } : { kind: "meta", type, chunks: [], length: 0 }, size);
      return;
    }
    const path = safeArchivePath(this.pax.path ?? this.longName ?? name);
    const link = this.pax.linkpath ?? this.longLink ?? cstring(h, 157, 100);
    if (this.pax.size !== undefined) size = Number(this.pax.size);
    this.longName = this.longLink = undefined;
    this.pax = {};
    const mode = parseOctal(h.subarray(100, 108)) & 0o777; // drops setuid/setgid/sticky

    if (type === "5") {
      const rel = path === "" ? null : this.select(path);
      if (rel !== null) {
        mkdirSync(this.dest(rel), { recursive: true, mode: 0o755 });
        this.result.dirs++;
      }
      this.startBody({ kind: "skip" }, size);
      return;
    }
    if (type !== "0" && type !== "7" && type !== "1" && type !== "2") {
      throw new DebError(`unsupported tar entry type "${type}" for ${path}`);
    }
    if (this.seen.has(path)) throw new DebError(`duplicate path in archive: ${path}`);
    this.seen.add(path);
    const rel = this.select(path);
    if (rel === null) {
      this.startBody({ kind: "skip" }, size);
      return;
    }
    const dest = this.dest(rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (type === "2") {
      if (isAbsolute(link)) throw new DebError(`absolute symlink ${path} -> ${link} points outside the archive`);
      this.checkLinkTarget(relKey(rel), link, path);
      symlinkSync(link, dest);
      this.symlinks.add(relKey(rel));
      this.result.symlinks++;
      this.startBody({ kind: "skip" }, size);
    } else if (type === "1") {
      const target = this.extracted.get(safeArchivePath(link));
      if (!target) throw new DebError(`hardlink ${path} -> ${link} targets a file that was not extracted`);
      linkSync(target, dest);
      this.result.hardlinks++;
      this.startBody({ kind: "skip" }, size);
    } else {
      this.extracted.set(path, dest);
      this.startBody({ kind: "file", fd: openSync(dest, "wx", 0o600), dest, mode }, size);
    }
  }

  private startBody(body: Body, size: number): void {
    this.body = body;
    this.bodyLeft = size;
    this.padLeft = (BLOCK - (size % BLOCK)) % BLOCK;
    if (size === 0) this.finishBody();
  }

  private consume(data: Buffer): void {
    const b = this.body!;
    if (b.kind === "file") writeSync(b.fd, data);
    else if (b.kind === "meta") {
      b.chunks.push(Buffer.from(data));
      b.length += data.length;
    }
  }

  private finishBody(): void {
    const b = this.body!;
    this.body = undefined;
    if (b.kind === "file") {
      closeSync(b.fd);
      chmodSync(b.dest, b.mode);
      this.result.files++;
    } else if (b.kind === "meta") {
      const data = Buffer.concat(b.chunks, b.length);
      if (b.type === "L") this.longName = cstring(data, 0, data.length);
      else if (b.type === "K") this.longLink = cstring(data, 0, data.length);
      else this.pax = parsePax(data);
    }
  }

  /**
   * Walks a relative symlink target one segment at a time, the way the kernel will. It must stay inside the
   * output directory and must not pass through another archive symlink (where ".." would mean something else).
   */
  private checkLinkTarget(rel: string, link: string, path: string): void {
    const parts = rel.split("/").slice(0, -1);
    const segments = link.split("/").filter((s) => s !== "" && s !== ".");
    segments.forEach((segment, i) => {
      if (segment === "..") {
        if (parts.length === 0) throw new DebError(`symlink ${path} -> ${link} points outside the archive`);
        parts.pop();
        return;
      }
      parts.push(segment);
      if (i < segments.length - 1 && this.symlinks.has(parts.join("/"))) {
        throw new DebError(`symlink ${path} -> ${link} passes through another symlink (${parts.join("/")})`);
      }
    });
  }

  private dest(rel: string): string {
    // Symlink targets are checked lexically, which is only sound if no path goes *through* a symlink:
    // a chain like a -> . then a/b -> ../.. looks in-tree but escapes. So symlinks may only be leaves.
    const parts = relKey(rel).split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (this.symlinks.has(parent)) throw new DebError(`refusing to write ${rel}: it is inside a symlink (${parent}) from the archive`);
    }
    const d = resolve(this.rootDir, rel);
    if (!this.inside(d)) throw new DebError(`refusing to write outside the output directory: ${rel}`);
    return d;
  }

  private inside(p: string): boolean {
    return p === this.rootDir || p.startsWith(this.rootDir + sep);
  }
}

const relKey = (rel: string) => rel.split("/").filter((s) => s !== "" && s !== ".").join("/");

/** Normalizes "./a/b/" to "a/b" and rejects absolute paths, ".." segments and NUL bytes. */
function safeArchivePath(raw: string): string {
  if (raw.includes("\0")) throw new DebError(`NUL byte in archive path ${JSON.stringify(raw)}`);
  if (raw.startsWith("/")) throw new DebError(`absolute path in archive: ${raw}`);
  const parts = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) throw new DebError(`".." in archive path: ${raw}`);
  return parts.join("/");
}

function cstring(buf: Buffer, start: number, length: number): string {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end === -1 || end > start + length ? start + length : end);
}

function parseOctal(field: Buffer): number {
  const s = field.toString("latin1").replace(/[\0 ]+$/g, "").trim();
  return s === "" ? 0 : Number.parseInt(s, 8);
}

function parseSize(field: Buffer): number {
  if (field[0] & 0x80) {
    // GNU base-256 encoding for sizes ≥ 8 GiB
    let n = field[0] & 0x7f;
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i];
    return n;
  }
  const n = parseOctal(field);
  if (!Number.isSafeInteger(n) || n < 0) throw new DebError("bad tar entry size");
  return n;
}

function verifyChecksum(h: Buffer): void {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  if (sum !== parseOctal(h.subarray(148, 156))) throw new DebError("tar header checksum mismatch");
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    const len = Number.parseInt(data.toString("latin1", pos, space), 10);
    if (space === -1 || !Number.isSafeInteger(len) || len <= 0) throw new DebError("malformed pax header");
    const rec = data.toString("utf8", space + 1, pos + len - 1); // drop trailing "\n"
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    pos += len;
  }
  return out;
}
