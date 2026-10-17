import { test } from "node:test";
import assert from "node:assert/strict";
import { defineApp, definePatch, fingerprint, option } from "@revamp-app/sdk";

const SHA = "a".repeat(64);
const base = {
  id: "demo",
  name: "Demo",
  release: { github: "o/r", tag: "v{version}", asset: "d_{version}.deb" },
  installDir: "opt/Demo",
  executable: "demo",
  desktopFile: "usr/share/applications/demo.desktop",
};

test("fingerprint needs strings and exactly one of pattern or regex", () => {
  assert.throws(() => fingerprint({ name: "x", strings: [], pattern: "f()" }), /strings must not be empty/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"] }), /exactly one of pattern or regex/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"], pattern: "f()", regex: /f/g }), /exactly one of pattern or regex/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"], regex: /f/ }), /needs the g flag/);
  assert.equal(fingerprint({ name: "x", strings: ["f"], pattern: "f()" }).kind, "fingerprint");
});

test("defineApp validates id and sha256 and defaults required to []", () => {
  assert.throws(() => defineApp({ ...base, versions: { "1.0.0": { sha256: "XYZ" } } }), /sha256/);
  assert.throws(() => defineApp({ ...base, id: "../x", versions: {} }), /app id/);
  const app = defineApp({ ...base, versions: { "1.0.0": { sha256: SHA } } });
  assert.equal(app.kind, "app");
  assert.deepEqual(app.required, []);
});

test("definePatch and option builders tag their objects", () => {
  const p = definePatch({ name: "P", options: { on: option.bool({ title: "On", default: true }) }, execute() {} });
  assert.equal(p.kind, "patch");
  assert.equal(p.options?.on.type, "bool");
  assert.equal(p.options?.on.default, true);
});
