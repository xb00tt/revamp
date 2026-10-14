import { test } from "node:test";
import assert from "node:assert/strict";
import { EditBuffer } from "../src/edits.ts";

function buffer(patch = "P") {
  const b = new EditBuffer();
  b.current = patch;
  return b;
}

test("replaces and inserts apply against the original offsets", () => {
  const b = buffer();
  b.record("f", 1, 3, "XY");
  b.record("f", 3, 3, "+");
  b.record("f", 0, 0, "<");
  b.record("f", 6, 6, ">");
  assert.equal(b.apply("f", "abcdef", new Set(["P"])), "<aXY+def>");
});

test("same-offset inserts keep their order and go before a range starting there", () => {
  const b = buffer();
  b.record("f", 2, 2, "1");
  b.record("f", 2, 2, "2");
  b.record("f", 2, 4, "R");
  assert.equal(b.apply("f", "abcdef", new Set(["P"])), "ab12Ref");
});

test("overlapping ranges and inserts inside replaced code name both patches", () => {
  const b = buffer("One");
  b.record("f", 0, 3, "x");
  b.current = "Two";
  b.record("f", 2, 4, "y");
  assert.throws(() => b.apply("f", "abcdef", new Set(["One", "Two"])), /"One" and "Two"/);
  const c = buffer("One");
  c.record("f", 0, 4, "");
  c.current = "Two";
  c.record("f", 2, 2, "z");
  assert.throws(() => c.apply("f", "abcdef", new Set(["One", "Two"])), /"One" and "Two"/);
});

test("dropped and not-kept patches leave no trace", () => {
  const b = buffer("A");
  b.record("f", 0, 1, "X");
  b.current = "B";
  b.record("f", 1, 2, "Y");
  b.record("g", 0, 0, "!");
  b.drop("B");
  assert.equal(b.apply("f", "ab", new Set(["A", "B"])), "Xb");
  assert.equal(b.apply("f", "ab", new Set()), "ab");
  assert.deepEqual(b.files(new Set(["A", "B"])), ["f"]);
  assert.deepEqual(b.patchesFor("f", new Set(["A"])), ["A"]);
});

test("edits outside a running patch or past the end are refused", () => {
  assert.throws(() => new EditBuffer().record("f", 0, 0, "x"), /while a patch runs/);
  assert.throws(() => buffer().record("f", 3, 1, "x"), /invalid edit range/);
  const b = buffer();
  b.record("f", 0, 9, "x");
  assert.throws(() => b.apply("f", "abc", new Set(["P"])), /past the end/);
});
