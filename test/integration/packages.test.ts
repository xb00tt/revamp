import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDemoBundle } from "../../packages/engine/test/helpers/demo.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "the packed @revamp-app packages install into a project and run the engine, its sandbox and the CLI from node_modules",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 5 * 60_000 },
  (t) => {
    // A space in the path checks the sandbox flags; the project is outside the repo, like revamp-patches.
    const dir = mkdtempSync(join(tmpdir(), "revamp packages "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const env = { PATH: process.env.PATH, HOME: join(dir, "home") };
    const packs = join(dir, "packs");
    // stderr is piped so a tsc or npm failure shows up on the thrown error; a normal run stays quiet
    execFileSync("npm", ["run", "publish:packages", "--", "--pack", packs], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });

    const project = join(dir, "consumer project");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), '{"name":"c","private":true,"type":"module"}\n');
    // One install for all three: npm then satisfies their @revamp-app/* dependencies from the tarballs, not the registry.
    const tarballs = readdirSync(packs).map((f) => join(packs, f));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: project, env, stdio: ["ignore", "ignore", "pipe"] });
    const bundle = join(project, "demo bundle.mjs");
    writeDemoBundle(bundle, { sha256: "0".repeat(64) });

    const node = (code: string) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: project, env, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    assert.equal(
      node(`import { describe, ENGINE_VERSION } from "@revamp-app/engine";
        const d = await describe(${JSON.stringify(bundle)});
        console.log(d.manifest.name, ENGINE_VERSION);`),
      "Demo bundle 0.3.0",
    );
    assert.equal(node('const m = await import("@revamp-app/cli/format"); console.log(typeof m.formatPatchResult);'), "function");
    // Only the listed exports are reachable: patch code can't import a package's internal files.
    assert.equal(node('await import("@revamp-app/engine/src/api.js").catch((e) => console.log(e.code));'), "ERR_PACKAGE_PATH_NOT_EXPORTED");
    // The published engine still sandboxes the bundle: reading a file it wasn't given fails the job.
    const evil = join(project, "evil.mjs");
    writeFileSync(evil, 'process.getBuiltinModule("node:fs").readFileSync("/etc/hostname");\nexport const manifest = {}, apps = [], patches = [];\n');
    assert.match(
      node(`import { describe } from "@revamp-app/engine"; await describe(${JSON.stringify(evil)}).catch((e) => console.log(e.message));`),
      /Access to this API has been restricted/,
    );

    const listing = spawnSync(join(project, "node_modules/.bin/revamp"), ["patches", "demo", "--bundle", bundle], { cwd: project, env, encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /^Demo 1\.0\.0, from bundle "Demo bundle" 1\.0\.0/);
  },
);
