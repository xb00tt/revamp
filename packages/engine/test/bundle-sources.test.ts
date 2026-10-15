import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSource, bundleForApp, loadSources, prepareSource, refreshSources, removeSource, sourceKind, type SourceFetchOptions } from "../src/bundle-sources.ts";
import { revampPaths } from "../src/paths.ts";
import { writeDemoBundle } from "./helpers/demo.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A fake GitHub: raw.githubusercontent.com under /raw, the API under /api, release downloads under /dl. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "revamp-sources-"));
  const bundleBytes = (version: string) => {
    const file = join(root, `demo-${version}.mjs`);
    writeDemoBundle(file, { sha256: "a".repeat(64), version });
    return readFileSync(file);
  };
  const downloads = new Map<string, Buffer>();
  const state = { rawStatus: 200, apiStatus: 200, bundleJson: {} as Record<string, unknown>, requests: [] as string[] };
  const server = createServer((req, res) => {
    state.requests.push(req.url!);
    const send = (status: number, body: string | Buffer) => {
      res.statusCode = status;
      res.end(body);
    };
    if (req.url === "/raw/example/bundles/HEAD/bundle.json" || req.url === "/url/bundle.json") send(state.rawStatus, JSON.stringify(state.bundleJson));
    else if (req.url === "/api/repos/example/bundles/contents/bundle.json") {
      assert.equal(req.headers.accept, "application/vnd.github.raw+json");
      send(state.apiStatus, JSON.stringify(state.bundleJson));
    } else if (downloads.has(req.url!)) send(200, downloads.get(req.url!)!);
    else send(404, "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** Publishes a version: its bytes at /dl/demo-<version>.mjs and a bundle.json pointing at them. */
  const publish = (version: string, changelog = "", bytes = bundleBytes(version)) => {
    downloads.set(`/dl/demo-${version}.mjs`, bytes);
    state.bundleJson = { name: "Demo bundle", version, minEngine: "0.1.0", created_at: "2026-10-15T00:00:00.000Z", changelog, download_url: `${base}/dl/demo-${version}.mjs`, sha256: sha(bytes) };
    return sha(bytes);
  };
  const paths = revampPaths({ HOME: join(root, "home") });
  const o: SourceFetchOptions = { rawBaseUrl: `${base}/raw`, apiBaseUrl: `${base}/api` };
  return { root, base, paths, o, state, publish, bundleBytes, close: () => server.close() };
}

test("sourceKind tells repos, bundle.json URLs and files apart", () => {
  assert.equal(sourceKind("xb00tt/revamp"), "github");
  assert.equal(sourceKind("https://example.com/bundle.json"), "url");
  assert.equal(sourceKind("./dist/official.mjs"), "file");
  assert.equal(sourceKind("/abs/official.mjs"), "file");
  for (const bad of ["revamp", "../x", "a/b/c", "a/.."]) assert.throws(() => sourceKind(bad), /is not a bundle source/, bad);
});

test("a GitHub source is fetched from the default branch, verified, described and pinned", async (t) => {
  const s = await setup();
  t.after(s.close);
  const pin = s.publish("1.0.0", "First.");
  const c = await prepareSource(s.paths, "example/bundles", s.o);
  assert.deepEqual(c.source, {
    location: "example/bundles",
    kind: "github",
    name: "Demo bundle",
    version: "1.0.0",
    sha256: pin,
    downloadUrl: `${s.base}/dl/demo-1.0.0.mjs`,
    apps: ["demo"],
    changelog: "First.",
  });
  assert.equal(c.changelog, "First.");
  assert.equal(c.description.manifest.name, "Demo bundle");
  assert.equal(c.bundlePath, join(s.paths.cache, "bundles", `${pin}.mjs`));
  assert.deepEqual(loadSources(s.paths), [], "nothing is saved before the user confirms");

  addSource(s.paths, c.source);
  assert.deepEqual(loadSources(s.paths), [c.source]);
  assert.throws(() => addSource(s.paths, c.source), /example\/bundles is already a source/);
  assert.equal((await bundleForApp(s.paths, "demo", s.o))?.bundlePath, c.bundlePath);
  assert.equal(await bundleForApp(s.paths, "other", s.o), undefined);

  // A cleared cache is filled again from the pinned download, checked against the pin.
  rmSync(c.bundlePath);
  assert.deepEqual(await bundleForApp(s.paths, "demo", s.o), { bundlePath: c.bundlePath, source: c.source, warnings: [] });

  assert.deepEqual(removeSource(s.paths, "example/bundles"), c.source);
  assert.deepEqual(loadSources(s.paths), []);
  assert.throws(() => removeSource(s.paths, "example/bundles"), /example\/bundles is not a source/);
});

test("bundle.json comes from the GitHub API when raw.githubusercontent.com fails", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  s.state.rawStatus = 503;
  assert.equal((await prepareSource(s.paths, "example/bundles", s.o)).source.version, "1.0.0");
  s.state.apiStatus = 404;
  await assert.rejects(
    prepareSource(s.paths, "example/bundles", s.o),
    /^Error: couldn't fetch bundle\.json from example\/bundles \(raw\.githubusercontent\.com: HTTP 503; GitHub API: HTTP 404\)$/,
  );
});

test("a bundle that doesn't match its bundle.json is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0", "", s.bundleBytes("1.0.0"));
  s.state.bundleJson.sha256 = "b".repeat(64);
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /SHA-256 mismatch/);
  s.publish("1.0.0", "", s.bundleBytes("1.2.0"));
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /bundle\.json describes "Demo bundle" 1\.0\.0, but the bundle is "Demo bundle" 1\.2\.0/);
  s.state.bundleJson.download_url = "http://example.com/demo.mjs";
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /download_url "http:\/\/example\.com\/demo\.mjs" must use https/);
  await assert.rejects(prepareSource(s.paths, "http://example.com/bundle.json", s.o), /bundle\.json URL "http:\/\/example\.com\/bundle\.json" must use https/);
  assert.deepEqual(loadSources(s.paths), []);
});

