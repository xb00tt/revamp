import { parse, type Options } from "acorn";

export type Node = { type: string; start: number; end: number; [key: string]: any };
export type Captures = ReadonlyMap<string, Node | Node[]>;
export interface CompiledPattern {
  source: string;
  root: Node;
}
export interface ParsedFile {
  code: string;
  ast: Node;
  /** Every node, grouped by type, in source order. */
  byType: Map<string, Node[]>;
}
export interface PatternMatch {
  node: Node;
  captures: Captures;
}

export const PARSE_OPTIONS: Options = {
  ecmaVersion: "latest",
  sourceType: "module",
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowHashBang: true,
};

const SINGLE = /^\$[A-Z_][A-Z0-9_]*$/;
const MULTI = /^\$\$\$([A-Z_][A-Z0-9_]*)?$/;
const META_KEYS = new Set(["type", "start", "end", "loc", "range"]);
const IGNORED_KEYS = new Set(["type", "start", "end", "loc", "range", "raw", "shorthand", "method"]);
const EMPTY: Captures = new Map();

export const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).type === "string" && typeof (v as Node).start === "number";

export function parseFile(code: string, sourceType: "module" | "script" = "module"): ParsedFile {
  const ast = parse(code, { ...PARSE_OPTIONS, sourceType }) as unknown as Node;
  const byType = new Map<string, Node[]>();
  const stack: Node[] = [ast];
  while (stack.length > 0) {
    const n = stack.pop()!;
    let list = byType.get(n.type);
    if (!list) byType.set(n.type, (list = []));
    list.push(n);
    const kids = children(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return { code, ast, byType };
}

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const key in n) {
    if (META_KEYS.has(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const x of v) if (isNode(x)) out.push(x);
    } else if (isNode(v)) out.push(v);
  }
  return out;
}

export interface ParentLink {
  parent: Node;
  key: string;
  index: number | undefined;
}

/** Finds the node that directly contains `target`, and under which key (and list index). */
export function parentOf(root: Node, target: Node): ParentLink | undefined {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    for (const key in n) {
      if (META_KEYS.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const x = v[i];
          if (x === target) return { parent: n, key, index: i };
          if (isNode(x) && x.start <= target.start && x.end >= target.end) stack.push(x);
        }
      } else if (v === target) return { parent: n, key, index: undefined };
      else if (isNode(v) && v.start <= target.start && v.end >= target.end) stack.push(v);
    }
  }
  return undefined;
}

export function compilePattern(source: string): CompiledPattern {
  const root = parsePattern(source);
  const bare = root.type === "ExpressionStatement" ? root.expression : root;
  if (bare.type === "Identifier" && (SINGLE.test(bare.name) || MULTI.test(bare.name))) {
    throw new Error(`pattern "${source}" is only a blank; add concrete code around it`);
  }
  return { source, root };
}

function parsePattern(src: string): Node {
  const p = (code: string) => parse(code, PARSE_OPTIONS) as unknown as Node;
  const asExpression = () => {
    const body = p(`(${src}\n)`).body;
    return body.length === 1 && body[0].type === "ExpressionStatement" ? body[0].expression : undefined;
  };
  const asStatement = () => {
    const body = p(src).body;
    // `key: value` would parse as a labeled statement; authors mean an object member.
    return body.length === 1 && body[0].type !== "LabeledStatement" ? body[0] : undefined;
  };
  // `function f() {}` and `class C {}` also parse as expressions; authors mean declarations.
  const declarationFirst = /^\s*(async\s+)?(function|class)\b/.test(src);
  const attempts: Array<() => Node | undefined> = [
    ...(declarationFirst ? [asStatement, asExpression] : [asExpression, asStatement]),
    () => {
      const members = p(`class _ {\n${src}\n}`).body[0].body.body;
      return members.length === 1 ? members[0] : undefined;
    },
    () => {
      const props = p(`({\n${src}\n})`).body[0].expression.properties;
      return props.length === 1 ? props[0] : undefined;
    },
    () => {
      const cases = p(`switch (_) {\n${src}\n}`).body[0].cases;
      return cases.length === 1 ? cases[0] : undefined;
    },
  ];
  for (const attempt of attempts) {
    try {
      const node = attempt();
      if (node) return node;
    } catch {
      // not valid in this context; try the next one
    }
  }
  throw new Error(`pattern is not one JavaScript expression, statement, class member, object member or switch case: ${src}`);
}

export function findMatches(p: CompiledPattern, file: ParsedFile, within?: { start: number; end: number }): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const t of file.byType.get(p.root.type) ?? []) {
    if (within && (t.start < within.start || t.end > within.end)) continue;
    const captures = matchNode(p.root, t, file.code, EMPTY);
    if (captures) out.push({ node: t, captures });
  }
  return out.sort((a, b) => a.node.start - b.node.start);
}

const isBlank = (n: Node) => n.type === "Identifier" && SINGLE.test(n.name);
const isStatementType = (t: string) => t.endsWith("Statement") || t.endsWith("Declaration");

export function textOf(code: string, v: Node | Node[]): string {
  if (Array.isArray(v)) return v.length === 0 ? "" : code.slice(v[0].start, v[v.length - 1].end);
  return code.slice(v.start, v.end);
}

