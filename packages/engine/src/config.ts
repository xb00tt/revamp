import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
