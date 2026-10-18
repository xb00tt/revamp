// Pure helpers for scripts/release-app.ts (no I/O, so test/release-app-files.test.ts covers them).
export const releaseAssetName = (version: string) => `revamp-${version}-linux-x86_64.tar.gz`;
export const releaseDirName = (version: string) => `revamp-${version}-linux-x86_64`;

/** The body of the "## <version>" section, up to the next "## " heading, trimmed. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === `## ${version}`);
  if (start < 0) throw new Error(`add a "## ${version}" section to CHANGELOG.md`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** One line of a SHA256SUMS file: two spaces between hash and name, as `sha256sum -c` reads it. */
export const sha256sumsLine = (sha256: string, file: string) => `${sha256}  ${file}\n`;

/** The README.txt shipped in the tarball. */
export const releaseReadme = (v: string) => `Revamp ${v} for Linux x86_64

Install for your user (no root):
  ./revamp self-install

This puts revamp in ~/.local/share/revamp/bin (linked from ~/.local/bin/revamp) and
"Revamp" in your applications menu. Then:
  revamp patch hydra        (or: revamp patch heroic)
  revamp timer enable       (a daily check for app releases and new patches)

The window needs WebKitGTK 4.1: sudo apt install libwebkit2gtk-4.1-0
More: https://github.com/xb00tt/revamp
`;
