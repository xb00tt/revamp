import { test } from "node:test";
import assert from "node:assert/strict";
import { defineApp, definePatch, fingerprint, option, type Patch } from "@revamp-app/sdk";
import { describeBundle, runJob, type BundleModule, type JobInput } from "../src/job.ts";
import { memoryStore } from "../src/sources.ts";

const app = defineApp({
  id: "demo",
  name: "Demo",
  release: { github: "example/demo", tag: "v{version}", asset: "demo_{version}_amd64.deb" },
  installDir: "opt/Demo",
  executable: "demo",
  desktopFile: "usr/share/applications/demo.desktop",
  versions: { "1.0.0": { sha256: "a".repeat(64) }, "2.0.0": { sha256: "b".repeat(64) } },
});
const hello = fingerprint({ name: "hello call", strings: ['"hello"'], pattern: 'log("hello")' });
const files = { "package.json": '{"name":"demo"}', "out/main.js": 'log("hello");\nlog("world");\n' };
const manifest = { name: "Test", version: "1.0.0", minEngine: "0.1.0", author: "t", license: "GPL-3.0-only", source: "test" };
const bundle = (patches: Patch<any>[], required: Patch<any>[] = []): BundleModule => ({ manifest, apps: [{ ...app, required }], patches });
const input = (o: Partial<JobInput> = {}): JobInput => ({
  appId: "demo",
  version: "1.0.0",
  selection: { enable: [], disable: [], options: {} },
  force: false,
  stockDesktop: { Name: "Demo", Exec: "/opt/Demo/demo" },
  ...o,
});
const run = (b: BundleModule, i = input()) => runJob(b, i, memoryStore(files));
const statuses = (out: ReturnType<typeof run>) => out.results.map((r) => [r.name, r.status]);

test("applies patches, writes outputs and merges desktop entry changes", () => {
  const greet = definePatch({
    name: "Greet",
    compatibleWith: [{ app }],
    execute(ctx) {
      ctx.match(hello).replace('log("hi")');
      ctx.desktopEntry.Name = "Demo (Revamped)";
    },
  });
  const pkg = definePatch({
    name: "Pkg",
    compatibleWith: [{ app }],
    execute(ctx) {
      const f = ctx.file("package.json");
      f.setJson({ ...f.json<object>(), desktopName: "x.desktop" });
      ctx.addFile("out/extra.js", "1;");
      ctx.log("added extra.js");
    },
  });
  const out = run(bundle([greet, pkg]));
  assert.equal(out.aborted, undefined);
  assert.deepEqual(statuses(out), [["Greet", "applied"], ["Pkg", "applied"]]);
  assert.equal(out.outputs.get("out/main.js")!.toString(), 'log("hi");\nlog("world");\n');
  assert.deepEqual(JSON.parse(out.outputs.get("package.json")!.toString()), { name: "demo", desktopName: "x.desktop" });
  assert.equal(out.outputs.get("out/extra.js")!.toString(), "1;");
  assert.deepEqual(out.desktopEntry, { Name: "Demo (Revamped)", Exec: "/opt/Demo/demo" });
  assert.deepEqual(out.logs, ["[Pkg] added extra.js"]);
});

test("a failing patch leaves no edits and its dependents are skipped", () => {
  const bad = definePatch({
    name: "Bad",
    compatibleWith: [{ app }],
    execute(ctx) {
      ctx.match(hello).replace("X");
      throw new Error("boom");
    },
  });
  const after = definePatch({ name: "After", compatibleWith: [{ app }], dependsOn: [bad], execute() {} });
  const out = run(bundle([bad, after]));
  assert.deepEqual(statuses(out), [["Bad", "failed"], ["After", "skipped"]]);
  assert.equal(out.results[0].message, "boom");
  assert.match(out.results[1].message!, /dependency "Bad" failed/);
  assert.equal(out.outputs.size, 0);
});

test("a fingerprint miss fails the patch naming the fingerprint and step", () => {
  const miss = fingerprint({ name: "missing call", strings: ['"nope"'], pattern: "x()" });
  const p = definePatch({ name: "Miss", compatibleWith: [{ app }], execute: (ctx) => void ctx.match(miss) });
  assert.match(run(bundle([p])).results[0].message!, /fingerprint "missing call" failed at step "strings"/);
});

test("a failed required patch aborts the job", () => {
  const must = definePatch({ name: "Must", execute: () => { throw new Error("boom"); } });
  const out = run(bundle([must], [must]));
  assert.equal(out.aborted, 'required patch "Must" failed: boom');
  assert.equal(out.outputs.size, 0);
});

