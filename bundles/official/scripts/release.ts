// npm run release -w @revamp-app/bundle-official (the owner, by hand): builds the bundle, publishes it as GitHub release
// bundle-v<version>, and commits the root bundle.json that GitHub sources read (spec §7.1, §7.2). Push afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BundleJson } from "./metadata.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const root = here("../../");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

if (git("status", "--porcelain")) throw new Error("commit your changes first: the release must match a commit");
// GitHub tags the release on this commit, so it must already be there.
if (spawnSync("git", ["rev-parse", "@{u}"], { cwd: root, encoding: "utf8" }).stdout.trim() !== git("rev-parse", "HEAD")) {
  throw new Error("push this branch first: the release tags a commit GitHub must already have");
}
run("npm", ["run", "build", "-w", "@revamp-app/bundle-official"]);
const meta = JSON.parse(readFileSync(here("dist/bundle.json"), "utf8")) as BundleJson;
const tag = `bundle-v${meta.version}`;
const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\//.exec(meta.download_url)![1];
if (spawnSync("gh", ["release", "view", tag, "--repo", repo], { stdio: "ignore" }).status === 0) {
  throw new Error(`${repo} already has ${tag}: raise the version in bundles/official/src/index.ts and add its CHANGELOG.md section`);
}
run("gh", ["release", "create", tag, here("dist/official.mjs"), here("dist/patches.json"), "--repo", repo, "--target", git("rev-parse", "HEAD"), "--title", `Bundle ${meta.version}`, "--notes", meta.changelog]);
copyFileSync(here("dist/bundle.json"), `${root}bundle.json`);
run("git", ["add", "bundle.json"]);
run("git", ["commit", "-m", `release: bundle ${meta.version}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
console.log(`Released ${tag} on ${repo}. Push to publish bundle.json: GitHub sources read it from the default branch.`);
