import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptionFlag, resolveSelection } from "../src/config.ts";
import { patchesForApp, type AppInfo, type PatchInfo } from "../src/job.ts";

const app = { id: "hydra", name: "Hydra", required: ["Core"] } as AppInfo;
const patch = (name: string, apps: PatchInfo["apps"], options: PatchInfo["options"] = {}): PatchInfo => ({
  name,
  description: "",
  apps,
  default: apps !== null,
  options,
});
const opt = (type: string) => ({ type, title: type, description: "", default: null });
const PATCHES = [
  patch("Core", null, { claimLinks: opt("bool") }),
  patch("Sort", [{ app: "hydra", versions: ["4.1.6"] }], { limit: opt("number"), label: opt("string") }),
  patch("Universal", null),
  patch("Heroic only", [{ app: "heroic", versions: null }]),
];
const MINE = patchesForApp(PATCHES, "hydra");
const EMPTY = { enable: [], disable: [], options: {} };

test("patchesForApp keeps the app's own patches and the universal ones", () => {
  assert.deepEqual(MINE.map((p) => p.name), ["Core", "Sort", "Universal"]);
});

test("parseOptionFlag splits at the last colon before the first equals sign", () => {
  assert.deepEqual(parseOptionFlag("Side-by-side identity:claimLinks=false"), { patch: "Side-by-side identity", key: "claimLinks", value: "false" });
  assert.deepEqual(parseOptionFlag("P:url=http://x:1/a=b"), { patch: "P", key: "url", value: "http://x:1/a=b" });
  for (const bad of ["P:key", "key=1", ":key=1", "P:=1"]) assert.throws(() => parseOptionFlag(bad), /must look like "<patch>:<key>=<value>"/);
});

test("flags are merged and options converted to their declared types", () => {
  const { selection, warnings } = resolveSelection(app, MINE, { ...EMPTY, options: { Sort: { label: "x" } } }, {
    enable: ["Universal"],
    disable: ["Sort"],
    options: ["Core:claimLinks=false", "Sort:limit=12", "Sort:label=a:b=c"],
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(selection, {
    enable: ["Universal"],
    disable: ["Sort"],
    options: { Core: { claimLinks: false }, Sort: { label: "a:b=c", limit: 12 } },
  });
});

test("bad flags fail with a message naming what is wrong", () => {
  const run = (flags: Parameters<typeof resolveSelection>[3]) => () => resolveSelection(app, MINE, EMPTY, flags);
  assert.throws(run({ enable: ["Nope"] }), /Hydra has no patch "Nope" \(see: revamp patches hydra\)/);
  assert.throws(run({ enable: ["Heroic only"] }), /Hydra has no patch "Heroic only"/);
  assert.throws(run({ disable: ["Core"] }), /"Core" is required for Hydra and can't be disabled/);
  assert.throws(run({ options: ["Nope:x=1"] }), /Hydra has no patch "Nope"/);
  assert.throws(run({ options: ["Sort:size=1"] }), /"Sort" has no option "size" \(it has: limit, label\)/);
  assert.throws(run({ options: ["Core:claimLinks=yes"] }), /value must be true or false/);
  assert.throws(run({ options: ["Sort:limit=lots"] }), /value must be a number/);
  assert.throws(run({ options: ["Sort:limit="] }), /value must be a number/);
});

test("saved choices the bundle no longer supports are dropped with a warning", () => {
  const saved = {
    enable: ["Universal", "Gone"],
    disable: ["Core", "Sort"],
    options: { Sort: { limit: 3, old: true }, Gone: { x: 1 } },
  };
  const { selection, warnings } = resolveSelection(app, MINE, saved, {});
  assert.deepEqual(selection, { enable: ["Universal"], disable: ["Sort"], options: { Sort: { limit: 3 } } });
  assert.deepEqual(warnings, [
    'Dropped "Gone" from your saved choices for Hydra: this bundle no longer has that patch.',
    `Dropped "Core" from your saved choices for Hydra: it is required now, so it can't be disabled.`,
    'Dropped option "Sort:old" from your saved choices for Hydra: the patch no longer has that option.',
    'Dropped the options of "Gone" from your saved choices for Hydra: this bundle no longer has that patch.',
  ]);
});

test("saved option values of the wrong type are dropped with a warning", () => {
  const saved = { ...EMPTY, options: { Sort: { limit: "3", label: "ok" }, Core: { claimLinks: 1 } } };
  const { selection, warnings } = resolveSelection(app, MINE, saved, {});
  assert.deepEqual(selection.options, { Sort: { label: "ok" } });
  assert.deepEqual(warnings, [
    'Dropped option "Sort:limit" from your saved choices for Hydra: the patch now expects a number.',
    'Dropped option "Core:claimLinks" from your saved choices for Hydra: the patch now expects true or false.',
  ]);
});

test('a patch named "__proto__" stays an ordinary key', () => {
  const evil = [patch("__proto__", null, { polluted: opt("bool") })];
  const { selection } = resolveSelection(app, evil, EMPTY, { options: ["__proto__:polluted=true"] });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(selection.options), ["__proto__"]);
});
