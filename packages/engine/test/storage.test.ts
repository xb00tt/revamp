import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revampPaths } from "../src/paths.ts";
import { removeStorageItem, storageUsage } from "../src/storage.ts";

const PINNED = "a".repeat(64);
const OLD = "b".repeat(64);

/** demo 1.0.0 installed and current, 0.9.0 still installed; downloads of 1.0.0 and 0.8.0; a pinned and an unpinned bundle. */
function setup() {
  const paths = revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-storage-")) });
  const file = (path: string, bytes: number) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, Buffer.alloc(bytes));
  };
  file(join(paths.cache, "releases/demo/1.0.0/demo_1.0.0_amd64.deb"), 100);
  file(join(paths.cache, "releases/demo/0.8.0/demo_0.8.0_amd64.deb"), 80);
  file(join(paths.cache, `bundles/${PINNED}.mjs`), 10);
  file(join(paths.cache, `bundles/${OLD}.mjs`), 9);
  mkdirSync(paths.config, { recursive: true });
  writeFileSync(join(paths.config, "sources.json"), JSON.stringify({ sources: [{ location: "example/bundles", kind: "github", name: "Demo bundle", version: "1.1.0", sha256: PINNED, apps: ["demo"] }] }));
  for (const [version, at] of [["1.0.0", "2026-10-15T02:00:00Z"], ["0.9.0", "2026-10-14T02:00:00Z"]]) {
    file(join(paths.data, `apps/demo/${version}/demo`), 1000);
    writeFileSync(join(paths.data, `apps/demo/${version}/revamp.json`), JSON.stringify({ app: "demo", version, installedAt: at }));
  }
  symlinkSync("1.0.0", join(paths.data, "apps/demo/current"));
  return paths;
}

test("storage lists downloads, bundles and installs with their sizes and why each is kept", () => {
  const paths = setup();
  const receipt = (v: string) => JSON.stringify({ app: "demo", version: v, installedAt: v === "1.0.0" ? "2026-10-15T02:00:00Z" : "2026-10-14T02:00:00Z" }).length;
  assert.deepEqual(
    storageUsage(paths).sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: `bundle:${PINNED}`, kind: "bundle", label: "Demo bundle 1.1.0", bytes: 10, keep: "pinned" },
      { id: `bundle:${OLD}`, kind: "bundle", label: `bundle ${OLD.slice(0, 12)}`, bytes: 9 },
      { id: "install:demo/0.9.0", kind: "install", label: "demo 0.9.0", bytes: 1000 + receipt("0.9.0") },
      { id: "install:demo/1.0.0", kind: "install", label: "demo 1.0.0", bytes: 1000 + receipt("1.0.0"), keep: "current" },
      { id: "release:demo/0.8.0", kind: "release", label: "demo 0.8.0", bytes: 80 },
      { id: "release:demo/1.0.0", kind: "release", label: "demo 1.0.0", bytes: 100, keep: "installed" },
    ],
  );
});

test("only items without a keep reason can be removed", () => {
  const paths = setup();
  for (const id of [`bundle:${OLD}`, "install:demo/0.9.0", "release:demo/0.8.0"]) removeStorageItem(paths, id);
  assert.equal(existsSync(join(paths.cache, `bundles/${OLD}.mjs`)), false);
  assert.equal(existsSync(join(paths.data, "apps/demo/0.9.0")), false);
  assert.equal(existsSync(join(paths.cache, "releases/demo/0.8.0")), false);
  assert.deepEqual(storageUsage(paths).map((i) => i.keep), ["installed", "pinned", "current"]);
  assert.throws(() => removeStorageItem(paths, "install:demo/1.0.0"), /^Error: demo 1\.0\.0 is in use \(current\), so it stays$/);
  assert.throws(() => removeStorageItem(paths, "release:../../etc"), /^Error: nothing called "release:\.\.\/\.\.\/etc" in Revamp's storage$/);
});

test("a download or install isn't removed while a job for its app runs", () => {
  const paths = setup();
  writeFileSync(join(paths.data, "apps/demo/.lock"), String(process.pid)); // a live job's lock
  for (const id of ["install:demo/0.9.0", "release:demo/0.8.0"]) assert.throws(() => removeStorageItem(paths, id), /^Error: another Revamp job for demo is running/);
  assert.deepEqual([existsSync(join(paths.data, "apps/demo/0.9.0")), existsSync(join(paths.cache, "releases/demo/0.8.0"))], [true, true]);
  removeStorageItem(paths, `bundle:${OLD}`); // bundles belong to no app
  assert.equal(existsSync(join(paths.data, "apps/demo/.lock")), true, "the job's lock stays");
});
