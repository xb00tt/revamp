import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedPatchNames, newPatchesToAsk, patchApp, type NewPatchesAnswer, type NewPatchesQuestion, type PatchAppOptions } from "../src/api.ts";
import { loadSelection, type Selection } from "../src/config.ts";
import type { AppInfo, PatchInfo } from "../src/job.ts";
import { revampPaths } from "../src/paths.ts";
import { demoDeb, writeDemoBundle } from "./helpers/demo.ts";

async function setup(bundleOptions: { extra?: string; minEngine?: string } = {}, debExtra: Buffer[] = []) {
  const deb = await demoDeb(debExtra);
  const sha256 = createHash("sha256").update(deb).digest("hex");
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    // 1.0.0 is listed in the bundle; 3.0.0 is not, so only GitHub's API knows its SHA-256.
    if (/^\/example\/demo\/releases\/download\/v([135])\.0\.0\/demo_\1\.0\.0_amd64\.deb$/.test(req.url!)) res.end(deb);
    else if (req.url === "/repos/example/demo/releases/tags/v5.0.0") {
      res.end(JSON.stringify({ assets: [{ name: "demo_5.0.0_amd64.deb", digest: `sha256:${"0".repeat(64)}` }] }));
    } else if (req.url === "/repos/example/demo/releases/tags/v3.0.0") {
      res.end(JSON.stringify({ assets: [{ name: "demo_3.0.0_amd64.deb", digest: `sha256:${sha256}` }] }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-api-"));
  const bundlePath = join(root, "demo.mjs");
  const writeBundle = (o = bundleOptions) => writeDemoBundle(bundlePath, { sha256, ...o });
  writeBundle();
  const paths = revampPaths({ HOME: join(root, "home") });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opts: PatchAppOptions = { appId: "demo", bundlePath, paths, releaseBaseUrl: base, apiBaseUrl: base };
  return { opts, paths, writeBundle, hits: () => hits, close: () => server.close() };
}

const WAVE = `patches.push({ kind: "patch", name: "Wave", description: "Waves.", compatibleWith: [{ app }], execute(ctx) { ctx.log("waving"); } });`;

const patch = (name: string, o: Partial<PatchInfo> = {}): PatchInfo => ({ name, description: "", apps: null, default: true, options: {}, ...o });
const app = { id: "demo", required: ["Req"] } as AppInfo;
const none: Selection = { enable: [], disable: [], options: {} };
const ask = (p: PatchInfo, o: { installed?: string[]; saved?: Selection; flags?: { enable?: string[]; disable?: string[] }; forced?: boolean } = {}) =>
  newPatchesToAsk(app, [p], "1.0.0", o.installed ?? ["Old"], o.saved ?? none, o.flags ?? {}, o.forced ?? false).map((x) => x.name);

test("asks about default-on patches the install never had and nobody answered", () => {
  assert.deepEqual(ask(patch("New")), ["New"]);
  assert.deepEqual(ask(patch("New"), { installed: ["New"] }), []);
  assert.deepEqual(ask(patch("New", { default: false })), []);
  assert.deepEqual(ask(patch("Req")), []);
  assert.deepEqual(ask(patch("New"), { saved: { ...none, enable: ["New"] } }), []);
  assert.deepEqual(ask(patch("New"), { saved: { ...none, disable: ["New"] } }), []);
  assert.deepEqual(ask(patch("New"), { flags: { enable: ["New"] } }), []);
  assert.deepEqual(ask(patch("New"), { flags: { disable: ["New"] } }), []);
  assert.deepEqual(ask(patch("New", { apps: [{ app: "demo", versions: ["2.0.0"] }] })), []);
  assert.deepEqual(ask(patch("New", { apps: [{ app: "demo", versions: ["2.0.0"] }] }), { forced: true }), ["New"]);
});

test("a first install asks nothing", () => {
  assert.deepEqual(newPatchesToAsk(app, [patch("New")], "1.0.0", undefined, none, {}, false), []);
});

async function rePatch(answer: NewPatchesAnswer | "throw", extraOpts: Partial<PatchAppOptions> = {}) {
  const s = await setup();
  const first = await patchApp(s.opts);
  assert.equal(first.exitCode, 0);
  s.writeBundle({ extra: WAVE });
  const questions: NewPatchesQuestion[] = [];
  const confirmNewPatches = async (q: NewPatchesQuestion) => {
    questions.push(q);
    if (answer === "throw") throw new Error("should not ask");
    return answer;
  };
  const r = await patchApp({ ...s.opts, confirmNewPatches, ...extraOpts });
  return { s, r, questions, confirmNewPatches, status: r.results.find((x) => x.name === "Wave")?.status };
}

test("a re-patch asks once, and 'on' turns the patch on and saves it", async (t) => {
  const { s, r, questions, status } = await rePatch("on");
  t.after(s.close);
  assert.deepEqual(questions, [
    { bundle: { name: "Demo bundle", version: "1.0.0" }, appName: "Demo", version: "1.0.0", patches: [{ name: "Wave", description: "Waves." }] },
  ]);
  assert.equal(status, "applied");
  assert.ok(loadSelection(s.paths, "demo").enable.includes("Wave"));
  assert.deepEqual(installedPatchNames(s.paths, "demo")?.includes("Wave"), true);
  const again = await patchApp({ ...s.opts, confirmNewPatches: async () => { throw new Error("asked again"); } });
  assert.equal(again.exitCode, 0);
});

test("'off' keeps it off, saves that, and isn't asked again", async (t) => {
  const { s, status, confirmNewPatches, questions } = await rePatch("off");
  t.after(s.close);
  assert.equal(status, "disabled");
  assert.ok(loadSelection(s.paths, "demo").disable.includes("Wave"));
  await patchApp({ ...s.opts, confirmNewPatches });
  assert.equal(questions.length, 1);
});

test("a failed job saves nothing, so the question comes back", async (t) => {
  const s = await setup();
  t.after(s.close);
  await patchApp(s.opts);
  s.writeBundle({ extra: WAVE });
  const questions: NewPatchesQuestion[] = [];
  const confirmNewPatches = async (q: NewPatchesQuestion) => (questions.push(q), "on" as const);
  // GitHub's SHA-256 for 5.0.0 doesn't match the download, so the job fails after the answer.
  await assert.rejects(patchApp({ ...s.opts, version: "5.0.0", force: true, confirmNewPatches }), /SHA-256 mismatch/);
  assert.deepEqual(loadSelection(s.paths, "demo"), none);
  await patchApp({ ...s.opts, confirmNewPatches });
  assert.equal(questions.length, 2);
});

test("installedPatchNames leaves out receipt entries that were disabled or incompatible", async (t) => {
  const ripple = WAVE.replaceAll("Wave", "Ripple").replace("compatibleWith: [{ app }]", 'compatibleWith: [{ app, versions: ["2.0.0"] }]');
  const s = await setup({ extra: WAVE + ripple });
  t.after(s.close);
  const r = await patchApp({ ...s.opts, disable: ["Wave"] });
  assert.deepEqual(Object.fromEntries(r.results.map((x) => [x.name, x.status])), { "Say goodbye": "applied", Wave: "disabled", Ripple: "incompatible" });
  assert.deepEqual(installedPatchNames(s.paths, "demo"), ["Say goodbye"]);
});

test("'off-this-run' keeps it off without saving", async (t) => {
  const { s, status, confirmNewPatches, questions } = await rePatch("off-this-run");
  t.after(s.close);
  assert.equal(status, "disabled");
  const saved = loadSelection(s.paths, "demo");
  assert.ok(!saved.enable.includes("Wave") && !saved.disable.includes("Wave"));
  await patchApp({ ...s.opts, confirmNewPatches });
  assert.equal(questions.length, 2);
});

test("no callback keeps today's behavior", async (t) => {
  const s = await setup();
  t.after(s.close);
  await patchApp(s.opts);
  s.writeBundle({ extra: WAVE });
  const r = await patchApp(s.opts);
  assert.equal(r.results.find((x) => x.name === "Wave")?.status, "applied");
});

test("a first install never calls the callback", async (t) => {
  const s = await setup({ extra: WAVE });
  t.after(s.close);
  const r = await patchApp({ ...s.opts, confirmNewPatches: async () => { throw new Error("asked"); } });
  assert.equal(r.exitCode, 0);
});

test("flags answer for themselves", async (t) => {
  const { s, status } = await rePatch("throw", { enable: ["Wave"] });
  t.after(s.close);
  assert.equal(status, "applied");
});

test("a forced, unlisted version asks about a new default-on patch marked only for another version", async (t) => {
  const s = await setup();
  t.after(s.close);
  const forced = { ...s.opts, version: "3.0.0", force: true };
  assert.equal((await patchApp(forced)).exitCode, 0);
  s.writeBundle({ extra: WAVE.replace("compatibleWith: [{ app }]", 'compatibleWith: [{ app, versions: ["2.0.0"] }]') });
  const questions: NewPatchesQuestion[] = [];
  await patchApp({ ...forced, confirmNewPatches: async (q) => (questions.push(q), "off-this-run") });
  assert.deepEqual(questions.map((q) => q.patches.map((p) => p.name)), [["Wave"]]);
});
