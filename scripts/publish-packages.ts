// npm run publish:packages (the owner, by hand): compiles @revamp-app/{sdk,engine,cli} into a temp dir, publishes them
// to npm in that order, then tags the commit v<version> and pushes the tag, so every npm version maps to a commit
// (split design §4.4). Inside Revamp nothing is compiled; only the published packages hold JavaScript and .d.ts.
// With --pack <dir> it packs the three .tgz files there instead and publishes nothing: only the version check runs, no tag.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ENGINE_VERSION } from "../packages/engine/src/version.ts";
import { PUBLISHED, publishedManifest, versionProblem } from "./publish-manifest.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const succeeds = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, stdio: "ignore" }).status === 0;

const { values } = parseArgs({ options: { pack: { type: "string" } } });
const packDir = values.pack === undefined ? undefined : resolve(values.pack);

const manifests = Object.fromEntries(PUBLISHED.map((name) => [name, JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"))]));
const { engines } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = ENGINE_VERSION;
const problem = versionProblem(Object.fromEntries(PUBLISHED.map((name) => [name, manifests[name].version])), version);
if (problem) throw new Error(problem);

if (!packDir) {
  if (git("status", "--porcelain")) throw new Error("commit your changes first: the packages must match a commit");
  // HEAD on any remote-tracking branch will do: the publish runs from a worktree at origin/main, which tracks nothing.
  if (!git("branch", "-r", "--contains", "HEAD")) throw new Error("push this branch first: the tag must be on a commit GitHub has");
  if (!succeeds("npm", ["whoami"])) throw new Error("run npm login first (as the owner of @revamp-app)");
  if (succeeds("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}`])) throw new Error(`v${version} is already tagged: raise the version first`);
}

const tmp = mkdtempSync(join(tmpdir(), "revamp-publish-"));
if (packDir) mkdirSync(packDir, { recursive: true });
const stage = (name: string) => join(tmp, "stage", name);
try {
  run("npx", ["tsc", "-p", "tsconfig.publish.json", "--outDir", join(tmp, "compiled")]);
  // All three are staged before any is published, so a staging failure can't leave the version half on npm.
  for (const name of PUBLISHED) {
    cpSync(join(tmp, "compiled", name, "src"), join(stage(name), "src"), { recursive: true });
    writeFileSync(join(stage(name), "package.json"), JSON.stringify(publishedManifest(manifests[name], version, engines), null, 2) + "\n");
    copyFileSync(join(root, "LICENSE"), join(stage(name), "LICENSE"));
  }
  for (const name of PUBLISHED) {
    if (packDir) run("npm", ["pack", "--pack-destination", packDir], stage(name));
    else run("npm", ["publish", "--access", "public"], stage(name));
  }
} catch (e) {
  console.error(`left ${tmp} for inspection`);
  throw e;
}
rmSync(tmp, { recursive: true, force: true });

if (packDir) {
  console.log(`Packed @revamp-app/{${PUBLISHED.join(",")}} ${version} into ${packDir}.`);
} else {
  run("git", ["tag", `v${version}`]);
  run("git", ["push", "origin", `v${version}`]);
  console.log(`Published @revamp-app/{${PUBLISHED.join(",")}} ${version} and pushed tag v${version}.`);
}
