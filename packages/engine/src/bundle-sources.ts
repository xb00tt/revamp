// Bundle sources (spec §7.2): where bundles come from, each pinned to the SHA-256 the user confirmed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe } from "./api.ts";
import { downloadVerified, fileSha256 } from "./download.ts";
import type { BundleDescription } from "./job.ts";
import type { Paths } from "./paths.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

export type SourceKind = "github" | "url" | "file";

export interface BundleSource {
  /** What the user added: "owner/repo", the URL of a bundle.json, or the absolute path of a .mjs file. */
  location: string;
  kind: SourceKind;
  name: string;
  version: string;
  /** The pin. The bundle is cached as bundles/<sha256>.mjs and checked against it before each use. */
  sha256: string;
  /** Where the pinned bundle came from (github and url sources), to fetch it again if the cache was cleared. */
  downloadUrl?: string;
  /** The app ids the bundle defines, so choosing a bundle for an app needs no sandbox run. */
  apps: string[];
  /** The notes its bundle.json gave for this version (GitHub and URL sources). */
  changelog?: string;
}

export interface SourceFetchOptions {
  fetch?: typeof fetch;
  /** Tests point these at a local server; they default to https://raw.githubusercontent.com and https://api.github.com. */
  rawBaseUrl?: string;
  apiBaseUrl?: string;
}

/** A bundle fetched, verified, cached and described, but not yet trusted: what `sources add` shows before asking. */
export interface SourceCandidate {
  source: BundleSource;
  bundlePath: string;
  description: BundleDescription;
  changelog: string;
}

interface BundleJson {
  name: string;
  version: string;
  sha256: string;
  download_url: string;
  changelog: string;
}

const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;

export function sourceKind(location: string): SourceKind {
  if (location.endsWith(".mjs")) return "file";
  if (/^https?:\/\//.test(location)) return "url";
  if (GITHUB_REPO.test(location) && !location.split("/").some((p) => p === "." || p === "..")) return "github";
  throw new Error(`"${location}" is not a bundle source: use owner/repo, the https URL of a bundle.json, or a .mjs file`);
}

/** https only; plain http just for loopback, which is what tests serve. */
function assertHttps(what: string, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} "${url}" is not a URL`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) {
    throw new Error(`${what} "${url}" must use https`);
  }
  return url;
}

async function getJson(url: string, o: SourceFetchOptions, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await (o.fetch ?? fetch)(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A GitHub source's bundle.json is on its default branch: raw.githubusercontent.com first, then the API (spec §7.2). */
async function fetchBundleJson(source: Pick<BundleSource, "kind" | "location">, o: SourceFetchOptions): Promise<BundleJson> {
  let data: unknown;
  if (source.kind === "url") {
    data = await getJson(assertHttps("bundle.json URL", source.location), o).catch((e: Error) => {
      throw new Error(`couldn't fetch ${source.location}: ${e.message}`);
    });
  } else {
    const raw = `${o.rawBaseUrl ?? "https://raw.githubusercontent.com"}/${source.location}/HEAD/bundle.json`;
    const api = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${source.location}/contents/bundle.json`;
    data = await getJson(raw, o).catch((rawError: Error) =>
      getJson(api, o, { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28" }).catch((apiError: Error) => {
        throw new Error(`couldn't fetch bundle.json from ${source.location} (raw.githubusercontent.com: ${rawError.message}; GitHub API: ${apiError.message})`);
      }),
    );
  }
  const j = data as Partial<Record<keyof BundleJson, unknown>> | null;
  if (typeof j?.name !== "string" || typeof j.version !== "string" || typeof j.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(j.sha256) || typeof j.download_url !== "string") {
    throw new Error(`the bundle.json of ${source.location} needs name, version, sha256 and download_url`);
  }
  return { name: j.name, version: j.version, sha256: j.sha256, download_url: assertHttps("download_url", j.download_url), changelog: typeof j.changelog === "string" ? j.changelog : "" };
}

const cachePath = (paths: Paths, sha256: string) => join(paths.cache, "bundles", `${sha256}.mjs`);

/** Copies a local bundle into the cache and returns the SHA-256 of the copy, the bytes that will be used. */
async function cacheFile(paths: Paths, file: string): Promise<string> {
  const part = join(paths.cache, "bundles", `.${process.pid}.part`);
  mkdirSync(join(paths.cache, "bundles"), { recursive: true });
  try {
    copyFileSync(file, part);
    const sha256 = await fileSha256(part);
    renameSync(part, cachePath(paths, sha256));
    return sha256;
  } finally {
    rmSync(part, { force: true });
  }
}

