import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppCheck } from "@revamp/engine";
import { badgeFor, checkFor, plain, formatBytes, initialToggles, optionFlags, pendingUpdates, progressLabel, reclaimable, selectionFlags, type AppRow, type AppsList, type PatchRow } from "../src/model.ts";

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
