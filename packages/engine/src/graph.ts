import type { AppDef, Patch } from "@revamp/sdk";
import type { Selection } from "./config.ts";

export type PatchStatus = "applied" | "failed" | "skipped" | "incompatible" | "disabled";

export interface PatchResult {
  name: string;
  status: PatchStatus;
  required: boolean;
  /** Unnamed patches reached through dependsOn; hidden from users unless they fail. */
  internal: boolean;
  message?: string;
}

export interface Plan {
  /** Patches to run, dependencies first. */
  order: Patch[];
  results: Map<Patch, PatchResult>;
  labels: Map<Patch, string>;
}

export function planPatches(app: AppDef, version: string, bundlePatches: Patch[], selection: Selection, force: boolean): Plan {
  const named = [...new Set([...app.required, ...bundlePatches])].filter((p) => p.name);
  const byName = new Map<string, Patch>();
  for (const p of named) {
    if (byName.has(p.name!)) throw new Error(`two patches are named "${p.name}"`);
    byName.set(p.name!, p);
  }
  for (const n of [...selection.enable, ...selection.disable]) {
    if (!byName.has(n)) throw new Error(`unknown patch "${n}" for ${app.name}`);
  }
  const required = new Set(app.required);
  for (const n of selection.disable) {
    if (required.has(byName.get(n)!)) throw new Error(`patch "${n}" is required for ${app.name} and can't be disabled`);
  }

  const results = new Map<Patch, PatchResult>();
  const labels = new Map<Patch, string>();
  const chosen: Patch[] = [];
  for (const p of named) {
    const universal = p.compatibleWith === undefined;
    const targets = (p.compatibleWith ?? []).filter((c) => c.app.id === app.id);
    if (!universal && targets.length === 0) continue; // a patch for another app
    const compatible = universal || targets.some((c) => !c.versions || c.versions.includes(version));
    const isRequired = required.has(p);
    const wanted =
      isRequired || selection.enable.includes(p.name!) || (!universal && !selection.disable.includes(p.name!) && p.default !== false);
    labels.set(p, p.name!);
    const result: PatchResult = { name: p.name!, status: "disabled", required: isRequired, internal: false };
    results.set(p, result);
    if (!wanted) continue;
    if (!compatible && !force) {
      result.status = "incompatible";
      result.message = `not compatible with ${app.name} ${version}`;
      continue;
    }
    chosen.push(p);
  }

  const nodes: Patch[] = [];
  const visit = (p: Patch, path: Patch[]) => {
    if (path.includes(p)) throw new Error(`dependency cycle: ${[...path, p].map((x) => x.name ?? "(internal)").join(" → ")}`);
    if (nodes.includes(p)) return;
    for (const d of p.dependsOn ?? []) visit(d, [...path, p]);
    nodes.push(p);
  };
  for (const p of chosen) visit(p, []);
  nodes.forEach((p, i) => {
    if (!labels.has(p)) labels.set(p, p.name ?? `(internal patch #${i + 1}${p.description ? `: ${p.description}` : ""})`);
    if (!results.has(p)) results.set(p, { name: labels.get(p)!, status: "disabled", required: false, internal: !p.name });
  });

  // ponytail: O(n²) Kahn's algorithm; fine for hundreds of patches.
  const key = (p: Patch) => (p.name ? `0${p.name}` : `1${String(nodes.indexOf(p)).padStart(6, "0")}`);
  const order: Patch[] = [];
  const placed = new Set<Patch>();
  while (order.length < nodes.length) {
    const ready = nodes.filter((p) => !placed.has(p) && (p.dependsOn ?? []).every((d) => placed.has(d)));
    ready.sort((a, b) => (key(a) < key(b) ? -1 : 1));
    placed.add(ready[0]);
    order.push(ready[0]);
  }
  return { order, results, labels };
}

export function resolveOptions(p: Patch, given: Record<string, unknown>): Record<string, unknown> {
  const defs = p.options ?? {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(defs, k)) throw new Error(`unknown option "${k}"`);
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(defs)) {
    const value = Object.hasOwn(given, k) ? given[k] : def.default;
    if (value === undefined) {
      if (def.required) throw new Error(`option "${k}" is required`);
      out[k] = undefined;
      continue;
    }
    const want = def.type === "bool" ? "boolean" : def.type;
    if (typeof value !== want) throw new Error(`option "${k}" must be a ${want}`);
    const problem = def.validate?.(value);
    if (problem) throw new Error(`option "${k}": ${problem}`);
    out[k] = value;
  }
  return out;
}