/** Fetches, verifies, caches and describes a source's bundle (in the sandbox). Nothing is saved. */
export async function prepareSource(paths: Paths, location: string, o: SourceFetchOptions = {}): Promise<SourceCandidate> {
  const kind = sourceKind(location);
  let source: BundleSource;
  let changelog = "";
  if (kind === "file") {
    const file = resolve(location);
    if (!existsSync(file)) throw new Error(`${file} doesn't exist`);
    const sha256 = await cacheFile(paths, file);
    source = { location: file, kind, name: "", version: "", sha256, apps: [] };
  } else {
    const j = await fetchBundleJson({ kind, location }, o);
    await downloadVerified({ url: j.download_url, dest: cachePath(paths, j.sha256), sha256: j.sha256, fetch: o.fetch });
    source = { location, kind, name: j.name, version: j.version, sha256: j.sha256, downloadUrl: j.download_url, apps: [], ...(j.changelog && { changelog: j.changelog }) };
    changelog = j.changelog;
  }
  const bundlePath = cachePath(paths, source.sha256);
  const description = await describe(bundlePath);
  const { name, version, minEngine } = description.manifest;
  if (kind !== "file" && (name !== source.name || version !== source.version)) {
    throw new Error(`${location}: bundle.json describes "${source.name}" ${source.version}, but the bundle is "${name}" ${version}`);
  }
  if (compareVersions(minEngine, ENGINE_VERSION) > 0) throw new Error(`bundle "${name}" needs Revamp ${minEngine} or newer (this is ${ENGINE_VERSION})`);
  return { source: { ...source, name, version, apps: description.apps.map((a) => a.id) }, bundlePath, description, changelog };
}

const sourcesFile = (paths: Paths) => join(paths.config, "sources.json");

export function loadSources(paths: Paths): BundleSource[] {
  const file = sourcesFile(paths);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { sources?: BundleSource[] };
  if (!Array.isArray(data.sources)) throw new Error(`${file} has no "sources" list`);
  return data.sources;
}

function saveSources(paths: Paths, sources: BundleSource[]): void {
  mkdirSync(paths.config, { recursive: true });
  const file = sourcesFile(paths);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ sources }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

const sameLocation = (s: BundleSource, location: string) => s.location === (sourceKind(location) === "file" ? resolve(location) : location);

export function addSource(paths: Paths, source: BundleSource): void {
  const sources = loadSources(paths);
  if (sources.some((s) => sameLocation(s, source.location))) throw new Error(`${source.location} is already a source; remove it first to add it again`);
  saveSources(paths, [...sources, source]);
}

export function removeSource(paths: Paths, location: string): BundleSource {
  const sources = loadSources(paths);
  const found = sources.find((s) => sameLocation(s, location));
  if (!found) throw new Error(`${location} is not a source (see revamp sources list)`);
  saveSources(paths, sources.filter((s) => s !== found));
  return found;
}

/**
 * Moves the pin of each GitHub source whose bundle.json has a new version, after verifying the new bundle against
 * that bundle.json (the repo is the trust anchor). URL and file sources stay pinned to the exact hash the user added.
 * A source that can't be refreshed keeps its pin; the returned lines say what changed or failed.
 */
export async function refreshSources(paths: Paths, o: SourceFetchOptions = {}): Promise<string[]> {
  const lines: string[] = [];
  const moved = new Map<string, BundleSource>(); // location → its new pin
  for (const s of loadSources(paths)) {
    if (s.kind !== "github") continue;
    try {
      const j = await fetchBundleJson(s, o);
      if (j.version === s.version) continue;
      const next = (await prepareSource(paths, s.location, o)).source;
      moved.set(s.location, next);
      lines.push(`${s.location}: "${s.name}" ${s.version} → ${next.version}${j.changelog ? `\n${j.changelog}` : ""}`);
    } catch (e) {
      lines.push(`${s.location}: not refreshed, still using ${s.version}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Read the list again: a `sources add/remove` (the window, the CLI) may have landed while this one was fetching.
  if (moved.size) saveSources(paths, loadSources(paths).map((s) => moved.get(s.location) ?? s));
  return lines;
}

export interface SourceChoice {
  bundlePath: string;
  source: BundleSource;
  warnings: string[];
}

/** The pinned bundle of the first source that defines the app (spec §7.2: first wins), checked against its pin. */
export async function bundleForApp(paths: Paths, appId: string, o: SourceFetchOptions = {}): Promise<SourceChoice | undefined> {
  const matches = loadSources(paths).filter((s) => s.apps.includes(appId));
  const source = matches[0];
  if (!source) return undefined;
  const warnings = matches.length > 1 ? [`"${appId}" is in ${matches.length} bundle sources (${matches.map((s) => s.location).join(", ")}); using ${source.location}`] : [];
  const bundlePath = cachePath(paths, source.sha256);
  if (source.downloadUrl) {
    await downloadVerified({ url: source.downloadUrl, dest: bundlePath, sha256: source.sha256, fetch: o.fetch });
  } else if (!existsSync(bundlePath) || (await fileSha256(bundlePath)) !== source.sha256) {
    rmSync(bundlePath, { force: true });
    if (!existsSync(source.location) || (await cacheFile(paths, source.location)) !== source.sha256) {
      throw new Error(`${source.location} changed since it was added as a source; add it again (revamp sources remove, then add) to trust the new file`);
    }
  }
  if (source.kind === "file" && (!existsSync(source.location) || (await fileSha256(source.location)) !== source.sha256)) {
    warnings.push(`${source.location} changed since it was added; still using the pinned copy (revamp sources remove, then add, to trust the new file)`);
  }
  return { bundlePath, source, warnings };
}
