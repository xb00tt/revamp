import type { Capture, Match } from "@revamp/sdk";
import type { EditBuffer } from "./edits.ts";
import { compilePattern, findMatches, parentOf, type Captures, type Node, type ParentLink } from "./pattern.ts";
import type { Sources } from "./sources.ts";

export interface Host {
  sources: Sources;
  edits: EditBuffer;
}

export interface CaptureSpec {
  start: number;
  end: number;
  node?: Node;
  items?: Node[];
}

const COMMA_LISTS = new Set(["elements", "arguments", "params", "properties", "declarations", "specifiers", "expressions"]);
const isCommaList = (l: ParentLink) => COMMA_LISTS.has(l.key) && l.parent.type !== "TemplateLiteral";

/** An editable span of one file: the base of matches and captures. start < 0 marks an empty list capture. */
export class Range {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly node: Node | undefined;
  protected readonly host: Host;

  constructor(host: Host, file: string, start: number, end: number, node: Node | undefined) {
    this.host = host;
    this.file = file;
    this.start = start;
    this.end = end;
    this.node = node;
  }

  get text(): string {
    return this.start < 0 ? "" : this.host.sources.text(this.file).slice(this.start, this.end);
  }

  toString(): string {
    return this.text;
  }

  replace(code: string): void {
    this.edit(this.start, this.end, code);
  }

  insertBefore(code: string): void {
    const list = this.listKind();
    this.edit(this.start, this.start, list === "comma" ? `${code}, ` : list === "lines" ? `${code}\n` : code);
  }

  insertAfter(code: string): void {
    const list = this.listKind();
    this.edit(this.end, this.end, list === "comma" ? `, ${code}` : list === "lines" ? `\n${code}` : code);
  }

  remove(): void {
    const link = this.link();
    if (link?.index !== undefined && isCommaList(link)) {
      const siblings = link.parent[link.key] as Node[];
      if (link.index + 1 < siblings.length) return this.edit(this.start, siblings[link.index + 1].start, "");
      if (link.index > 0) return this.edit(siblings[link.index - 1].end, this.end, "");
    }
    this.edit(this.start, this.end, "");
  }

  private link(): ParentLink | undefined {
    return this.node ? parentOf(this.host.sources.parsed(this.file).ast, this.node) : undefined;
  }

  private listKind(): "comma" | "lines" | undefined {
    const link = this.link();
    if (link?.index === undefined) return undefined;
    return isCommaList(link) ? "comma" : "lines";
  }

  private edit(start: number, end: number, text: string): void {
    if (this.start < 0) throw new Error(`can't edit an empty list capture in ${this.file}`);
    this.host.edits.record(this.file, start, end, text);
  }
}

export class CaptureImpl extends Range implements Capture {
  readonly items: readonly Node[] | undefined;

  constructor(host: Host, file: string, spec: CaptureSpec) {
    super(host, file, spec.start, spec.end, spec.node);
    this.items = spec.items;
  }
}

export class MatchImpl extends Range implements Match {
  readonly line: number;
  readonly [capture: `$${string}`]: Capture;

  constructor(host: Host, file: string, start: number, end: number, node: Node | undefined, captures: ReadonlyMap<string, CaptureSpec>) {
    super(host, file, start, end, node);
    this.line = lineAt(host.sources.text(file), start);
    for (const [name, spec] of captures) {
      Object.defineProperty(this, `$${name}`, { value: new CaptureImpl(host, file, spec), enumerable: true });
    }
  }

  find(pattern: string): Match {
    const all = this.findAll(pattern);
    if (all.length !== 1) {
      throw new Error(`find(\`${pattern}\`) inside ${this.file}:${this.line} expected 1 match, found ${all.length}`);
    }
    return all[0];
  }

  findAll(pattern: string): Match[] {
    if (!this.node) throw new Error("find() works on pattern matches, not regex matches");
    const parsed = this.host.sources.parsed(this.file);
    return findMatches(compilePattern(pattern), parsed, this).map((m) => fromPattern(this.host, this.file, m.node, m.captures));
  }
}

export function fromPattern(host: Host, file: string, node: Node, captures: Captures): MatchImpl {
  const specs = new Map<string, CaptureSpec>();
  for (const [name, v] of captures) {
    if (!Array.isArray(v)) specs.set(name, { start: v.start, end: v.end, node: v });
    else if (v.length === 0) specs.set(name, { start: -1, end: -1, items: v });
    else specs.set(name, { start: v[0].start, end: v[v.length - 1].end, items: v });
  }
  return new MatchImpl(host, file, node.start, node.end, node, specs);
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return line;
}
