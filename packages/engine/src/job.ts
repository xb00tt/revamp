import { parse } from "acorn";
import type { AppDef, Manifest, Patch, PatchContext, TextFile } from "@revamp/sdk";
import { assertAsarPath } from "./asar.ts";
import type { Selection } from "./config.ts";
import { EditBuffer } from "./edits.ts";
import { Fingerprints } from "./fingerprint.ts";
import { planPatches, resolveOptions, type PatchResult } from "./graph.ts";
import { PARSE_OPTIONS } from "./pattern.ts";
import { Sources, type SourceStore } from "./sources.ts";

export const ASAR_PATH = "resources/app.asar";

export interface BundleModule {
  manifest: Manifest;
  apps: AppDef[];
  patches: Patch[];
}

export interface JobInput {
  appId: string;
  version: string;
  selection: Selection;
  force: boolean;
  stockDesktop: Record<string, string>;
}

export interface JobOutput {
  results: PatchResult[];
  /** Set when a required patch did not apply; nothing may be installed then. */
  aborted: string | undefined;
  /** Changed and added files inside app.asar. */
  outputs: Map<string, Buffer>;
  desktopEntry: Record<string, string>;
  logs: string[];
}

/** What the sandboxed runner prints for a patch job (outputs are written to files). */
export interface SandboxPatchOutput {
  results: PatchResult[];
  aborted: string | null;
  files: string[];
  desktopEntry: Record<string, string>;
  logs: string[];
}

type DesktopChanges = Record<string, string | null>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function runJob(bundle: BundleModule, input: JobInput, store: SourceStore): JobOutput {
  const app = bundle.apps.find((a) => a.id === input.appId);
  if (!app) throw new Error(`bundle "${bundle.manifest.name}" has no app "${input.appId}"`);
  const plan = planPatches(app, input.version, bundle.patches, input.selection, input.force);
  const sources = new Sources(store);
  const edits = new EditBuffer();
  const fingerprints = new Fingerprints({ sources, edits });
  const added = new Map<Patch, Map<string, Buffer>>();
  const desktop = new Map<Patch, DesktopChanges>();
  const options = new Map<Patch, Record<string, unknown>>();
  const logs: string[] = [];

  const result = (p: Patch) => plan.results.get(p)!;
  const label = (p: Patch) => plan.labels.get(p)!;
  const applied = (p: Patch) => result(p).status === "applied";
  const failedDependency = (p: Patch) => (p.dependsOn ?? []).find((d) => !applied(d));
  const discard = (p: Patch) => {
    edits.drop(label(p));
    added.delete(p);
    desktop.delete(p);
  };
  const desktopSoFar = () => mergeDesktop(input.stockDesktop, plan.order.filter(applied).map((p) => desktop.get(p)));

  const runPhase = (p: Patch, phase: "execute" | "finalize") => {
    const base = desktopSoFar();
    const draft = { ...base };
    const files = new Map(added.get(p));
    edits.current = label(p);
    try {
      const ctx: PatchContext = {
        app: { id: app.id, version: input.version },
        options: options.get(p)! as PatchContext["options"],
        match(fp) {
          if ((fp.count ?? "one") !== "one") throw new Error(`fingerprint "${fp.name}" can match many times; use ctx.matchAll`);
          return fingerprints.resolve(fp)[0];
        },
        matchAll(fp) {
          if ((fp.count ?? "one") !== "many") throw new Error(`fingerprint "${fp.name}" matches exactly once; use ctx.match`);
          return fingerprints.resolve(fp);
        },
        file: (path) => textFile(sources, edits, path),
        addFile(path, contents) {
          assertAsarPath(path);
          if (sources.has(path)) throw new Error(`addFile("${path}"): the app already has that file`);
          files.set(path, Buffer.from(contents));
        },
        desktopEntry: draft,
        log: (m) => void logs.push(`[${label(p)}] ${m}`),
      };
      p[phase]!(ctx);
      added.set(p, files);
      desktop.set(p, { ...desktop.get(p), ...diff(base, draft) });
    } finally {
      edits.current = undefined;
    }
  };

  for (const p of plan.order) {
    const r = result(p);
    const bad = failedDependency(p);
    if (bad) {
      r.status = "skipped";
      r.message = `dependency "${label(bad)}" ${result(bad).status}`;
      continue;
    }
    try {
      options.set(p, resolveOptions(p, input.selection.options[p.name ?? ""] ?? {}));
      runPhase(p, "execute");
      r.status = "applied";
    } catch (e) {
      r.status = "failed";
      r.message = message(e);
      discard(p);
    }
  }
  for (const p of [...plan.order].reverse()) {
    if (!applied(p) || !p.finalize) continue;
    try {
      runPhase(p, "finalize");
    } catch (e) {
      result(p).status = "failed";
      result(p).message = `finalize: ${message(e)}`;
      discard(p);
    }
  }
  for (const p of plan.order) {
    const bad = failedDependency(p);
    if (applied(p) && bad) {
      result(p).status = "skipped";
      result(p).message = `dependency "${label(bad)}" ${result(bad).status}`;
      discard(p);
    }
  }

  const results = [...plan.results.values()];
  const broken = results.find((r) => r.required && r.status !== "applied");
  if (broken) {
    const why = `required patch "${broken.name}" ${broken.status}${broken.message ? `: ${broken.message}` : ""}`;
    return { results, aborted: why, outputs: new Map(), desktopEntry: input.stockDesktop, logs };
  }

  const keep = new Set(plan.order.filter(applied).map(label));
  const outputs = new Map<string, Buffer>();
  for (const file of edits.files(keep)) {
    const text = edits.apply(file, sources.text(file), keep);
    if (/\.(c|m)?js$/.test(file)) assertParses(file, text, edits.patchesFor(file, keep));
    outputs.set(file, Buffer.from(text, "utf8"));
  }
  for (const p of plan.order.filter(applied)) {
    for (const [path, buf] of added.get(p) ?? []) {
      if (outputs.has(path)) throw new Error(`two patches write "${path}"`);
      outputs.set(path, buf);
    }
  }
  return { results, aborted: undefined, outputs, desktopEntry: desktopSoFar(), logs };
}