test("refresh moves a GitHub pin to a new version; URL and file sources keep theirs", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const url = (await prepareSource(s.paths, `${s.base}/url/bundle.json`, s.o)).source;
  addSource(s.paths, url);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64), version: "0.9.0" });
  const local = (await prepareSource(s.paths, file, s.o)).source;
  assert.deepEqual([local.location, local.kind, local.version, local.downloadUrl], [file, "file", "0.9.0", undefined]);
  addSource(s.paths, local);

  const pin = s.publish("1.1.0", "Second.");
  assert.deepEqual(await refreshSources(s.paths, s.o), ['example/bundles: "Demo bundle" 1.0.0 → 1.1.0\nSecond.']);
  assert.deepEqual(loadSources(s.paths).map((x) => [x.kind, x.version, x.sha256 === pin]), [
    ["github", "1.1.0", true],
    ["url", "1.0.0", false],
    ["file", "0.9.0", false],
  ]);
  assert.deepEqual(await refreshSources(s.paths, s.o), []);

  s.state.rawStatus = s.state.apiStatus = 500;
  assert.deepEqual(await refreshSources(s.paths, s.o), [
    "example/bundles: not refreshed, still using 1.1.0: couldn't fetch bundle.json from example/bundles (raw.githubusercontent.com: HTTP 500; GitHub API: HTTP 500)",
  ]);
});

test("the first source with an app wins, and a changed file source is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64) });
  const local = (await prepareSource(s.paths, file, s.o)).source;
  addSource(s.paths, local);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const choice = await bundleForApp(s.paths, "demo", s.o);
  assert.equal(choice?.source.location, file);
  assert.deepEqual(choice?.warnings, [`"demo" is in 2 bundle sources (${file}, example/bundles); using ${file}`]);

  // The cache is refilled from the file only while the file still has the pinned hash.
  rmSync(choice!.bundlePath);
  assert.equal((await bundleForApp(s.paths, "demo", s.o))?.bundlePath, choice!.bundlePath);
  writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
  rmSync(choice!.bundlePath);
  await assert.rejects(bundleForApp(s.paths, "demo", s.o), new RegExp(`${file} changed since it was added as a source`));
  assert.equal(existsSync(choice!.bundlePath), false);
});

test("a file source whose original was edited or deleted still uses the pinned copy, with a warning", async (t) => {
  const s = await setup();
  t.after(s.close);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64) });
  addSource(s.paths, (await prepareSource(s.paths, file, s.o)).source);
  assert.deepEqual((await bundleForApp(s.paths, "demo", s.o))?.warnings, []);
  const note = `${file} changed since it was added; still using the pinned copy (revamp sources remove, then add, to trust the new file)`;
  writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
  assert.deepEqual((await bundleForApp(s.paths, "demo", s.o))?.warnings, [note]);
  rmSync(file);
  assert.deepEqual((await bundleForApp(s.paths, "demo", s.o))?.warnings, [note]);
});

test("a source added or removed while a refresh fetches survives the moved pin", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const url = (await prepareSource(s.paths, `${s.base}/url/bundle.json`, s.o)).source;
  addSource(s.paths, url);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64), version: "0.9.0" });
  const local = (await prepareSource(s.paths, file, s.o)).source;
  s.publish("1.1.0");
  const refresh = refreshSources(s.paths, s.o); // has read the list and is now fetching
  removeSource(s.paths, url.location);
  addSource(s.paths, local);
  assert.equal((await refresh).length, 1);
  assert.deepEqual(loadSources(s.paths).map((x) => [x.kind, x.version]), [["github", "1.1.0"], ["file", "0.9.0"]]);
});

test("a refresh with nothing new doesn't rewrite sources.json", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const file = join(s.paths.config, "sources.json");
  const before = readFileSync(file, "utf8");
  // a concurrent `sources remove` that lands while the refresh runs must survive it
  rmSync(file);
  assert.deepEqual(await refreshSources(s.paths, s.o), []);
  assert.equal(existsSync(file), false);
  writeFileSync(file, before);
});
