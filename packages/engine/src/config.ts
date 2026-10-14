import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppInfo, PatchInfo } from "./job.ts";
import { assertSafeName, type Paths } from "./paths.ts";

export interface Selection {
  enable: string[];
  disable: string[];
  /** patch name → option key → value */
  options: Record<string, Record<string, unknown>>;
}

const selectionFile = (p: Paths, appId: string) => join(p.config, "apps", `${assertSafeName("app id", appId)}.json`);

export function loadSelection(p: Paths, appId: string): Selection {
  try {
    const s = JSON.parse(readFileSync(selectionFile(p, appId), "utf8"));
    return { enable: s.enable ?? [], disable: s.disable ?? [], options: s.options ?? {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { enable: [], disable: [], options: {} };
    throw e;
  }
}

export function saveSelection(p: Paths, appId: string, s: Selection): void {
  const file = selectionFile(p, appId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

/** Applies --enable/--disable flags on top of the saved selection; the last word wins per patch. */
export function mergeSelection(saved: Selection, flags: { enable?: string[]; disable?: string[] }): Selection {
  const enable = new Set(saved.enable);
  const disable = new Set(saved.disable);
  for (const n of flags.enable ?? []) {
    enable.add(n);
    disable.delete(n);
  }
  for (const n of flags.disable ?? []) {
    disable.add(n);
    enable.delete(n);
  }
  return { enable: [...enable], disable: [...disable], options: saved.options };
}

/** The `--option "<patch>:<key>=<value>"` flag, split. The value is converted to the option's type by resolveSelection. */
export function parseOptionFlag(flag: string): { patch: string; key: string; value: string } {
  const eq = flag.indexOf("=");
  const colon = eq === -1 ? -1 : flag.lastIndexOf(":", eq);
  if (colon <= 0 || eq === colon + 1) throw new Error(`--option "${flag}" must look like "<patch>:<key>=<value>"`);
  return { patch: flag.slice(0, colon), key: flag.slice(colon + 1, eq), value: flag.slice(eq + 1) };
}

export interface SelectionFlags {
  enable?: string[];
  disable?: string[];
  /** Raw `--option` values. */
  options?: string[];
}

/**
 * Checks saved choices and flags against the patches a bundle offers for one app, before anything is downloaded.
 * Saved names the bundle no longer has are dropped with a warning; bad flags are errors.
 */
export function resolveSelection(
  app: AppInfo,
  patches: PatchInfo[],
  saved: Selection,
  flags: SelectionFlags,
): { selection: Selection; warnings: string[] } {
  const known = new Map(patches.map((p) => [p.name, p]));
  const required = new Set(app.required);
  const warnings: string[] = [];
  const drop = (what: string, why: string) => void warnings.push(`Dropped ${what} from your saved choices for ${app.name}: ${why}.`);
  const GONE = "this bundle no longer has that patch";
  const clean: Selection = { enable: [], disable: [], options: {} };
  for (const n of saved.enable) {
    if (known.has(n)) clean.enable.push(n);
    else drop(`"${n}"`, GONE);
  }
  for (const n of saved.disable) {
    if (!known.has(n)) drop(`"${n}"`, GONE);
    else if (required.has(n)) drop(`"${n}"`, "it is required now, so it can't be disabled");
    else clean.disable.push(n);
  }
  for (const [n, values] of Object.entries(saved.options)) {
    const p = known.get(n);
    if (!p) {
      drop(`the options of "${n}"`, GONE);
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (Object.hasOwn(p.options, key)) clean.options = withOption(clean.options, n, key, value);
      else drop(`option "${n}:${key}"`, "the patch no longer has that option");
    }
  }

  const unknown = (name: string) => new Error(`${app.name} has no patch "${name}" (see: revamp patches ${app.id})`);
  for (const n of [...(flags.enable ?? []), ...(flags.disable ?? [])]) if (!known.has(n)) throw unknown(n);
  for (const n of flags.disable ?? []) if (required.has(n)) throw new Error(`"${n}" is required for ${app.name} and can't be disabled`);
  const selection = mergeSelection(clean, flags);
  for (const flag of flags.options ?? []) {
    const { patch, key, value } = parseOptionFlag(flag);
    const p = known.get(patch);
    if (!p) throw unknown(patch);
    if (!Object.hasOwn(p.options, key)) {
      throw new Error(`"${patch}" has no option "${key}" (it has: ${Object.keys(p.options).join(", ") || "none"})`);
    }
    selection.options = withOption(selection.options, patch, key, parseOptionValue(p.options[key].type, value, flag));
  }
  return { selection, warnings };
}

/** Copies instead of assigning, so a name like "__proto__" from a bundle stays an ordinary key. */
const withOption = (options: Selection["options"], patch: string, key: string, value: unknown): Selection["options"] => ({
  ...options,
  [patch]: { ...(Object.hasOwn(options, patch) ? options[patch] : {}), [key]: value },
});

function parseOptionValue(type: string, raw: string, flag: string): unknown {
  if (type === "string") return raw;
  if (type === "bool" && (raw === "true" || raw === "false")) return raw === "true";
  if (type === "number" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  throw new Error(`--option "${flag}": the value must be ${type === "bool" ? "true or false" : "a number"}`);
}