function textFile(sources: Sources, edits: EditBuffer, path: string): TextFile {
  const original = sources.text(assertAsarPath(path));
  const set = (text: string) => edits.record(path, 0, original.length, text);
  return {
    path,
    text: original,
    setText: set,
    json: <T,>() => JSON.parse(original) as T,
    setJson: (value) => set(JSON.stringify(value, null, 2) + "\n"),
  };
}

function assertParses(file: string, text: string, patches: string[]): void {
  try {
    parse(text, PARSE_OPTIONS);
  } catch (e) {
    if (!file.endsWith(".mjs")) {
      try {
        parse(text, { ...PARSE_OPTIONS, sourceType: "script" });
        return;
      } catch {
        // report the module error below
      }
    }
    const by = patches.map((p) => `"${p}"`).join(", ");
    throw new Error(`patched ${file} is not valid JavaScript (${message(e)}); edited by ${by}`);
  }
}

function diff(base: Record<string, string>, draft: Record<string, string>): DesktopChanges {
  const out: DesktopChanges = {};
  for (const [k, v] of Object.entries(draft)) if (base[k] !== v) out[k] = String(v);
  for (const k of Object.keys(base)) if (!Object.hasOwn(draft, k)) out[k] = null;
  return out;
}

function mergeDesktop(stock: Record<string, string>, changes: Array<DesktopChanges | undefined>): Record<string, string> {
  const out = { ...stock };
  for (const c of changes) {
    for (const [k, v] of Object.entries(c ?? {})) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
  }
  return out;
}

export interface AppInfo {
  id: string;
  name: string;
  release: AppDef["release"];
  installDir: string;
  executable: string;
  desktopFile: string;
  versions: AppDef["versions"];
  required: string[];
}

export interface PatchInfo {
  name: string;
  description: string;
  apps: Array<{ app: string; versions: string[] | null }> | null;
  default: boolean;
  options: Record<string, { type: string; title: string; description: string; default: unknown }>;
}

export interface BundleDescription {
  manifest: Manifest;
  apps: AppInfo[];
  patches: PatchInfo[];
}

/** Plain-JSON view of a bundle: what patches.json holds and what the parent process may read. */
export function describeBundle(b: BundleModule): BundleDescription {
  return {
    manifest: { ...b.manifest },
    apps: b.apps.map((a) => ({
      id: a.id,
      name: a.name,
      release: { ...a.release },
      installDir: a.installDir,
      executable: a.executable,
      desktopFile: a.desktopFile,
      versions: structuredClone(a.versions),
      required: a.required.map((p) => p.name ?? "(internal)"),
    })),
    patches: b.patches
      .filter((p) => p.name)
      .map((p) => ({
        name: p.name!,
        description: p.description ?? "",
        apps: p.compatibleWith ? p.compatibleWith.map((c) => ({ app: c.app.id, versions: c.versions ?? null })) : null,
        default: p.compatibleWith ? p.default !== false : false,
        options: Object.fromEntries(
          Object.entries(p.options ?? {}).map(([k, d]) => [k, { type: d.type, title: d.title, description: d.description ?? "", default: d.default ?? null }]),
        ),
      })),
  };
}
