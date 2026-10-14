import { test } from "node:test";
import assert from "node:assert/strict";
import { EditBuffer } from "../src/edits.ts";
import { fromPattern } from "../src/match.ts";
import { compilePattern, findMatches } from "../src/pattern.ts";
import { memoryStore, Sources } from "../src/sources.ts";

function matchIn(code: string, pattern: string) {
  const host = { sources: new Sources(memoryStore({ "a.js": code })), edits: new EditBuffer() };
  host.edits.current = "P";
  const matches = findMatches(compilePattern(pattern), host.sources.parsed("a.js")).map((m) =>
    fromPattern(host, "a.js", m.node, m.captures),
  );
  return { matches, result: () => host.edits.apply("a.js", code, new Set(["P"])) };
}

test("inserts next to array elements and object properties add commas", () => {
  let t = matchIn('x = ["a", "b"];', '"a"');
  t.matches[0].insertAfter('"z"');
  assert.equal(t.result(), 'x = ["a", "z", "b"];');
  t = matchIn('x = ["a", "b"];', '"a"');
  t.matches[0].insertBefore('"z"');
  assert.equal(t.result(), 'x = ["z", "a", "b"];');
  t = matchIn("o = { a: 1, b: 2 };", "a: 1");
  t.matches[0].insertAfter("c: 3");
  assert.equal(t.result(), "o = { a: 1, c: 3, b: 2 };");
});

test("inserts next to switch cases and statements add a newline", () => {
  const t = matchIn("switch (s) { case 1: { f(); } }", "case 1: { $$$ }");
  t.matches[0].insertAfter("case 2: { g(); }");
  assert.equal(t.result(), "switch (s) { case 1: { f(); }\ncase 2: { g(); } }");
});

test("remove() takes one neighbouring comma with it", () => {
  for (const [code, pattern, expected] of [
    ["[1, 2, 3]", "2", "[1, 3]"],
    ["[1, 2, 3]", "3", "[1, 2]"],
    ["[1]", "1", "[]"],
  ]) {
    const t = matchIn(code, pattern);
    t.matches[0].remove();
    assert.equal(t.result(), expected);
  }
});

test("captures stringify to their source and can be edited", () => {
  const t = matchIn("f(a, b)", "f($X, $Y)");
  const [m] = t.matches;
  assert.equal(`${m.$X}`, "a");
  m.$Y.replace("c");
  assert.equal(t.result(), "f(a, c)");
});

test("list captures span their items; empty list captures can't be edited", () => {
  const t = matchIn("g(1, 2)", "g($$$ARGS)");
  assert.equal(t.matches[0].$ARGS.text, "1, 2");
  t.matches[0].$ARGS.replace("3");
  assert.equal(t.result(), "g(3)");
  const e = matchIn("f()", "f($$$ARGS)");
  assert.equal(e.matches[0].$ARGS.text, "");
  assert.throws(() => e.matches[0].$ARGS.replace("1"), /empty list capture/);
});

test("find() searches inside the match and needs exactly one hit", () => {
  const t = matchIn("function f() { g(1); g(2); } g(3);", "function f() { $$$ }");
  const [m] = t.matches;
  assert.equal(m.findAll("g($X)").length, 2);
  assert.throws(() => m.find("g($X)"), /expected 1 match, found 2/);
  m.find("g(2)").replace("h()");
  assert.equal(t.result(), "function f() { g(1); h(); } g(3);");
  assert.equal(m.line, 1);
});

test("resolve() follows identifiers to top-level declarations, and edits land there", () => {
  const code = [
    "const en = { library: lib, home };",
    'const lib = { "a": "A" };',
    "export function home() {}",
    "const resources = { en, home };",
  ].join("\n");
  const t = matchIn(code, "const resources = { en: $EN, home: $H }");
  const [m] = t.matches;
  const en = m.$EN.resolve();
  assert.equal(en.text, "{ library: lib, home }");
  assert.equal(en.line, 1);
  const lib = en.find("library: $NS").$NS.resolve();
  assert.equal(lib.text, '{ "a": "A" }');
  assert.equal(m.$H.resolve().node!.type, "FunctionDeclaration");
  lib.find('"a": $V').insertAfter('"b": "B"');
  assert.equal(t.result().split("\n")[1], 'const lib = { "a": "A", "b": "B" };');
});

test("resolve() names the problem: not an identifier, undeclared, declared twice, no value", () => {
  const [m] = matchIn("var x = 1;\nvar x = 2;\nlet y;\ng(x, y, z, 1);", "g($X, $Y, $Z, $N)").matches;
  assert.throws(() => m.$X.resolve(), /x is declared 2 times at the top level of a\.js/);
  assert.throws(() => m.$Y.resolve(), /y is declared without a value in a\.js/);
  assert.throws(() => m.$Z.resolve(), /z \(a\.js:4\) has no top-level declaration in a\.js/);
  assert.throws(() => m.$N.resolve(), /needs an identifier; a\.js:4 is a Literal/);
});
