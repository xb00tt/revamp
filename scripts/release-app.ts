// npm run release:app (the owner, by hand, after publish:packages): builds the CLI and the window, packs them with the
// icon, README and LICENSE as revamp-<version>-linux-x86_64.tar.gz, writes SHA256SUMS, and creates the GitHub release
// v<version> on xb00tt/revamp with both files (spec §7). The tag is publish:packages' tag: it must point at HEAD.
// With --pack <dir> it only builds and copies the two files there: no git or gh checks, nothing published.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ENGINE_VERSION } from "../packages/engine/src/version.ts";
import { PUBLISHED, versionProblem } from "./publish-manifest.ts";
import { changelogSection, releaseAssetName, releaseDirName, releaseReadme, sha256sumsLine } from "./release-app-files.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const REPO = "xb00tt/revamp";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const succeeds = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, stdio: "ignore" }).status === 0;
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

const { values } = parseArgs({ options: { pack: { type: "string" } } });
const packDir = values.pack === undefined ? undefined : resolve(values.pack);

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("the release is Linux x86_64: build it on a Linux x86_64 machine");
const version = ENGINE_VERSION;
const versions = Object.fromEntries([...PUBLISHED, "gui"].map((name) => [name, json(`packages/${name}/package.json`).version as string]));
versions["tauri.conf.json"] = json("packages/gui/src-tauri/tauri.conf.json").version;
versions["Cargo.toml"] = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, "packages/gui/src-tauri/Cargo.toml"), "utf8"))?.[1] ?? "missing";
const problem = versionProblem(versions, version);
if (problem) throw new Error(problem);
const notes = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version);

const tag = `v${version}`;
if (!packDir) {
  if (git("status", "--porcelain")) throw new Error("commit your changes first: the release must match a commit");
  const tagged = succeeds("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]) ? git("rev-parse", `${tag}^{commit}`) : "";
  if (!tagged || tagged !== git("rev-parse", "HEAD")) throw new Error(`tag ${tag} must be on this commit: run npm run publish:packages first (it publishes to npm and tags)`);
  if (succeeds("gh", ["release", "view", tag, "--repo", REPO])) throw new Error(`${tag} already has a GitHub release`);
}

run("npm", ["run", "build", "-w", "@revamp-app/cli"]);
run("npm", ["run", "tauri:build", "-w", "@revamp-app/gui"]);

const tmp = mkdtempSync(join(tmpdir(), "revamp-release-"));
try {
  const asset = releaseAssetName(version);
  const dirName = releaseDirName(version);
  const stage = join(tmp, dirName);
  mkdirSync(stage);
  const tauri = join(root, "packages/gui/src-tauri");
  copyFileSync(join(root, "packages/cli/dist/revamp"), join(stage, "revamp"));
  copyFileSync(join(tauri, "target/release/revamp-gui"), join(stage, "revamp-gui"));
  copyFileSync(join(tauri, "icons/icon.png"), join(stage, "revamp.png"));
  copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));
  writeFileSync(join(stage, "README.txt"), releaseReadme(version));
  chmodSync(join(stage, "revamp"), 0o755);
  chmodSync(join(stage, "revamp-gui"), 0o755);
  run("tar", ["-czf", join(tmp, asset), "-C", tmp, dirName]);
  const sums = join(tmp, "SHA256SUMS");
  writeFileSync(sums, sha256sumsLine(createHash("sha256").update(readFileSync(join(tmp, asset))).digest("hex"), asset));

  if (packDir) {
    mkdirSync(packDir, { recursive: true });
    for (const f of [asset, "SHA256SUMS"]) copyFileSync(join(tmp, f), join(packDir, f));
    console.log(`Packed ${asset} and SHA256SUMS into ${packDir} (staging left in ${tmp}).`);
  } else {
    run("gh", ["release", "create", tag, join(tmp, asset), sums, "--repo", REPO, "--verify-tag", "--title", `Revamp ${version}`, "--notes", notes]);
    console.log(`Released https://github.com/${REPO}/releases/tag/${tag}`);
  }
} catch (e) {
  console.error(`left ${tmp} for inspection`);
  throw e;
}
