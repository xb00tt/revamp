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
