import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppCheck } from "@revamp/engine";
import { type AppRow, type AppsList, badgeFor, checkFor, finishJob, formatBytes, initialToggles, jobEvent, optionFlags, type PatchRow, patchName, pendingUpdates, plain, progressLabel, reclaimable, releaseNote, selectionFlags, startJob } from "../src/model.ts";

const app = (appId: string, current: string | null): AppRow => ({ appId, name: appId, current, versions: [] });
const check = (appId: string, status: AppCheck["status"], latest = "1.1.0"): AppCheck => ({ appId, appName: appId, current: "1.0.0", latest, status });

test("badges tell a new release from new patches, a skip, a failure and nothing to do", () => {
  assert.deepEqual(badgeFor(app("a", null), undefined), { kind: "new", label: "Not installed" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), undefined), { kind: "ok", label: "1.0.0" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), check("a", "update")), { kind: "release", label: "1.1.0 out" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), check("a", "patches", "1.0.0")), { kind: "patches", label: "New patches" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), check("a", "skipped")), { kind: "skipped", label: "Skipped 1.1.0" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), check("a", "failed")), { kind: "failed", label: "Check failed" });
  assert.deepEqual(badgeFor(app("a", "1.0.0"), check("a", "up to date", "1.0.0")), { kind: "ok", label: "Up to date" });
  // A check from before the app was updated says nothing about the version installed now.
  assert.deepEqual(badgeFor(app("a", "1.1.0"), check("a", "update")), { kind: "ok", label: "1.1.0" });

  const list: AppsList = {
    apps: [app("a", "1.0.0"), app("b", "1.0.0"), app("c", "1.0.0"), app("d", null)],
    lastCheck: { checkedAt: "", sources: [], apps: [check("a", "update"), check("b", "patches"), check("c", "skipped")] },
    skipped: { c: "1.1.0" },
  };
  assert.deepEqual(pendingUpdates(list), ["a", "b"]);
});

const patch = (name: string, extra: Partial<PatchRow> = {}): PatchRow => ({ name, description: "", default: true, required: false, compatible: true, options: {}, ...extra });

test("toggles start from required, then saved choices, then defaults, and become enable/disable lists", () => {
  const patches = [patch("Req", { required: true }), patch("On"), patch("Off", { default: false }), patch("Saved off"), patch("Other version", { compatible: false })];
  const toggles = initialToggles(patches, { enable: [], disable: ["Saved off"], options: {} });
  assert.deepEqual(toggles, { Req: true, On: true, Off: false, "Saved off": false });
  assert.deepEqual(selectionFlags(patches, { ...toggles, Off: true }), { enable: ["On", "Off"], disable: ["Saved off"] });
});

test("only changed option values become --option strings", () => {
  const p = patch("Side-by-side identity", { options: { claimLinks: { type: "bool", title: "", description: "", default: true } } });
  assert.deepEqual(optionFlags([p], { "Side-by-side identity": { claimLinks: true } }), []);
  assert.deepEqual(optionFlags([p], { "Side-by-side identity": { claimLinks: false, gone: 1 } }), ["Side-by-side identity:claimLinks=false"]);
});

test("progress labels, sizes and what storage can free", () => {
  assert.equal(progressLabel({ step: "download", percent: 42 }), "Downloading 42%");
  assert.equal(progressLabel({ step: "download" }), "Downloading…");
  assert.equal(progressLabel({ step: "patch", patch: "More like this ranking", index: 5, total: 11 }), "Patching: More like this ranking (5/11)");
  assert.equal(progressLabel({ step: "patch", patch: "(internal patch #7: Hydra extension loader)", index: 7, total: 12 }), "Patching: Hydra extension loader (helper) (7/12)");
  assert.deepEqual(["(internal patch #3)", "(internal patch #9: registry: game data)", "Use the bundled UI"].map(patchName), ["helper #3", "registry: game data (helper)", "Use the bundled UI"]);
  assert.equal(progressLabel({ step: "repack" }), "Repacking…");
  assert.deepEqual([formatBytes(900), formatBytes(48 * 1024), formatBytes(147 * 1024 ** 2), formatBytes(1.07 * 1024 ** 3)], ["900 B", "48 KB", "147 MB", "1.1 GB"]);
  assert.equal(reclaimable([{ id: "a", kind: "release", label: "", bytes: 5 }, { id: "b", kind: "bundle", label: "", bytes: 7, keep: "pinned" }, { id: "c", kind: "install", label: "", bytes: 3 }]), 8);
});

