/** Reads the [Desktop Entry] group of a .desktop file as an ordered key → value map. */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inGroup = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inGroup = line === "[Desktop Entry]";
      continue;
    }
    if (!inGroup || line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const KEY = /^[A-Za-z0-9-]+(\[[A-Za-z0-9_@.-]+\])?$/;

export function serializeDesktopEntry(entry: Record<string, string>): string {
  const lines = ["[Desktop Entry]"];
  for (const [key, value] of Object.entries(entry)) {
    if (!KEY.test(key)) throw new Error(`invalid desktop entry key ${JSON.stringify(key)}`);
    lines.push(`${key}=${value.replace(/[\r\n]+/g, " ")}`);
  }
  return lines.join("\n") + "\n";
}
