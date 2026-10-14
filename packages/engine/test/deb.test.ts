import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDeb, readArMembers } from "../src/deb.ts";
import { debFrom, gnuLongName, paxPath, tarArchive, tarEntry } from "./helpers/archives.ts";

const FIXTURE = new URL("./fixtures/hello_1.0_all.deb", import.meta.url).pathname;

function setup(deb?: Buffer) {
  const root = mkdtempSync(join(tmpdir(), "revamp-deb-"));
  const out = join(root, "out");
  mkdirSync(out);
  const path = join(root, "x.deb");
  if (deb) writeFileSync(path, deb);
  return { root, out, path };
}
const everything = (p: string) => p;

test("extracts a real dpkg-deb xz package through select()", async () => {
  const { out } = setup();
  const r = await extractDeb(FIXTURE, out, (p) => (p.startsWith("opt/Hello/") ? p.slice("opt/Hello/".length) : null));
  assert.equal(readFileSync(join(out, "hello.txt"), "utf8"), "hello from xz\n");
  assert.equal(readFileSync(join(out, "resources/r.txt"), "utf8"), "resource\n");
  assert.equal(statSync(join(out, "hello")).mode & 0o777, 0o755);
  assert.equal(existsSync(join(out, "usr")), false);
  assert.equal(r.files, 3);
});

test("readArMembers lists the members of a real .deb", () => {
  const names = readArMembers(FIXTURE).map((m) => m.name);
  assert.equal(names[0], "debian-binary");
  assert.ok(names.includes("data.tar.xz"));
});

for (const compression of ["gz", "zst", "none"] as const) {
  test(`extracts ${compression} data, GNU long names, pax paths and ustar prefixes`, async () => {
    const long = `opt/App/${"d".repeat(120)}/file.txt`;
    const tar = tarArchive([
      tarEntry("./opt/App/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/App/a.txt", "A"),
      gnuLongName(`./${long}`),
      tarEntry("./ignored-short-name", "LONG", { magic: "gnu" }),
      paxPath("opt/App/pax.txt"),
      tarEntry("ignored", "PAX"),
      tarEntry("b.txt", "B", { prefix: "opt/App/sub" }),
    ]);
    const { out, path } = setup(debFrom(tar, compression));
    await extractDeb(path, out, everything);
    assert.equal(readFileSync(join(out, "opt/App/a.txt"), "utf8"), "A");
    assert.equal(readFileSync(join(out, long), "utf8"), "LONG");
    assert.equal(readFileSync(join(out, "opt/App/pax.txt"), "utf8"), "PAX");
    assert.equal(readFileSync(join(out, "opt/App/sub/b.txt"), "utf8"), "B");
  });
}

test("keeps in-tree symlinks and hardlinks, strips setuid bits", async () => {
  const tar = tarArchive([
    tarEntry("app/real.txt", "R", { mode: 0o4755 }),
    tarEntry("app/link", "", { type: "2", linkname: "real.txt" }),
    tarEntry("app/hard", "", { type: "1", linkname: "app/real.txt" }),
  ]);
  const { out, path } = setup(debFrom(tar, "gz"));
  const r = await extractDeb(path, out, everything);
  assert.equal(statSync(join(out, "app/real.txt")).mode & 0o7777, 0o755);
  assert.equal(readlinkSync(join(out, "app/link")), "real.txt");
  assert.equal(readFileSync(join(out, "app/hard"), "utf8"), "R");
  assert.deepEqual([r.symlinks, r.hardlinks], [1, 1]);
});

const hostile: Array<[string, Buffer[], RegExp]> = [
  ["dot-dot paths", [tarEntry("app/../../evil.txt", "x")], /\.\./],
  ["absolute paths", [tarEntry("/tmp/evil.txt", "x")], /absolute/],
  ["symlinks out of the tree", [tarEntry("app/l", "", { type: "2", linkname: "../../../etc" })], /outside/],
  ["absolute symlinks", [tarEntry("app/l", "", { type: "2", linkname: "/etc/passwd" })], /outside|absolute/],
  [
    // Each link looks in-tree lexically, but app/a/b really resolves through app/a and lands outside out/.
    "writes through symlink chains",
    [
      tarEntry("app/a", "", { type: "2", linkname: "." }),
      tarEntry("app/a/b", "", { type: "2", linkname: "../.." }),
      tarEntry("app/a/b/evil.txt", "x"),
    ],
    /inside a symlink/,
  ],
  ["device nodes", [tarEntry("app/dev", "", { type: "3" })], /unsupported tar entry type/],
  ["duplicate paths", [tarEntry("app/a", "1"), tarEntry("app/a", "2")], /duplicate/],
  ["bad checksums", [tarEntry("app/a", "1", { checksum: "bad" })], /checksum/],
  ["hardlinks to unknown files", [tarEntry("app/h", "", { type: "1", linkname: "app/missing" })], /hardlink/],
];
for (const [label, entries, error] of hostile) {
  test(`rejects ${label}`, async () => {
    const { root, out, path } = setup(debFrom(tarArchive(entries), "gz"));
    await assert.rejects(extractDeb(path, out, everything), error);
    assert.equal(existsSync(join(root, "evil.txt")), false);
  });
}

test("rejects files that are not ar archives or have no data member", async () => {
  const { out, path } = setup(Buffer.from("not an archive at all, just text\n"));
  await assert.rejects(extractDeb(path, out, everything), /not an ar archive/);
  const empty = setup(debFrom(tarArchive([]), "gz").subarray(0, 8));
  await assert.rejects(extractDeb(empty.path, empty.out, everything), /no data\.tar/);
});

test("skipped entries are never written", async () => {
  const { out, path } = setup(debFrom(tarArchive([tarEntry("keep.txt", "k"), tarEntry("skip.txt", "s")]), "gz"));
  await extractDeb(path, out, (p) => (p === "keep.txt" ? p : null));
  assert.equal(existsSync(join(out, "keep.txt")), true);
  assert.equal(existsSync(join(out, "skip.txt")), false);
  assert.equal(lstatSync(out).isDirectory(), true);
});
