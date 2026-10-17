import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, runJob, type Selection } from "@revamp-app/engine";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/heroic-2.22.3/${name}`, import.meta.url), "utf8");
const APP = "build/assets/App.js";
const MAIN = "build/main/main.js";
const STOCK = {
  Name: "Heroic Games Launcher",
  Exec: "/opt/Heroic/heroic %U",
  Icon: "heroic",
  StartupWMClass: "Heroic",
  MimeType: "x-scheme-handler/heroic;",
  Categories: "Game;",
};
const NONE: Selection = { enable: [], disable: [], options: {} };
const files = (app = fixture("App-excerpt.js")) => ({
  "package.json": '{\n  "name": "heroic",\n  "version": "2.22.3",\n  "main": "build/main/main.js"\n}\n',
  [MAIN]: fixture("main-excerpt.js"),
  [APP]: app,
});
const job = (selection = NONE, app?: string) =>
  runJob(bundle, { appId: "heroic", version: "2.22.3", selection, force: false, stockDesktop: STOCK }, memoryStore(files(app)));

test("every Heroic patch applies to the Heroic 2.22.3 excerpts, and no Hydra patch runs", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status]), [
    ["Disable self-update", "applied"],
    ["Side-by-side identity", "applied"],
    ["Hide Deals link", "applied"],
  ]);
});

test("Hide Deals link replaces only the Deals link with null", () => {
  const code = job().outputs.get(APP)!.toString();
  const original = fixture("App-excerpt.js");
  const deals = 'd.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"})';
  assert.ok(original.includes(deals));
  assert.equal(code, original.replace(deals, "null"));
});

test("Disable self-update and Side-by-side identity work on Heroic's main process too", () => {
  const out = job();
  const main = out.outputs.get(MAIN)!.toString();
  assert.equal(main.match(/isUpdaterActive\(\) \{\s*return false;\s*\}/g)?.length, 2);
  assert.equal(JSON.parse(out.outputs.get("package.json")!.toString()).desktopName, "revamp-heroic.desktop");
  assert.deepEqual(out.desktopEntry, { ...STOCK, Name: "Heroic Games Launcher (Revamped)", StartupWMClass: "revamp-heroic" });
  const keepLinks = job({ ...NONE, options: { "Side-by-side identity": { claimLinks: false } } }).outputs.get(MAIN)!.toString();
  assert.ok(keepLinks.includes("if (false) {"));
});

test("a sidebar without the Deals link fails only Hide Deals link, naming the fingerprint and step", () => {
  const out = job(NONE, fixture("App-excerpt.js").replace('url:"/discounts"', 'url:"/deals"'));
  const r = out.results.find((x) => x.name === "Hide Deals link")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /fingerprint "sidebar Deals link" failed at step "pattern": strings matched 1 file\(s\): build\/assets\/App\.js; pattern .* matched 0 nodes/);
  assert.equal(out.aborted, undefined);
});
