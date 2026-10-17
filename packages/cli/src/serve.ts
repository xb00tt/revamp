// revamp serve (spec §9): JSON-RPC 2.0 for the GUI, one message per line on stdin and stdout. Logs go to stderr.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  addSource,
  checkUpdates,
  describe,
  listInstalls,
  listPatches,
  loadLastCheck,
  loadSelection,
  loadSkipped,
  loadSources,
  patchApp,
  prepareSource,
  refreshSources,
  removeSource,
  removeStorageItem,
  rollback,
  skipVersion,
  storageUsage,
  installedPatchNames,
  newPatchesToAsk,
  type BundleDescription,
  type JobProgress,
  type SourceCandidate,
  type UpdateOptions,
} from "@revamp-app/engine";
import { bundleFor, seedDefaultSource } from "./bundle-for.ts";
import { formatPatchResult } from "./format.ts";

export interface ServeOptions extends UpdateOptions {
  log: (line: string) => void;
}

type Params = Record<string, unknown>;
type Notify = (method: string, params: unknown) => void;

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const INVALID_PARAMS = -32602;
const str = (p: Params, key: string): string => {
  if (typeof p[key] !== "string") throw new RpcError(INVALID_PARAMS, `"${key}" must be a string`);
  return p[key] as string;
};
const optional = <T>(p: Params, key: string, ok: (v: unknown) => boolean, type: string): T | undefined => {
  if (p[key] === undefined) return undefined;
  if (!ok(p[key])) throw new RpcError(INVALID_PARAMS, `"${key}" must be ${type}`);
  return p[key] as T;
};
const optStr = (p: Params, key: string) => optional<string>(p, key, (v) => typeof v === "string", "a string");
const optBool = (p: Params, key: string) => optional<boolean>(p, key, (v) => typeof v === "boolean", "true or false");
const optStrs = (p: Params, key: string) => optional<string[]>(p, key, (v) => Array.isArray(v) && v.every((x) => typeof x === "string"), "a list of strings");

