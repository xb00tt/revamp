import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp-app/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const SEA = fileURLToPath(new URL("../../packages/cli/dist/revamp", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "the SEA runs the CLI and its sandbox outside the repo",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    execFileSync("npm", ["run", "build", "-w", "@revamp-app/cli"], { stdio: "ignore" });
    // A space in every path checks the --node-options quoting; the cwd is outside the repo, like the timer's.
    const dir = mkdtempSync(join(tmpdir(), "revamp sea "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bundle = join(dir, "official bundle.mjs");
    copyFileSync(BUNDLE, bundle);
    const env = { PATH: process.env.PATH, HOME: join(dir, "home"), XDG_CACHE_HOME: join(revampPaths().cache, "..") };
    const revamp = (...args: string[]) => spawnSync(SEA, args, { cwd: dir, env, encoding: "utf8" });

    const listing = revamp("patches", "hydra", "--bundle", bundle);
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /^Hydra 4\.1\.6, from bundle "Revamp official"/);

    // The bundle runs in the SEA's sandbox: reading a file it wasn't given fails the job.
    const evil = join(dir, "evil.mjs");
    writeFileSync(evil, 'process.getBuiltinModule("node:fs").readFileSync("/etc/hostname");\nexport const manifest = {}, apps = [], patches = [];\n');
    const denied = revamp("patches", "hydra", "--bundle", evil);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Access to this API has been restricted/);

    // Outside the repo there is no default bundle: it comes from a source.
    const none = revamp("patches", "hydra");
    assert.equal(none.status, 1);
    assert.equal(none.stderr, 'revamp: no bundle source has "hydra"; add one, e.g. revamp sources add xb00tt/revamp\n');
    const added = revamp("sources", "add", bundle, "--yes");
    assert.equal(added.status, 0, added.stderr);

    // The repo-built SEA isn't the installed binary: the timer refuses before touching systemd.
    const timer = revamp("timer", "enable");
    assert.equal(timer.status, 1);
    assert.equal(
      timer.stderr,
      `revamp: the timer runs the installed revamp (${join(env.HOME, ".local/share/revamp/bin/revamp")}): run npm run install:cli, then revamp timer enable\n`,
    );

    // The GUI runs the SEA as `revamp serve`: one JSON-RPC message per line.
    const served = spawnSync(SEA, ["serve"], { cwd: dir, env, encoding: "utf8", input: '{"jsonrpc":"2.0","id":1,"method":"patches.list","params":{"appId":"hydra"}}\n' });
    assert.equal(served.status, 0, served.stderr);
    const listed = JSON.parse(served.stdout).result;
    assert.deepEqual([listed.app.name, listed.version, listed.bundle.name], ["Hydra", "4.1.6", "Revamp official"]);

    const dryRun = revamp("patch", "hydra", "--dry-run");
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /^Hydra 4\.1\.6: 7\/7 patches apply \(dry run, nothing installed\)$/m);
  },
);
