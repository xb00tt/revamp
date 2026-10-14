import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { debFrom, tarArchive, tarEntry } from "./archives.ts";

/**
 * Writes a self-contained bundle: plain objects and no imports, shaped like esbuild's output for a real bundle.
 * `extra` is JavaScript run before the exports; it can push to `patches` and `app.required`.
 */
export function writeDemoBundle(path: string, o: { sha256: string; minEngine?: string; extra?: string }): void {
  writeFileSync(
    path,
    `const app = {
  kind: "app", id: "demo", name: "Demo",
  release: { github: "example/demo", tag: "v{version}", asset: "demo_{version}_amd64.deb" },
  installDir: "opt/Demo", executable: "demo", desktopFile: "usr/share/applications/demo.desktop",
  versions: { "1.0.0": { sha256: "${o.sha256}" }, "2.0.0": { sha256: "${"0".repeat(64)}", experimental: true } },
  required: [],
};
const greeting = { kind: "fingerprint", name: "greeting", strings: ['"hello"'], pattern: 'console.log("hello")' };
const patches = [{
  kind: "patch", name: "Say goodbye", compatibleWith: [{ app }],
  execute(ctx) {
    ctx.match(greeting).replace('console.log("goodbye")');
    ctx.desktopEntry.Name = "Demo (Revamped)";
  },
}];
${o.extra ?? ""}
export const manifest = { name: "Demo bundle", version: "1.0.0", minEngine: "${o.minEngine ?? "0.1.0"}", author: "test", license: "GPL-3.0-only", source: "test" };
export const apps = [app];
export { patches };
`,
  );
}

/** An app.asar holding package.json and out/main.js (which logs "hello"). */
export async function demoAsar(): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "revamp-demo-src-"));
  mkdirSync(join(src, "out"));
  writeFileSync(join(src, "out/main.js"), 'console.log("hello");\n');
  writeFileSync(join(src, "package.json"), '{"name":"demo","main":"out/main.js"}\n');
  const archive = join(mkdtempSync(join(tmpdir(), "revamp-demo-asar-")), "app.asar");
  await createPackageWithOptions(src, archive, {});
  return readFileSync(archive);
}

/** An installed-app tree: <dir>/resources/app.asar. */
export async function writeDemoApp(dir: string): Promise<void> {
  mkdirSync(join(dir, "resources"), { recursive: true });
  writeFileSync(join(dir, "resources/app.asar"), await demoAsar());
}

/** A .deb shaped like Hydra's: the app under opt/Demo, a desktop file and two icon sizes. */
export async function demoDeb(extra: Buffer[] = []): Promise<Buffer> {
  return debFrom(
    tarArchive([
      tarEntry("./opt/Demo/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/Demo/demo", "#!/bin/sh\necho demo\n", { mode: 0o755 }),
      tarEntry("./opt/Demo/resources/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/Demo/resources/app.asar", await demoAsar()),
      tarEntry(
        "./usr/share/applications/demo.desktop",
        "[Desktop Entry]\nName=Demo\nExec=/opt/Demo/demo %U\nIcon=demo\nType=Application\nMimeType=x-scheme-handler/demo;\n",
      ),
      tarEntry("./usr/share/icons/hicolor/64x64/apps/demo.png", "small-png"),
      tarEntry("./usr/share/icons/hicolor/256x256/apps/demo.png", "big-png"),
      ...extra,
    ]),
    "gz",
  );
}
