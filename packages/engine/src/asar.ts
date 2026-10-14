import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

export class AsarError extends Error {}

export interface AsarIntegrity {
  algorithm: "SHA256";
  hash: string;
  blockSize: number;
  blocks: string[];
}

export interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  executable?: boolean;
  link?: string;
  integrity?: AsarIntegrity;
}

export interface AsarArchive {
  path: string;
  header: AsarEntry;
  /** Byte offset where file data starts: 8 + headerSize. */
  dataOffset: number;
}

const BLOCK_SIZE = 4 * 1024 * 1024;

export function readAsar(path: string): AsarArchive {
  const fd = openSync(path, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) !== 16 || prefix.readUInt32LE(0) !== 4) {
      throw new AsarError(`${path} is not an asar archive`);
    }
    const headerSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (jsonLength + 8 > headerSize || 8 + headerSize > fstatSync(fd).size) {
      throw new AsarError(`${path} has a corrupt asar header`);
    }
    const json = Buffer.alloc(jsonLength);
    readFully(fd, json, 16);
    let header: AsarEntry;
    try {
      header = JSON.parse(json.toString("utf8"));
    } catch {
      throw new AsarError(`${path} has a corrupt asar header`);
    }
    validateNames(header);
    return { path, header, dataOffset: 8 + headerSize };
  } finally {
    closeSync(fd);
  }
}

function validateNames(dir: AsarEntry): void {
  for (const [name, entry] of Object.entries(dir.files ?? {})) {
    if (name === "" || name === "." || name === ".." || /[/\\\0]/.test(name)) {
      throw new AsarError(`invalid entry name ${JSON.stringify(name)} in asar header`);
    }
    if (entry.files) validateNames(entry);
  }
}

export function listAsarFiles(a: AsarArchive): string[] {
  const out: string[] = [];
  const walk = (dir: AsarEntry, prefix: string) => {
    for (const [name, entry] of Object.entries(dir.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, path);
      else if (!entry.link) out.push(path);
    }
  };
  walk(a.header, "");
  return out;
}

function lookup(header: AsarEntry, path: string): AsarEntry | undefined {
  let entry: AsarEntry | undefined = header;
  for (const part of path.split("/")) {
    if (!entry?.files || !Object.hasOwn(entry.files, part)) return undefined;
    entry = entry.files[part];
  }
  return entry;
}

export function readAsarFile(a: AsarArchive, path: string): Buffer {
  const entry = lookup(a.header, path);
  if (!entry || entry.files || entry.link) throw new AsarError(`no file "${path}" in ${a.path}`);
  if (entry.unpacked) return readFileSync(join(`${a.path}.unpacked`, ...path.split("/")));
  const buf = Buffer.alloc(entry.size ?? 0);
  const fd = openSync(a.path, "r");
  try {
    readFully(fd, buf, a.dataOffset + Number(entry.offset));
  } finally {
    closeSync(fd);
  }
  return buf;
}

export function integrityOf(data: Buffer): AsarIntegrity {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const blocks: string[] = [];
  for (let off = 0; off < data.length; off += BLOCK_SIZE) blocks.push(sha(data.subarray(off, off + BLOCK_SIZE)));
  if (data.length === 0) blocks.push(sha(data));
  return { algorithm: "SHA256", hash: sha(data), blockSize: BLOCK_SIZE, blocks };
}

/** Paths inside app.asar that come from bundles or sandbox output: plain relative segments only. */
export function assertAsarPath(path: string): string {
  if (path.split("/").some((p) => p === "" || p === "." || p === ".." || /[\\\0]/.test(p))) {
    throw new AsarError(`invalid path inside app.asar: ${JSON.stringify(path)}`);
  }
  return path;
}

/**
 * Writes a new archive: the original data region copied as-is, changed and new files appended,
 * and a rewritten header. Old bytes of replaced files stay behind unused.
 */
export function writeAsar(a: AsarArchive, outPath: string, changes: ReadonlyMap<string, Buffer>): void {
  const header = structuredClone(a.header);
  const src = openSync(a.path, "r");
  try {
    const dataLength = fstatSync(src).size - a.dataOffset;
    let next = dataLength;
    const appended: Buffer[] = [];
    for (const [path, contents] of changes) {
      const entry = fileEntryFor(header, assertAsarPath(path));
      if (entry.unpacked || entry.link) throw new AsarError(`can't replace unpacked or linked entry "${path}"`);
      entry.size = contents.length;
      entry.offset = String(next);
      entry.integrity = integrityOf(contents);
      appended.push(contents);
      next += contents.length;
    }
    const json = Buffer.from(JSON.stringify(header), "utf8");
    const padded = Math.ceil(json.length / 4) * 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(padded + 8, 4);
    prefix.writeUInt32LE(padded + 4, 8);
    prefix.writeUInt32LE(json.length, 12);
    const out = openSync(outPath, "w");
    try {
      writeAll(out, prefix);
      writeAll(out, json);
      writeAll(out, Buffer.alloc(padded - json.length));
      const chunk = Buffer.alloc(8 * 1024 * 1024);
      for (let pos = 0; pos < dataLength; ) {
        const n = readSync(src, chunk, 0, Math.min(chunk.length, dataLength - pos), a.dataOffset + pos);
        if (n === 0) throw new AsarError(`${a.path} ended early`);
        writeAll(out, chunk.subarray(0, n));
        pos += n;
      }
      for (const b of appended) writeAll(out, b);
    } finally {
      closeSync(out);
    }
  } finally {
    closeSync(src);
  }
}

function fileEntryFor(header: AsarEntry, path: string): AsarEntry {
  const parts = path.split("/");
  let dir = header;
  for (const part of parts.slice(0, -1)) {
    dir.files ??= {};
    const existing = Object.hasOwn(dir.files, part) ? dir.files[part] : undefined;
    if (existing && !existing.files) throw new AsarError(`"${path}": "${part}" is a file, not a directory`);
    dir = existing ?? (dir.files[part] = { files: {} });
  }
  dir.files ??= {};
  const name = parts[parts.length - 1];
  const existing = Object.hasOwn(dir.files, name) ? dir.files[name] : undefined;
  if (existing?.files) throw new AsarError(`"${path}" is a directory`);
  return existing ?? (dir.files[name] = {});
}

function readFully(fd: number, buf: Buffer, position: number): void {
  for (let off = 0; off < buf.length; ) {
    const n = readSync(fd, buf, off, buf.length - off, position + off);
    if (n === 0) throw new AsarError("unexpected end of asar archive");
    off += n;
  }
}

function writeAll(fd: number, buf: Buffer): void {
  for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off);
}