test("a check only counts for the version it was made against", () => {
  const list: AppsList = { apps: [app("a", "1.1.0"), app("b", "1.0.0")], lastCheck: { checkedAt: "", sources: [], apps: [check("a", "update"), check("b", "update")] }, skipped: {} };
  assert.equal(checkFor(list, "a"), undefined);
  assert.equal(checkFor(list, "b")?.status, "update");
});

test("plain() drops what could spoof bundle text and keeps newlines", () => {
  assert.equal(plain("Tr\u202Eust\u200B\u0007 me\u2028\u0085\u007F\u2066\uFEFF!\n\tok"), "Trust me!\n\tok");
});

const ver = (version: string, installedAt: string) => ({ version, installedAt, bundle: { name: "b", version: "1" }, untested: false });
const listWith = (a: AppRow, c: AppCheck, skipped: Record<string, string>, checkedAt = "2026-01-02T00:00:00Z"): AppsList => ({ apps: [a], lastCheck: { checkedAt, sources: [], apps: [c] }, skipped });

test("a skip made after the check turns the update into a skipped release, and undoing it brings the update back", () => {
  const a = app("a", "1.0.0");
  const skipped = listWith(a, check("a", "update"), { a: "1.1.0" });
  assert.equal(checkFor(skipped, "a")?.status, "skipped");
  assert.equal(skipped.lastCheck!.apps[0].status, "update"); // a copy, not a mutation
  assert.deepEqual(badgeFor(a, checkFor(skipped, "a")), { kind: "skipped", label: "Skipped 1.1.0" });
  assert.deepEqual(pendingUpdates(skipped), []);
  const undone = listWith(a, check("a", "skipped"), {});
  assert.equal(checkFor(undone, "a")?.status, "update");
  assert.deepEqual(pendingUpdates(undone), ["a"]);
  assert.equal(releaseNote(checkFor(undone, "a")!), "It isn't in your bundle yet; check now for a dry run."); // a skipped check ran none
});

test("the release banner says what the dry run found", () => {
  const c = (extra: Partial<AppCheck>): AppCheck => ({ ...check("a", "update"), listed: true, applied: 5, total: 6, ...extra });
  assert.deepEqual(
    [c({}), c({ listed: false }), c({ listed: false, experimental: true, applied: undefined, total: undefined }), c({ aborted: "no space left" })].map(releaseNote),
    ["A dry run says 5/6 patches apply.", "It isn't in your bundle yet; a dry run says 5/6 patches apply.", "It's experimental in your bundle; check now for a dry run.", "A dry run stopped: no space left"],
  );
});

test("a re-patch after the check clears its new-patches notice", () => {
  const row = (installedAt: string): AppRow => ({ ...app("a", "1.0.0"), versions: [ver("1.0.0", installedAt)] });
  const stale = listWith(row("2026-01-03T00:00:00Z"), check("a", "patches", "1.0.0"), {});
  assert.equal(checkFor(stale, "a"), undefined);
  assert.deepEqual(badgeFor(stale.apps[0], checkFor(stale, "a")), { kind: "ok", label: "1.0.0" });
  assert.deepEqual(pendingUpdates(stale), []);
  const fresh = listWith(row("2026-01-01T00:00:00Z"), check("a", "patches", "1.0.0"), {});
  assert.deepEqual(pendingUpdates(fresh), ["a"]);
});

