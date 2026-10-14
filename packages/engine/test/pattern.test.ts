import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePattern, findMatches, parentOf, parseFile, textOf } from "../src/pattern.ts";

function find(pattern: string, code: string) {
  return findMatches(compilePattern(pattern), parseFile(code)).map((m) => ({
    text: textOf(code, m.node),
    caps: Object.fromEntries([...m.captures].map(([k, v]) => [k, textOf(code, v)])),
  }));
}

test("patterns parse as expression, statement, class member, object member or switch case", () => {
  assert.equal(compilePattern("f($A)").root.type, "CallExpression");
  assert.equal(compilePattern("({ a: 1 })").root.type, "ObjectExpression");
  assert.equal(compilePattern("const $X = 1").root.type, "VariableDeclaration");
  assert.equal(compilePattern("isUpdaterActive() { $$$ }").root.type, "MethodDefinition");
  assert.equal(compilePattern('"key": $V').root.type, "Property");
  assert.equal(compilePattern("value: $V").root.type, "Property");
  assert.equal(compilePattern('case "a": { $$$ }').root.type, "SwitchCase");
  assert.equal(compilePattern("function f($$$) { $$$ }").root.type, "FunctionDeclaration");
  assert.throws(() => compilePattern("$X"), /only a blank/);
  assert.throws(() => compilePattern("case case"), /not one JavaScript/);
});

test("single blanks capture; a repeated blank must repeat the same code", () => {
  assert.deepEqual(find("$A + $A", "x + x; x + y;").map((m) => m.text), ["x + x"]);
  assert.deepEqual(find("f($A, $B)", "f(1, g(2))")[0].caps, { A: "1", B: "g(2)" });
});

test("$$$ matches any number of list items and $$$NAME captures them", () => {
  assert.equal(find("f($$$, 3)", "f(3); f(1, 2, 3); f(3, 4);").length, 2);
  assert.deepEqual(find("f($$$ARGS)", "f(1, 2)")[0].caps, { ARGS: "1, 2" });
  assert.equal(find('[$$$, "b", $$$]', '["a", "b", "c"]; ["a", "c"];').length, 1);
});

test("object patterns are unordered subsets and ignore key quoting", () => {
  const code = 'x = {icon: a, "url": "/discounts", label: b}; y = {url: "/other"};';
  assert.deepEqual(find('({ url: "/discounts" })', code).map((m) => m.text), ['{icon: a, "url": "/discounts", label: b}']);
  assert.deepEqual(find('({ $K: "/other" })', code)[0].caps, { K: "url" });
});

test("switch patterns list the cases they need, in any order", () => {
  const code = 'switch (s) { case "a": { f(); break; } case "b": { g(); break; } default: h(); }';
  assert.equal(find('switch ($S) { case "b": { $$$ } }', code).length, 1);
  assert.equal(find('switch ($S) { case "z": { $$$ } }', code).length, 0);
});

test("quotes, comments and parentheses don't matter", () => {
  assert.equal(find("f('a')", '/* @__PURE__ */ f(("a"))').length, 1);
});

test("function patterns mean declarations, not expressions", () => {
  const code = "function SimilarGames({ objectId, shop }) { return 1; } const e = function SimilarGames() {};";
  assert.deepEqual(find("function SimilarGames($$$) { $$$ }", code).map((m) => m.text.slice(0, 21)), ["function SimilarGames"]);
});

test("class member patterns match methods and capture their body", () => {
  const code = "class U { isUpdaterActive() { const a = 1; return a; } check() { return this.isUpdaterActive(); } }";
  const found = find("isUpdaterActive() { $$$BODY }", code);
  assert.equal(found.length, 1);
  assert.equal(found[0].caps.BODY, "const a = 1; return a;");
});

test("a lone blank statement matches exactly one statement", () => {
  assert.equal(find("if ($C) { $S; }", "if (a) { b(); } if (c) { d(); e(); }").length, 1);
});

test("minified Heroic code: blanks capture mangled names", () => {
  const code = 'd.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"})';
  assert.deepEqual(find('$R.jsx($LINK, { url: "/discounts" })', code)[0].caps, { R: "d", LINK: "ut" });
});

test("findMatches can search inside a range", () => {
  const code = "f(1); { f(2); }";
  const file = parseFile(code);
  const block = file.byType.get("BlockStatement")![0];
  assert.deepEqual(findMatches(compilePattern("f($X)"), file, block).map((m) => textOf(code, m.node)), ["f(2)"]);
});

test("parentOf reports the containing list and index", () => {
  const file = parseFile('const o = ["a", "b"];');
  const b = file.byType.get("Literal")!.find((n) => n.value === "b")!;
  const link = parentOf(file.ast, b)!;
  assert.deepEqual([link.parent.type, link.key, link.index], ["ArrayExpression", "elements", 1]);
});

test("parseFile parses sloppy scripts when asked", () => {
  assert.throws(() => parseFile("with (a) b;"));
  assert.equal(parseFile("with (a) b;", "script").ast.type, "Program");
});
