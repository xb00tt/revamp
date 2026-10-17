import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoDeb, writeDemoBundle } from "../../packages/engine/test/helpers/demo.ts";

const SEA = fileURLToPath(new URL("../../packages/cli/dist/revamp", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "the SEA runs the CLI and its sandbox outside the repo, on the Demo app",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    execFileSync("npm", ["run", "build", "-w", "@revamp-app/cli"], { stdio: "ignore" });
    // A space in every path checks the --node-options quoting; the cwd is outside the repo, like the timer's.
    const dir = mkdtempSync(join(tmpdir(), "revamp sea "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const env = { PATH: process.env.PATH, HOME: join(dir, "home"), XDG_CACHE_HOME: join(dir, "cache") };
    // The Demo release waits in the cache with the SHA-256 the bundle pins, so the job never downloads.
    const deb = await demoDeb();
    const release = join(env.XDG_CACHE_HOME, "revamp/releases/demo/1.0.0");
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, "demo_1.0.0_amd64.deb"), deb);
    const bundle = join(dir, "demo bundle.mjs");
    writeDemoBundle(bundle, { sha256: createHash("sha256").update(deb).digest("hex") });
    const revamp = (...args: string[]) => spawnSync(SEA, args, { cwd: dir, env, encoding: "utf8" });

    const listing = revamp("patches", "demo", "--bundle", bundle);
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /^Demo 1\.0\.0, from bundle "Demo bundle"/);

    // The bundle runs in the SEA's sandbox: reading a file it wasn't given fails the job.
    const evil = join(dir, "evil.mjs");
    writeFileSync(evil, 'process.getBuiltinModule("node:fs").readFileSync("/etc/hostname");\nexport const manifest = {}, apps = [], patches = [];\n');
    const denied = revamp("patches", "demo", "--bundle", evil);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Access to this API has been restricted/);

    // Outside the repo there is no default bundle: it comes from a source. An existing (empty) sources.json keeps
    // the SEA from seeding the default source from GitHub.
    mkdirSync(join(env.HOME, ".config/revamp"), { recursive: true });
    writeFileSync(join(env.HOME, ".config/revamp/sources.json"), '{"sources":[]}\n');
    const none = revamp("patches", "demo");
    assert.equal(none.status, 1);
    assert.equal(none.stderr, 'revamp: no bundle source has "demo"; add one, e.g. revamp sources add xb00tt/revamp-patches\n');
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
    const served = spawnSync(SEA, ["serve"], { cwd: dir, env, encoding: "utf8", input: '{"jsonrpc":"2.0","id":1,"method":"patches.list","params":{"appId":"demo"}}\n' });
    assert.equal(served.status, 0, served.stderr);
    const listed = JSON.parse(served.stdout).result;
    assert.deepEqual([listed.app.name, listed.version, listed.bundle.name], ["Demo", "1.0.0", "Demo bundle"]);

    const dryRun = revamp("patch", "demo", "--dry-run");
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /^Demo 1\.0\.0: 1\/1 patches apply \(dry run, nothing installed\)$/m);
  },
);