test("a job's log and progress build up from its notifications", () => {
  let s = startJob(true, 0);
  assert.deepEqual([s.percent, s.steps.download, s.lines], [0, "todo", []]);
  s = jobEvent(s, "job.log", { id: 1, line: "Downloading demo.deb…" }, 1000);
  s = jobEvent(s, "job.progress", { id: 1, step: "download", percent: 37 }, 1100);
  s = jobEvent(s, "job.progress", { id: 1, step: "download", percent: 52 }, 1200);
  assert.equal(s.steps.download, "active");
  assert.equal(s.percent, 21); // download is 40% of a dry run
  s = jobEvent(s, "job.progress", { id: 1, step: "download", percent: 100 }, 1300);
  s = jobEvent(s, "job.progress", { id: 1, step: "extract" }, 2000);
  assert.deepEqual([s.steps.download, s.steps.extract], ["done", "active"]);
  s = jobEvent(s, "job.progress", { id: 1, step: "patch", patch: "Say ‮goodbye", index: 2, total: 4 }, 3000);
  s = jobEvent(s, "job.ignored", { id: 1 }, 3100);
  assert.equal(s.percent, 81); // download 40 + extract 35 + half of patch's 25, rounded down
  assert.deepEqual(
    s.lines.map((l) => [l.at, l.text]),
    [
      [1000, "Downloading demo.deb…"],
      [1100, "Downloaded 37%"],
      [1200, "Downloaded 52%"],
      [1300, "Downloaded 100%"],
      [3000, "Patching 2/4: Say goodbye"],
    ],
  );
  s = jobEvent(s, "job.progress", { id: 1, step: "patch", patch: "(internal patch #3: Hydra extension loader)", index: 3, total: 4 }, 3200);
  assert.equal(s.lines.at(-1)?.text, "Patching 3/4: Hydra extension loader (helper)");
});

test("download percentages are logged once per tenth", () => {
  let s = startJob(false, 0);
  for (const percent of [1, 4, 9, 10, 11, 19, 20, 55, 99, 100]) s = jobEvent(s, "job.progress", { step: "download", percent }, percent);
  assert.deepEqual(s.lines.map((l) => l.text), ["Downloaded 1%", "Downloaded 10%", "Downloaded 20%", "Downloaded 55%", "Downloaded 99%", "Downloaded 100%"]);
  assert.equal(s.percent, 30); // download is 30% of an install
});

test("finishing a job lists every named patch, notes and the summary", () => {
  const s = finishJob(startJob(true, 0), {
    result: {
      appId: "hydra", appName: "Hydra", version: "4.1.7", untested: true, installed: false, dryRun: true, exitCode: 2, warnings: ["Hydra 4.1.7 is untested."], logs: [],
      results: [
        { name: "Disable self-update", status: "applied", required: true, internal: false },
        { name: "(internal patch #4: Hydra locales)", status: "applied", required: false, internal: true },
        { name: "(internal patch #5: registry: library)", status: "failed", required: false, internal: true, message: "fingerprint z: pattern found 0 matches" },
        { name: "Recently downloaded sort", status: "failed", required: false, internal: false, message: "fingerprint x: pattern found 0 matches" },
        { name: "More like this ranking", status: "skipped", required: false, internal: false, message: 'dependency "y" failed' },
        { name: "Hide Deals link", status: "incompatible", required: false, internal: false },
      ],
    },
    report: "Hydra 4.1.7 (untested): 1/3 patches apply (dry run, nothing installed)\n  ✓ Disable self-update",
  }, 9000);
  assert.deepEqual([s.done, s.ok, s.percent, s.steps.patch, s.summary], [true, false, 100, "done", "Hydra 4.1.7 (untested): 1/3 patches apply (dry run, nothing installed)"]);
  assert.deepEqual(s.lines.map((l) => [l.kind, l.text]), [
    ["ok", "✓ Disable self-update (required)"],
    ["fail", "✗ registry: library (helper): fingerprint z: pattern found 0 matches"],
    ["fail", "✗ Recently downloaded sort: fingerprint x: pattern found 0 matches"],
    ["fail", '– More like this ranking skipped: dependency "y" failed'],
    ["warn", "Note: Hydra 4.1.7 is untested."],
    ["summary", "Hydra 4.1.7 (untested): 1/3 patches apply (dry run, nothing installed)"],
  ]);
  const upToDate = finishJob(startJob(false, 0), { report: undefined, result: undefined, upToDate: "Heroic 2.22.4 is up to date" }, 5);
  assert.deepEqual([upToDate.ok, upToDate.summary, upToDate.lines.at(-1)?.text], [true, "Heroic 2.22.4 is up to date", "Heroic 2.22.4 is up to date"]);
  const failed = finishJob(startJob(false, 0), { error: "revamp serve stopped: crashed" }, 5);
  assert.deepEqual([failed.ok, failed.summary, failed.lines.at(-1)?.kind], [false, "revamp serve stopped: crashed", "fail"]);
});
