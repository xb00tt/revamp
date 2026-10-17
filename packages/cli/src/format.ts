import { patchCounts, type BundleSource, type InstalledApp, type PatchAppResult, type PatchListing, type PatchStatus, type SourceCandidate } from "@revamp-app/engine";

const MARK: Record<PatchStatus, string> = { applied: "✓", failed: "✗", skipped: "–", incompatible: " ", disabled: " " };

export function formatPatchResult(r: PatchAppResult): string {
  const shown = r.results.filter((x) => !x.internal || x.status === "failed");
  // The count is of the patches users choose; a failed internal patch is listed, but as the reason others were skipped.
  const { applied, total } = patchCounts(r.results);
  const outcome = r.aborted
    ? `nothing installed: ${r.aborted}`
    : r.installed
      ? `installed to ${r.installDir}`
      : r.dryRun
        ? "dry run, nothing installed"
        : "not installed";
  const lines = [`${r.appName} ${r.version}${r.untested ? " (untested)" : ""}: ${applied}/${total} patches apply (${outcome})`];
  for (const x of shown) {
    const tag = x.status === "disabled" || x.status === "incompatible" ? ` [${x.status}]` : "";
    lines.push(`  ${MARK[x.status]} ${x.name}${x.required ? " (required)" : ""}${tag}`);
    if (x.message && x.status !== "applied" && x.status !== "incompatible") {
      lines.push(...x.message.split("\n").map((l) => `      ${l}`));
    }
  }
  for (const l of r.logs) lines.push(`  ${l}`);
  for (const w of r.warnings) lines.push(`Note: ${w}`);
  return lines.join("\n");
}

export function formatInstalls(apps: InstalledApp[]): string {
  if (apps.length === 0) return "No Revamped apps installed.";
  const lines: string[] = [];
  for (const a of apps) {
    for (const v of a.versions) {
      // Receipts store UTC; "sv-SE" formats local time as YYYY-MM-DD HH:MM.
      const when = new Date(v.receipt.installedAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
      const patches = v.receipt.patches.filter((p) => p.status === "applied" && !p.internal && !p.required).map((p) => p.name);
      const tags = `${v.version === a.current ? " (current)" : ""}${v.receipt.release.untested ? " (untested)" : ""}`;
      lines.push(`${a.appId} ${v.version}${tags}  installed ${when}  ${patches.join(", ")}`.trimEnd());
    }
  }
  return lines.join("\n");
}

export function formatPatchList(l: PatchListing): string {
  const lines = [
    `${l.app.name} ${l.version}${l.listed ? "" : " (not in this bundle: patching it needs --force)"}, from bundle "${l.bundle.name}" ${l.bundle.version}`,
  ];
  for (const p of l.patches) {
    const versions = (p.apps ?? []).filter((a) => a.app === l.app.id).flatMap((a) => a.versions ?? []);
    const state = p.required ? "required" : !p.compatible ? `only for ${versions.join(", ")}` : p.default ? "on by default" : "off by default";
    lines.push(`  ${p.name}  [${state}]`);
    if (p.description) lines.push(`      ${p.description}`);
    for (const [key, o] of Object.entries(p.options)) {
      const preset = o.default === null ? "" : `, default ${JSON.stringify(o.default)}`;
      lines.push(`      --option "${p.name}:${key}=<${o.type}>"  ${o.title}${preset}`);
      if (o.description) lines.push(`          ${o.description}`);
    }
  }
  return lines.join("\n");
}

/** A newline in a one-line field would fake a line of its own (printable() keeps newlines for the changelog). */
const oneLine = (text: string) => text.replaceAll("\n", "\\x0a");

/** What `revamp sources add` shows before asking: the manifest, the apps and versions, and the hash to pin. */
export function formatSourceCandidate(c: SourceCandidate): string {
  const m = c.description.manifest;
  const apps = c.description.apps.map((a) => `${a.name} ${Object.keys(a.versions).join(", ")}`).join("; ");
  return [
    oneLine(`Bundle "${m.name}" ${m.version} by ${m.author} (${m.license}), from ${c.source.location}`),
    oneLine(`  Apps: ${apps}`),
    `  SHA-256: ${c.source.sha256}`,
    ...(c.changelog ? ["", ...c.changelog.split("\n").map((l) => `  ${l}`)] : []),
  ].join("\n");
}

export function formatSources(sources: BundleSource[]): string {
  if (sources.length === 0) return "No bundle sources. Add one: revamp sources add xb00tt/revamp";
  return sources
    .map((s) => `${oneLine(s.location)}\n${oneLine(`  "${s.name}" ${s.version} (${s.kind}), apps: ${s.apps.join(", ")}`)}\n  SHA-256: ${s.sha256}`)
    .join("\n");
}

/** Text with terminal control characters (all but newline and tab) shown as \xNN, so bundle text can't rewrite the screen. */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}
