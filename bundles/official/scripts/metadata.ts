// bundle.json: what a bundle source fetches to find, verify and describe a published bundle (spec §7.1).
import type { Manifest } from "@revamp/sdk";

export interface BundleJson {
  name: string;
  version: string;
  minEngine: string;
  created_at: string;
  changelog: string;
  download_url: string;
  sha256: string;
}

/** The notes under `## <version>` in a CHANGELOG.md, or "" when it has no such section. */
export function changelogFor(markdown: string, version: string): string {
  const section = markdown.split(/^## /m).slice(1).find((s) => s.slice(0, s.indexOf("\n")).trim() === version);
  return section ? section.slice(section.indexOf("\n") + 1).trim() : "";
}

/** The bundle is published as release `bundle-v<version>` of the repo in `manifest.source`. */
export function bundleJson(manifest: Manifest, sha256: string, changelog: string, now = new Date()): BundleJson {
  const repo = /^github:([\w.-]+\/[\w.-]+)$/.exec(manifest.source)?.[1];
  if (!repo) throw new Error(`manifest.source must be "github:<owner>/<repo>" (it is "${manifest.source}")`);
  return {
    name: manifest.name,
    version: manifest.version,
    minEngine: manifest.minEngine,
    created_at: now.toISOString(),
    changelog,
    download_url: `https://github.com/${repo}/releases/download/bundle-v${manifest.version}/official.mjs`,
    sha256,
  };
}