test("defaults, universal patches, versions, force, enable and disable", () => {
  const uni = definePatch({ name: "Universal", execute() {} });
  const off = definePatch({ name: "Off", default: false, compatibleWith: [{ app }], execute() {} });
  const v2 = definePatch({ name: "Only2", compatibleWith: [{ app, versions: ["2.0.0"] }], execute() {} });
  const other = definePatch({ name: "Other app", compatibleWith: [{ app: { ...app, id: "other" } }], execute() {} });
  const b = bundle([uni, off, v2, other]);
  assert.deepEqual(statuses(run(b)), [["Universal", "disabled"], ["Off", "disabled"], ["Only2", "incompatible"]]);
  const sel = { enable: ["Universal", "Off"], disable: [], options: {} };
  assert.deepEqual(statuses(run(b, input({ selection: sel, force: true }))), [["Universal", "applied"], ["Off", "applied"], ["Only2", "applied"]]);
  assert.throws(() => run(b, input({ selection: { enable: ["Nope"], disable: [], options: {} } })), /unknown patch "Nope"/);
  const must = definePatch({ name: "Must", execute() {} });
  assert.throws(() => run(bundle([must], [must]), input({ selection: { enable: [], disable: ["Must"], options: {} } })), /required/);
});

test("dependencies first, ties by name, internal patches included, finalize in reverse", () => {
  const calls: string[] = [];
  const mk = (name: string, deps: Patch<any>[]) =>
    definePatch({ name, compatibleWith: [{ app }], dependsOn: deps, execute: () => void calls.push(`exec ${name}`), finalize: () => void calls.push(`fin ${name}`) });
  const internal = definePatch({ description: "Helper", execute: () => void calls.push("exec internal") });
  const b = mk("B", []);
  const out = run(bundle([mk("C", [b]), b, mk("A", [internal])]));
  assert.deepEqual(calls, ["exec B", "exec C", "exec internal", "exec A", "fin A", "fin C", "fin B"]);
  assert.deepEqual(out.results.filter((r) => r.internal).map((r) => [r.name, r.status]), [["(internal patch #3: Helper)", "applied"]]);
});

test("options: defaults, given values, validation and unknown keys", () => {
  const seen: unknown[] = [];
  const p = definePatch({
    name: "Opt",
    compatibleWith: [{ app }],
    options: { n: option.number({ title: "N", default: 1, validate: (v) => (v > 0 ? undefined : "must be positive") }) },
    execute: (ctx) => void seen.push(ctx.options.n),
  });
  const withOptions = (o: Record<string, unknown>) => run(bundle([p]), input({ selection: { enable: [], disable: [], options: { Opt: o } } }));
  run(bundle([p]));
  withOptions({ n: 5 });
  assert.deepEqual(seen, [1, 5]);
  assert.match(withOptions({ n: -1 }).results[0].message!, /must be positive/);
  assert.match(withOptions({ zzz: 1 }).results[0].message!, /unknown option "zzz"/);
  assert.match(withOptions({ n: "x" }).results[0].message!, /must be a number/);
});

test("overlapping edits from two patches fail the job naming both", () => {
  const one = definePatch({ name: "One", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("a()") });
  const two = definePatch({ name: "Two", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("b()") });
  assert.throws(() => run(bundle([one, two])), /"One" and "Two"/);
});

test("output that no longer parses fails the job naming the patch", () => {
  const breaker = definePatch({ name: "Breaker", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("log(") });
  assert.throws(() => run(bundle([breaker])), /out\/main\.js is not valid JavaScript.*"Breaker"/s);
});

test("addFile refuses unsafe and existing paths", () => {
  const unsafe = definePatch({ name: "Unsafe", compatibleWith: [{ app }], execute: (ctx) => ctx.addFile("../x.js", "1") });
  const clash = definePatch({ name: "Clash", compatibleWith: [{ app }], execute: (ctx) => ctx.addFile("out/main.js", "1") });
  const out = run(bundle([unsafe, clash]));
  assert.match(out.results.find((r) => r.name === "Unsafe")!.message!, /invalid path/);
  assert.match(out.results.find((r) => r.name === "Clash")!.message!, /already has/);
});

test("describeBundle lists apps and named patches without functions", () => {
  const p = definePatch({ name: "Greet", description: "Says hi", compatibleWith: [{ app }], options: { on: option.bool({ title: "On", default: true }) }, execute() {} });
  const d = describeBundle(bundle([p, definePatch({ execute() {} })]));
  assert.equal(d.apps[0].id, "demo");
  assert.deepEqual(d.patches, [
    { name: "Greet", description: "Says hi", apps: [{ app: "demo", versions: null }], default: true, options: { on: { type: "bool", title: "On", description: "", default: true } } },
  ]);
  assert.doesNotThrow(() => JSON.stringify(d));
});