/** Answers one JSON-RPC message; returns the response, or undefined for a notification. Jobs report progress through `notify`. */
export function createHandler(o: ServeOptions): (line: string, notify: Notify) => Promise<object | undefined> {
  const bundle = (appId: string) => bundleFor(o.paths, appId, undefined, o.log, o);
  const descriptions = new Map<string, Promise<BundleDescription>>(); // bundles are content-addressed, so a path's description never changes
  const describeOnce = (path: string) => descriptions.get(path) ?? descriptions.set(path, describe(path)).get(path)!;
  const candidates = new Map<string, SourceCandidate>();
  let seeding: Promise<void> | undefined;
  /** The default source goes in on the first request that reads the sources; one try per session. */
  const seeded = () => (seeding ??= seedDefaultSource(o.paths, o.log, o));
  const lastCheck = () => loadLastCheck(o.paths);
  /** A job's log lines and progress go to the window as notifications tagged with its request id; logs also to stderr. */
  const report = (id: unknown, notify: Notify) => ({
    log: (line: string) => {
      o.log(line);
      notify("job.log", { id, line });
    },
    progress: (e: JobProgress) => notify("job.progress", { id, ...e }),
  });

  /** Installed apps plus the apps the sources offer, so a first install starts from the list too. */
  async function apps() {
    await seeded();
    const installs = listInstalls(o.paths);
    const ids = [...new Set([...installs.map((a) => a.appId), ...loadSources(o.paths).flatMap((s) => s.apps)])];
    const list = [];
    for (const id of ids) {
      const installed = installs.find((a) => a.appId === id);
      let name = id;
      try {
        name = (await describeOnce(await bundle(id))).apps.find((a) => a.id === id)?.name ?? id;
      } catch (e) {
        o.log(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const versions = (installed?.versions ?? []).map(({ version, receipt }) => ({
        version,
        installedAt: receipt.installedAt,
        bundle: { name: receipt.bundle.name, version: receipt.bundle.version },
        untested: receipt.release.untested ?? false,
      }));
      list.push({ appId: id, name, current: installed?.current ?? null, versions });
    }
    return { apps: list, lastCheck: lastCheck(), skipped: loadSkipped(o.paths) };
  }

  const methods: Record<string, (p: Params, id: unknown, notify: Notify) => unknown> = {
    "apps.list": () => apps(),
    "patches.list": async (p) => {
      const appId = str(p, "appId");
      const listing = await listPatches(await bundle(appId), appId, optStr(p, "version"));
      const selection = loadSelection(o.paths, appId);
      const ask = newPatchesToAsk(listing.app, listing.patches, listing.version, installedPatchNames(o.paths, appId), selection, {}, !listing.listed || !!listing.app.versions[listing.version]?.experimental).map((x) => x.name);
      return { ...listing, selection, ask };
    },
    "selection.get": (p) => loadSelection(o.paths, str(p, "appId")),
    "job.patch": async (p, id, notify) => {
      const appId = str(p, "appId");
      const result = await patchApp({
        ...o,
        appId,
        bundlePath: await bundle(appId),
        version: optStr(p, "version"),
        force: optBool(p, "force"),
        dryRun: optBool(p, "dryRun"),
        enable: optStrs(p, "enable"),
        disable: optStrs(p, "disable"),
        options: optStrs(p, "options"),
        ...report(id, notify),
      });
      return { result, report: formatPatchResult(result) };
    },
    "install.rollback": (p) => ({ current: rollback(o.paths, str(p, "appId")) }),
    "check.run": (_p, id, notify) => checkUpdates({ ...o, ...report(id, notify) }),
    "check.last": () => lastCheck(),
    "check.skip": (p) => {
      skipVersion(o.paths, str(p, "appId"), p.version === null ? null : str(p, "version"));
      return {};
    },
    "sources.list": async () => {
      await seeded();
      return loadSources(o.paths);
    },
    "sources.prepare": async (p) => {
      const candidate = await prepareSource(o.paths, str(p, "location"), o);
      const token = randomUUID();
      candidates.set(token, candidate);
      const { manifest, apps } = candidate.description;
      return { token, source: candidate.source, manifest, apps: apps.map((a) => ({ id: a.id, name: a.name, versions: Object.keys(a.versions) })), changelog: candidate.changelog };
    },
    // Only a candidate this session prepared can be trusted: the pin is what the user saw, not what a message claims.
    "sources.add": async (p) => {
      const token = str(p, "token");
      const candidate = candidates.get(token);
      if (!candidate) throw new RpcError(INVALID_PARAMS, "that source preview is gone; fetch the source again");
      candidates.delete(token);
      await seeded();
      addSource(o.paths, candidate.source);
      return candidate.source;
    },
    "sources.remove": (p) => removeSource(o.paths, str(p, "location")),
    "sources.refresh": () => refreshSources(o.paths, o),
    "storage.list": () => storageUsage(o.paths),
    "storage.remove": (p) => {
      removeStorageItem(o.paths, str(p, "id"));
      return {};
    },
  };

  return async (line, notify) => {
    let message: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    const id = message?.id;
    const reply = (body: object) => (id === undefined ? undefined : { jsonrpc: "2.0", id, ...body });
    if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } };
    const method = Object.hasOwn(methods, message.method) ? methods[message.method] : undefined;
    if (!method) return reply({ error: { code: -32601, message: `Method not found: ${message.method}` } });
    const params = message.params ?? {};
    if (typeof params !== "object" || params === null || Array.isArray(params)) return reply({ error: { code: INVALID_PARAMS, message: "params must be an object" } });
    try {
      return reply({ result: (await method(params as Params, id, notify)) ?? null });
    } catch (e) {
      return reply({ error: { code: e instanceof RpcError ? e.code : -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  };
}

/** Serves until stdin closes, then waits for running requests to finish. */
export function serve(o: ServeOptions, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const handle = createHandler(o);
  output.on("error", () => {}); // the window closed its end (EPIPE): keep finishing the jobs it started
  const send = (message: object) => void output.write(`${JSON.stringify(message)}\n`);
  const running = new Set<Promise<void>>();
  const lines = createInterface({ input });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const job = handle(line, (method, params) => send({ jsonrpc: "2.0", method, params })).then((response) => response && send(response)).catch((e) => o.log(`serve: ${e instanceof Error ? e.message : String(e)}`));
    running.add(job);
    void job.finally(() => running.delete(job));
  });
  return new Promise((resolve) => lines.on("close", () => void Promise.allSettled([...running]).then(() => resolve())));
}
