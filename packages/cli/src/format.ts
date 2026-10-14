import type { InstalledApp, PatchAppResult, PatchListing, PatchStatus } from "@revamp/engine";

const MARK: Record<PatchStatus, string> = { applied: "✓", failed: "✗", skipped: "–", incompatible: " ", disabled: " " };

export function formatPatchResult(r: PatchAppResult): string {
  const shown = r.results.filter((x) => !x.internal || x.status === "failed");
  // The count is of the patches users choose; a failed internal patch is listed, but as the reason others were skipped.
  const ran = shown.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
  const applied = ran.filter((x) => x.status === "applied").length;
  const outcome = r.aborted
    ? `nothing installed: ${r.aborted}`
    : r.installed
      ? `installed to ${r.installDir}`
      : r.dryRun
        ? "dry run, nothing installed"
        : "not installed";
  const lines = [`${r.appName} ${r.version}${r.untested ? " (untested)" : ""}: ${applied}/${ran.length} patches apply (${outcome})`];
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
