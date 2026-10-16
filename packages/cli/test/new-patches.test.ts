import { test } from "node:test";
import assert from "node:assert/strict";
import { newPatchesPrompt } from "../src/new-patches.ts";

const q = {
  bundle: { name: "Revamp official", version: "0.4.0" },
  appName: "Hydra",
  version: "4.1.6",
  patches: [
    { name: "More like this (Steam)", description: "Steam row." },
    { name: "More like this (Revamped)", description: "Tag row." },
  ],
};
const NOTE = 'They stay off for this run. To turn them on, run it again with --yes or --enable "<patch>".';

function run(o: { yes?: boolean; dryRun?: boolean; interactive?: boolean; answer?: boolean }, question = q) {
  const lines: string[] = [];
  const asked: string[] = [];
  const ask = newPatchesPrompt({
    yes: o.yes ?? false,
    dryRun: o.dryRun ?? false,
    interactive: o.interactive ?? true,
    confirm: async (s) => (asked.push(s), o.answer ?? true),
    print: (l) => lines.push(l),
  });
  return ask(question).then((answer) => ({ answer, lines, asked }));
}

test("lists the patches, then asks", async () => {
  const r = await run({});
  assert.equal(r.answer, "on");
  assert.deepEqual(r.lines, ["Revamp official 0.4.0 adds 2 new patches for Hydra 4.1.6:", "  More like this (Steam)     Steam row.", "  More like this (Revamped)  Tag row."]);
  assert.deepEqual(r.asked, ["Turn them on?"]);
});

test("No keeps them off", async () => {
  assert.equal((await run({ answer: false })).answer, "off");
});

test("--yes answers yes without asking", async () => {
  const r = await run({ yes: true });
  assert.deepEqual([r.answer, r.asked], ["on", []]);
  assert.equal(r.lines.length, 3);
});

test("without a terminal they stay off for this run, unsaved", async () => {
  const r = await run({ interactive: false });
  assert.deepEqual([r.answer, r.asked, r.lines.at(-1)], ["off-this-run", [], NOTE]);
});

test("a dry run never asks", async () => {
  const r = await run({ dryRun: true });
  assert.deepEqual([r.answer, r.asked, r.lines.at(-1)], ["off-this-run", [], NOTE]);
  assert.equal((await run({ dryRun: true, yes: true })).answer, "on");
});

test("one patch reads 'adds 1 new patch'", async () => {
  const r = await run({}, { ...q, patches: [q.patches[0]!] });
  assert.equal(r.lines[0], "Revamp official 0.4.0 adds 1 new patch for Hydra 4.1.6:");
});

test("bundle text is printable", async () => {
  const r = await run({}, { ...q, patches: [{ name: "A", description: "x\u001b[2Jy" }] });
  assert.ok(r.lines.every((l) => !l.includes("\u001b")));
});
