import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PatchAppResult, PatchListing } from "@revamp/engine";
import { writeDemoBundle } from "../../engine/test/helpers/demo.ts";
import { formatInstalls, formatPatchList, formatPatchResult, printable } from "../src/format.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const cli = (args: string[], home = mkdtempSync(join(tmpdir(), "revamp-cli-")), input = "") =>
  spawnSync(process.execPath, [MAIN, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" },
  });

test("formatPatchResult shows each patch, failures under it, and notes", () => {
  const r: PatchAppResult = {
    appId: "hydra",
    appName: "Hydra",
    version: "4.1.6",
    untested: false,
    installed: true,
    dryRun: false,
    installDir: "/x/apps/hydra/4.1.6",
    exitCode: 2,
    warnings: ["W"],
    logs: [],
    results: [
      { name: "Disable self-update", status: "applied", required: true, internal: false },
      { name: "Recently downloaded sort", status: "failed", required: false, internal: false, message: 'fingerprint "library sort switch" failed at step "pattern": …' },
      { name: "(internal patch #3)", status: "applied", required: false, internal: true },
      { name: "Off", status: "disabled", required: false, internal: false },
    ],
  };
  assert.equal(
    formatPatchResult(r),
    [
      "Hydra 4.1.6: 1/2 patches apply (installed to /x/apps/hydra/4.1.6)",
      "  ✓ Disable self-update (required)",
      "  ✗ Recently downloaded sort",
      '      fingerprint "library sort switch" failed at step "pattern": …',
      "    Off [disabled]",
      "Note: W",
    ].join("\n"),
  );
  assert.match(formatPatchResult({ ...r, installed: false, aborted: 'required patch "X" failed', exitCode: 1 }), /nothing installed: required patch "X" failed/);
  assert.match(formatPatchResult({ ...r, version: "4.1.7", untested: true }), /^Hydra 4\.1\.7 \(untested\): 1\/2 patches apply/);
  const helperFailed = [...r.results, { name: "(internal patch #4: helper)", status: "failed" as const, required: false, internal: true, message: "m" }];
  assert.match(formatPatchResult({ ...r, results: helperFailed }), /^Hydra 4\.1\.6: 1\/2 patches apply[^]*\n  ✗ \(internal patch #4: helper\)\n      m\nNote: W$/);
});

test("formatInstalls lists versions in local time and marks the current and untested ones", (t) => {
  const tz = process.env.TZ;
  process.env.TZ = "Europe/Sofia"; // UTC+3 in October, so 21:30Z is 00:30 the next day
  t.after(() => (tz === undefined ? delete process.env.TZ : (process.env.TZ = tz)));
  assert.equal(formatInstalls([]), "No Revamped apps installed.");
  const receipt = (version: string) => ({
    app: "hydra",
    version,
    release: { asset: "a", sha256: "a" },
    bundle: { name: "b", version: "1", sha256: "b" },
    selection: { enable: [], disable: [], options: {} },
    installedAt: "2026-10-14T21:30:00.000Z",
    patches: [{ name: "Recently downloaded sort", status: "applied" as const, required: false, internal: false }],
  });
  assert.equal(
    formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.6", receipt: receipt("4.1.6") }] }]),
    "hydra 4.1.6 (current)  installed 2026-10-15 00:30  Recently downloaded sort",
  );
  const forced = { ...receipt("4.1.7"), release: { asset: "a", sha256: "a", untested: true } };
  assert.match(formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.7", receipt: forced }] }]), /^hydra 4\.1\.7 \(untested\)  installed/);
});

test("the CLI prints usage, lists nothing in an empty home, and rejects unknown commands", () => {
  assert.equal(cli(["--help"]).status, 0);
  assert.match(cli(["--help"]).stdout, /revamp patch <app>/);
  const list = cli(["list"]);
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim(), "No Revamped apps installed.");
  const bad = cli(["frobnicate"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown command "frobnicate"/);
  assert.match(cli(["rollback"]).stderr, /needs an app/);
});

test("formatPatchList shows each patch's state, description and options", () => {
  const listing: PatchListing = {
    bundle: { name: "Revamp official", version: "0.2.0", minEngine: "0.2.0", author: "a", license: "GPL-3.0-only", source: "s" },
    app: { id: "hydra", name: "Hydra", release: { github: "o/r", tag: "v{version}", asset: "a" }, installDir: "opt/Hydra", executable: "h", desktopFile: "d", versions: {}, required: ["Core"] },
    version: "4.1.7",
    listed: false,
    patches: [
      { name: "Core", description: "Always on.", apps: null, default: false, required: true, compatible: true, options: { claimLinks: { type: "bool", title: "Claim links", description: "Keep links.", default: true } } },
      { name: "Sort", description: "", apps: [{ app: "hydra", versions: ["4.1.6"] }], default: true, required: false, compatible: false, options: {} },
      { name: "Universal", description: "", apps: null, default: false, required: false, compatible: true, options: {} },
    ],
  };
  assert.equal(
    formatPatchList(listing),
    [
      'Hydra 4.1.7 (not in this bundle: patching it needs --force), from bundle "Revamp official" 0.2.0',
      "  Core  [required]",
      "      Always on.",
      '      --option "Core:claimLinks=<bool>"  Claim links, default true',
      "          Keep links.",
      "  Sort  [only for 4.1.6]",
      "  Universal  [off by default]",
    ].join("\n"),
  );
});

test("revamp patches lists a bundle's patches for an app; bad --option fails before downloading", () => {
  const dir = mkdtempSync(join(tmpdir(), "revamp-cli-bundle-"));
  const bundle = join(dir, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const r = cli(["patches", "demo", "--bundle", bundle]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Demo 1.0.0, from bundle "Demo bundle" 1.0.0\n  Say goodbye  [on by default]\n');
  const bad = cli(["patch", "demo", "--bundle", bundle, "--option", "Say goodbye=1"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /revamp: --option "Say goodbye=1" must look like "<patch>:<key>=<value>"/);
  assert.match(cli(["patches", "nope", "--bundle", bundle]).stderr, /has no app "nope"/);
});

test("revamp sources adds a file source once confirmed, patches use it, and remove drops it", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  const bundle = join(home, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const sha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");

  const declined = cli(["sources", "add", bundle], home, "n\n");
  assert.equal(declined.status, 1);
  assert.equal(
    declined.stdout,
    `Bundle "Demo bundle" 1.0.0 by test (GPL-3.0-only), from ${bundle}\n  Apps: Demo 1.0.0, 2.0.0\n  SHA-256: ${sha256}\nTrust this bundle and add the source? [y/N] `,
  );
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp\n");

  assert.match(cli(["sources", "add", bundle, "--yes"], home).stdout, new RegExp(`\nAdded ${bundle}\\.\n$`));
  assert.equal(cli(["sources", "list"], home).stdout, `${bundle}\n  "Demo bundle" 1.0.0 (file), apps: demo\n  SHA-256: ${sha256}\n`);
  const listing = cli(["patches", "demo"], home);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /^Demo 1\.0\.0, from bundle "Demo bundle" 1\.0\.0\n/);

  assert.equal(cli(["sources", "remove", bundle], home).stdout, `Removed ${bundle} ("Demo bundle" 1.0.0).\n`);
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp\n");
  assert.match(cli(["sources", "nope"], home).stderr, /^Unknown sources command "nope"\./);
});

test("bundle text can't move the cursor or clear the screen before the trust prompt", () => {
  assert.equal(printable("a\x1b[2Kb\rc\u009b\nd\te"), "a\\x1b[2Kb\\x0dc\\x9b\nd\te");
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  const bundle = join(home, "evil.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  writeFileSync(bundle, readFileSync(bundle, "utf8").replace('name: "Demo bundle"', 'name: "Demo\\u001b[2K\\r bundle"'));
  const r = cli(["sources", "add", bundle], home, "n\n");
  assert.match(r.stdout, /^Bundle "Demo\\x1b\[2K\\x0d bundle" 1\.0\.0/);
  assert.doesNotMatch(r.stdout, /\x1b|\r/);
});
