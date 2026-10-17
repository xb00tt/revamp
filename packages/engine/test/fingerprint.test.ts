import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "@revamp-app/sdk";
import { EditBuffer } from "../src/edits.ts";
import { FingerprintError, Fingerprints } from "../src/fingerprint.ts";
import { memoryStore, Sources } from "../src/sources.ts";

const resolver = (files: Record<string, string>) =>
  new Fingerprints({ sources: new Sources(memoryStore(files)), edits: new EditBuffer() });
const files = {
  "out/main.js": "const a = 1;\nfoo(a, 2);\nfoo(b, 3);\n",
  "out/other.js": "bar();\n",
  "node_modules/lib/index.js": "foo(lib, 2);\n",
  "out/style.css": "foo(a, 2)",
};

function failure(fn: () => unknown): FingerprintError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FingerprintError) return e;
    throw e;
  }
  assert.fail("expected a FingerprintError");
}

test("strings → pattern → count returns one match with captures and a line number", () => {
  const [m] = resolver(files).resolve(fingerprint({ name: "foo two", strings: ["foo("], pattern: "foo($X, 2)" }));
  assert.equal(m.file, "out/main.js");
  assert.equal(m.line, 2);
  assert.equal(`${m.$X}`, "a");
});

test("each failing step is named in the error", () => {
  const r = resolver(files);
  let e = failure(() => r.resolve(fingerprint({ name: "nope", strings: ["nope", "foo("], pattern: "foo($X)" })));
  assert.equal(e.step, "strings");
  assert.match(e.message, /fingerprint "nope" failed at step "strings".*"nope" in 0 file\(s\), "foo\(" in 1 file\(s\)/);
  e = failure(() => r.resolve(fingerprint({ name: "foo four", strings: ["foo("], pattern: "foo($X, 4)" })));
  assert.equal(e.step, "pattern");
  assert.match(e.message, /strings matched 1 file\(s\): out\/main\.js; pattern foo\(\$X, 4\) matched 0 nodes/);
  e = failure(() =>
    r.resolve(fingerprint({ name: "w", strings: ["foo("], pattern: "foo($X, 2)", where: { "in renderer": (m) => m.file.startsWith("out/renderer/") } })),
  );
  assert.equal(e.step, "where:in renderer");
  e = failure(() => r.resolve(fingerprint({ name: "any foo", strings: ["foo("], pattern: "foo($X, $Y)" })));
  assert.equal(e.step, "count");
  assert.match(e.message, /expected exactly 1 match, found 2: out\/main\.js:2, out\/main\.js:3/);
});

test("scope app skips node_modules, scope all searches it, count many returns every match", () => {
  const r = resolver(files);
  const all = r.resolve(fingerprint({ name: "all foo two", strings: ["foo("], pattern: "foo($X, 2)", scope: "all", count: "many" }));
  assert.deepEqual(all.map((m) => m.file).sort(), ["node_modules/lib/index.js", "out/main.js"]);
});

test("results and errors are cached per fingerprint", () => {
  const r = resolver(files);
  const fp = fingerprint({ name: "foo two", strings: ["foo("], pattern: "foo($X, 2)" });
  assert.equal(r.resolve(fp), r.resolve(fp));
  const bad = fingerprint({ name: "bad", strings: ["zzz"], pattern: "x()" });
  assert.equal(failure(() => r.resolve(bad)), failure(() => r.resolve(bad)));
});

test("regex fingerprints expose named groups as captures", () => {
  const r = resolver({ "out/v.js": 'const VERSION = "1.2.3";\n' });
  const [m] = r.resolve(fingerprint({ name: "version", strings: ["VERSION"], regex: /VERSION = "(?<V>[\d.]+)"/g }));
  assert.equal(m.node, undefined);
  assert.equal(m.$V.text, "1.2.3");
});

test("sloppy scripts still parse; unparsable files are reported", () => {
  const r = resolver({ "lib/old.js": "with (a) { foo(1, 2); }\n", "lib/broken.js": "foo(1, 2) +;\n" });
  assert.equal(r.resolve(fingerprint({ name: "old", strings: ["with ("], pattern: "foo(1, 2)" })).length, 1);
  const e = failure(() => r.resolve(fingerprint({ name: "broken", strings: ["+;"], pattern: "foo(1, 2)" })));
  assert.match(e.message, /could not parse lib\/broken\.js/);
});