function bind(caps: Captures, name: string, value: Node | Node[], code: string): Captures | null {
  if (name === "" || name === "_") return caps;
  const prev = caps.get(name);
  if (prev !== undefined) return textOf(code, prev) === textOf(code, value) ? caps : null;
  return new Map(caps).set(name, value);
}

/** The name of a `$$$`/`$$$NAME` list blank ("" when unnamed), or undefined if `n` is not one. */
function listWildcard(n: Node | null): string | undefined {
  if (!n) return undefined;
  let id: Node | undefined;
  if (n.type === "Identifier") id = n;
  else if (n.type === "ExpressionStatement") id = n.expression;
  else if (n.type === "Property" && n.shorthand) id = n.key;
  else if (n.type === "PropertyDefinition" && n.value === null) id = n.key;
  else if (n.type === "SwitchCase" && n.consequent.length === 0) id = n.test ?? undefined;
  if (id?.type !== "Identifier") return undefined;
  const m = MULTI.exec(id.name);
  return m ? (m[1] ?? "") : undefined;
}

export function matchNode(p: Node | null, t: Node | null, code: string, caps: Captures): Captures | null {
  if (p === null || t === null) return p === t ? caps : null;
  if (p.type === "Identifier" && SINGLE.test(p.name)) return bind(caps, p.name.slice(1), t, code);
  if (p.type === "ExpressionStatement" && isBlank(p.expression) && isStatementType(t.type)) {
    return bind(caps, p.expression.name.slice(1), t, code);
  }
  if (p.type !== t.type) return null;
  switch (p.type) {
    case "Literal":
      return literalEqual(p, t) ? caps : null;
    case "TemplateElement":
      return p.value.cooked === t.value.cooked ? caps : null;
    case "ObjectExpression":
    case "ObjectPattern":
      return matchSubset(p.properties, t.properties, code, caps);
    case "SwitchStatement": {
      const c = matchNode(p.discriminant, t.discriminant, code, caps);
      return c && matchSubset(p.cases, t.cases, code, c);
    }
    case "Property":
      return matchProperty(p, t, code, caps);
  }
  let c: Captures | null = caps;
  for (const key of Object.keys(p)) {
    if (IGNORED_KEYS.has(key)) continue;
    const pv = p[key];
    const tv = t[key];
    if (Array.isArray(pv)) c = Array.isArray(tv) ? matchList(pv, tv, code, c) : null;
    else if (isNode(pv)) c = isNode(tv) ? matchNode(pv, tv, code, c) : null;
    else if (pv === null || typeof pv !== "object") c = pv === tv ? c : null;
    else c = JSON.stringify(pv) === JSON.stringify(tv) ? c : null;
    if (!c) return null;
  }
  return c;
}

function literalEqual(p: Node, t: Node): boolean {
  if (p.regex || t.regex) {
    return !!p.regex && !!t.regex && p.regex.pattern === t.regex.pattern && p.regex.flags === t.regex.flags;
  }
  if (p.bigint !== undefined || t.bigint !== undefined) return p.bigint === t.bigint;
  return p.value === t.value;
}

function propKey(n: Node): string | undefined {
  if (n.computed) return undefined;
  if (n.key.type === "Identifier") return n.key.name;
  if (n.key.type === "Literal") return String(n.key.value);
  return undefined;
}

function matchProperty(p: Node, t: Node, code: string, caps: Captures): Captures | null {
  if (p.kind !== t.kind || p.computed !== t.computed) return null;
  let c: Captures | null;
  if (!p.computed && p.key.type === "Identifier" && SINGLE.test(p.key.name)) c = bind(caps, p.key.name.slice(1), t.key, code);
  else if (!p.computed) c = propKey(p) !== undefined && propKey(p) === propKey(t) ? caps : null;
  else c = matchNode(p.key, t.key, code, caps);
  return c && matchNode(p.value, t.value, code, c);
}

function matchSubset(ps: Node[], ts: Node[], code: string, caps: Captures): Captures | null {
  const wanted = ps.filter((p) => listWildcard(p) === undefined);
  const used = new Array<boolean>(ts.length).fill(false);
  const go = (i: number, c: Captures): Captures | null => {
    if (i === wanted.length) return c;
    for (let j = 0; j < ts.length; j++) {
      if (used[j]) continue;
      const c2 = matchNode(wanted[i], ts[j], code, c);
      if (!c2) continue;
      used[j] = true;
      const r = go(i + 1, c2);
      used[j] = false;
      if (r) return r;
    }
    return null;
  };
  return go(0, caps);
}

function matchList(ps: (Node | null)[], ts: (Node | null)[], code: string, caps: Captures): Captures | null {
  const go = (i: number, j: number, c: Captures): Captures | null => {
    if (i === ps.length) return j === ts.length ? c : null;
    const wild = listWildcard(ps[i]);
    if (wild !== undefined) {
      for (let k = j; k <= ts.length; k++) {
        const c2 = bind(c, wild, ts.slice(j, k).filter(isNode), code);
        const r = c2 && go(i + 1, k, c2);
        if (r) return r;
      }
      return null;
    }
    if (j >= ts.length) return null;
    const c2 = matchNode(ps[i], ts[j], code, c);
    return c2 && go(i + 1, j + 1, c2);
  };
  return go(0, 0, caps);
}
