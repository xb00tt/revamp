import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackageWithOptions, extractFile, getRawHeader } from "@electron/asar";
import { integrityOf, listAsarFiles, readAsar, readAsarFile, writeAsar } from "../src/asar.ts";

async function makeArchive() {
  const root = mkdtempSync(join(tmpdir(), "revamp-asar-"));
  const src = join(root, "src");
  mkdirSync(join(src, "dir"), { recursive: true });
  mkdirSync(join(src, "native"));
  writeFileSync(join(src, "a.txt"), "alpha");
  writeFileSync(join(src, "empty.txt"), "");
  writeFileSync(join(src, "dir/b.js"), "console.log('b')\n");
  writeFileSync(join(src, "native/x.node"), "binary");
  writeFileSync(join(src, "big.bin"), Buffer.alloc(5 * 1024 * 1024 + 7, 1));
  const archive = join(root, "app.asar");
  await createPackageWithOptions(src, archive, { unpack: "*.node" });
  return { root, src, archive };
}

test("lists and reads files, including unpacked ones", async () => {
  const { src, archive } = await makeArchive();
  const a = readAsar(archive);
  assert.deepEqual(listAsarFiles(a).sort(), ["a.txt", "big.bin", "dir/b.js", "empty.txt", "native/x.node"]);
  for (const f of listAsarFiles(a)) assert.deepEqual(readAsarFile(a, f), readFileSync(join(src, f)), f);
});

test("integrityOf matches @electron/asar for empty, small and multi-block files", async () => {
  const { src, archive } = await makeArchive();
  const files = getRawHeader(archive).header.files as Record<string, any>;
  for (const name of ["a.txt", "empty.txt", "big.bin"]) {
    assert.deepEqual(integrityOf(readFileSync(join(src, name))), files[name].integrity, name);
  }
});

test("writeAsar replaces and adds files and keeps the rest byte-identical", async () => {
  const { root, src, archive } = await makeArchive();
  const out = join(root, "new.asar");
  cpSync(`${archive}.unpacked`, `${out}.unpacked`, { recursive: true });
  const changed = Buffer.from("console.log('changed')\n");
  writeAsar(readAsar(archive), out, new Map([["dir/b.js", changed], ["new/deep/c.js", Buffer.from("added")]]));
  assert.deepEqual(extractFile(out, "dir/b.js"), changed);
  assert.equal(extractFile(out, "new/deep/c.js").toString(), "added");
  assert.deepEqual(extractFile(out, "big.bin"), readFileSync(join(src, "big.bin")));
  assert.equal(extractFile(out, "a.txt").toString(), "alpha");
  assert.equal(extractFile(out, "native/x.node").toString(), "binary");
  const header = getRawHeader(out).header as any;
  assert.deepEqual(header.files.dir.files["b.js"].integrity, integrityOf(changed));
  assert.ok(listAsarFiles(readAsar(out)).includes("new/deep/c.js"));
});

test("writeAsar refuses unsafe paths, directories, files-as-dirs and unpacked entries", async () => {
  const { root, archive } = await makeArchive();
  const a = readAsar(archive);
  const out = join(root, "bad.asar");
  const buf = Buffer.from("x");
  assert.throws(() => writeAsar(a, out, new Map([["../evil.js", buf]])), /invalid path/);
  assert.throws(() => writeAsar(a, out, new Map([["dir", buf]])), /is a directory/);
  assert.throws(() => writeAsar(a, out, new Map([["a.txt/x", buf]])), /is a file/);
  assert.throws(() => writeAsar(a, out, new Map([["native/x.node", buf]])), /unpacked/);
});

test("readAsar rejects non-asar files and hostile entry names", () => {
  const root = mkdtempSync(join(tmpdir(), "revamp-asar-"));
  writeFileSync(join(root, "text.asar"), "definitely not an asar archive");
  assert.throws(() => readAsar(join(root, "text.asar")), /not an asar archive|corrupt/);
  const json = Buffer.from(JSON.stringify({ files: { "..": { size: 0, offset: "0" } } }));
  const padded = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(padded + 8, 4);
  prefix.writeUInt32LE(padded + 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  writeFileSync(join(root, "evil.asar"), Buffer.concat([prefix, json, Buffer.alloc(padded - json.length)]));
  assert.throws(() => readAsar(join(root, "evil.asar")), /invalid entry name/);
});
