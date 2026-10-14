import { gzipSync, zstdCompressSync } from "node:zlib";

type TarOpts = { type?: string; linkname?: string; mode?: number; magic?: "gnu" | "ustar"; prefix?: string; checksum?: "bad" };

function header(name: string, size: number, o: TarOpts): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write((o.mode ?? 0o644).toString(8).padStart(7, "0") + "\0", 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write("        ", 148, "latin1");
  h.write(o.type ?? "0", 156, "latin1");
  h.write(o.linkname ?? "", 157, 100, "utf8");
  if (o.magic === "gnu") h.write("ustar  \0", 257, "latin1");
  else {
    h.write("ustar\0", 257, "latin1");
    h.write("00", 263, "latin1");
    h.write(o.prefix ?? "", 345, 155, "utf8");
  }
  let sum = 0;
  for (const b of h) sum += b;
  if (o.checksum === "bad") sum += 1;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
  return h;
}

export function tarEntry(name: string, body: Buffer | string = "", o: TarOpts = {}): Buffer {
  const data = typeof body === "string" ? Buffer.from(body) : body;
  return Buffer.concat([header(name, data.length, o), data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

export const tarArchive = (entries: Buffer[]) => Buffer.concat([...entries, Buffer.alloc(1024)]);

/** GNU long-name entry; the next entry's own name field is then ignored. */
export const gnuLongName = (name: string) => tarEntry("././@LongLink", name + "\0", { type: "L", magic: "gnu" });

export function paxPath(path: string): Buffer {
  let rec = ` path=${path}\n`;
  let len = rec.length;
  while (`${len}${rec}`.length !== len) len = `${len}${rec}`.length;
  return tarEntry("PaxHeader", `${len}${rec}`, { type: "x" });
}

export function arArchive(members: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from("!<arch>\n", "latin1")];
  for (const m of members) {
    const h = Buffer.alloc(60, 0x20);
    h.write(`${m.name}/`, 0, "latin1");
    h.write("0", 16, "latin1");
    h.write("0", 28, "latin1");
    h.write("0", 34, "latin1");
    h.write("100644", 40, "latin1");
    h.write(String(m.data.length), 48, "latin1");
    h.write("`\n", 58, "latin1");
    parts.push(h, m.data);
    if (m.data.length % 2) parts.push(Buffer.from("\n"));
  }
  return Buffer.concat(parts);
}

export function debFrom(tar: Buffer, compression: "gz" | "zst" | "none"): Buffer {
  const data = compression === "gz" ? gzipSync(tar) : compression === "zst" ? zstdCompressSync(tar) : tar;
  const name = compression === "none" ? "data.tar" : `data.tar.${compression}`;
  return arArchive([
    { name: "debian-binary", data: Buffer.from("2.0\n") },
    { name: "control.tar.gz", data: gzipSync(tarArchive([])) },
    { name, data },
  ]);
}
