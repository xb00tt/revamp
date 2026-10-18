import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installedExecutable,
  installHelper,
  profileFileExists,
  profileName,
  profilePattern,
  profileText,
  removeHelper,
  userNamespacesRestricted,
} from "../src/sandbox-profile.ts";
import { revampPaths } from "../src/paths.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "revamp-sbx-"));
const DATA = "/home/a/.local/share/revamp";

test("userNamespacesRestricted reads the sysctl file", () => {
  const dir = tmp();
  const file = join(dir, "restrict");
  writeFileSync(file, "1\n");
  assert.equal(userNamespacesRestricted(file), true);
  writeFileSync(file, "0\n");
  assert.equal(userNamespacesRestricted(file), false);
  assert.equal(userNamespacesRestricted(join(dir, "missing")), false);
});

test("profileName suffixes the user only when another user's profile exists", () => {
  assert.equal(profileName("hydra", undefined, DATA, "a"), "revamp-hydra");
  assert.equal(profileName("hydra", `profile revamp-hydra "${DATA}/apps/hydra/*/hydralauncher" {}`, DATA, "a"), "revamp-hydra");
  assert.equal(profileName("hydra", `${DATA}/apps/hydra/*/hydralauncher`, DATA, "a"), "revamp-hydra");
  assert.equal(profileName("hydra", `profile revamp-hydra "/home/b/.local/share/revamp/apps/hydra/*/hydralauncher" {}`, DATA, "a"), "revamp-hydra-a");
  // a shorter data dir must not match inside another user's longer path
  assert.equal(profileName("hydra", `"/home/a/.local/share/revamp/apps/hydra/*/h"`, "/a/.local/share/revamp", "x"), "revamp-hydra-x");
  assert.throws(() => profileName("hydra", "other", DATA, "../x"), /unsafe user/);
  assert.throws(() => profileName("../hydra", undefined, DATA, "a"), /unsafe app id/);
});

test("profilePattern joins the data dir, app and executable", () => {
  assert.equal(profilePattern(DATA, "hydra", "hydralauncher"), `${DATA}/apps/hydra/*/hydralauncher`);
  assert.equal(profilePattern(DATA, "heroic", "bin/heroic"), `${DATA}/apps/heroic/*/bin/heroic`);
  assert.throws(() => profilePattern(DATA, "hydra", "../evil"), /unsafe executable/);
  assert.throws(() => profilePattern(DATA, "../hydra", "x"), /unsafe app id/);
});

const profile = (name: string, pattern: string) =>
  `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile ${name} "${pattern}" flags=(unconfined) {\n  userns,\n  include if exists <local/${name}>\n}`;

test("profileText is the exact profile and quotes a path with a space", () => {
  const pattern = profilePattern(DATA, "hydra", "hydralauncher");
  assert.equal(profileText("revamp-hydra", pattern), profile("revamp-hydra", pattern));
  const spaced = profilePattern("/home/me/My Data/revamp", "hydra", "hydralauncher");
  assert.equal(profileText("revamp-hydra", spaced), profile("revamp-hydra", spaced));
});

test("profileText refuses a quote, a newline, a control character or a backslash", () => {
  for (const bad of ['/home/"x/apps/hydra/*/h', "/home/x\n}/apps/hydra/*/h", "/home/x\0/apps", "/home/x\t/apps", "/home/x\\/apps"]) {
    assert.throws(() => profileText("revamp-hydra", bad), /unsupported data path/);
  }
  assert.throws(() => profileText("revamp hydra", "/x"), /unsafe profile name/);
});

const header = "#!/bin/sh\nset -eu\numask 022\n";

test("installHelper writes the file, moves it over and reloads", () => {
  const text = profileText("revamp-hydra", profilePattern(DATA, "hydra", "hydralauncher"));
  assert.equal(
    installHelper("revamp-hydra", text),
    `${header}cat > '/etc/apparmor.d/revamp-hydra.new' <<'REVAMP_PROFILE'\n${text}\nREVAMP_PROFILE\n` +
      `mv -f '/etc/apparmor.d/revamp-hydra.new' '/etc/apparmor.d/revamp-hydra'\n` +
      `apparmor_parser -r '/etc/apparmor.d/revamp-hydra'\n`,
  );
});

test("installHelper refuses a profile that could end the heredoc early or a name that is not a plain name", () => {
  assert.throws(() => installHelper("revamp-hydra", "x\nREVAMP_PROFILE\nrm -rf /"), /REVAMP_PROFILE/);
  assert.throws(() => installHelper("../x'; rm", "x"), /unsafe profile name/);
  assert.throws(() => removeHelper("a b"), /unsafe profile name/);
});

test("removeHelper unloads, then removes the file", () => {
  assert.equal(
    removeHelper("revamp-hydra"),
    `${header}apparmor_parser -R '/etc/apparmor.d/revamp-hydra' || true\nrm -f '/etc/apparmor.d/revamp-hydra'\n`,
  );
});

test("profileFileExists looks in the given dir", () => {
  const dir = tmp();
  assert.equal(profileFileExists("revamp-hydra", dir), false);
  writeFileSync(join(dir, "revamp-hydra"), "x");
  assert.equal(profileFileExists("revamp-hydra", dir), true);
});

function withDesktop(exec?: (data: string) => string) {
  const paths = revampPaths({ HOME: tmp() });
  mkdirSync(paths.applications, { recursive: true });
  if (exec) writeFileSync(join(paths.applications, "revamp-hydra.desktop"), `[Desktop Entry]\nName=Hydra (Revamped)\nExec=${exec(paths.data)}\n`);
  return paths;
}

test("installedExecutable returns the path under current/, ignoring extra arguments", () => {
  assert.equal(installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/hydralauncher" %U`), "hydra"), "hydralauncher");
  assert.equal(installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/bin/heroic" --no-sandbox %U`), "hydra"), "bin/heroic");
});

test("installedExecutable unescapes the Exec quoting", () => {
  const q = revampPaths({ HOME: join(tmp(), "50%") });
  mkdirSync(q.applications, { recursive: true });
  writeFileSync(join(q.applications, "revamp-hydra.desktop"), `[Desktop Entry]\nExec="${q.data.replaceAll("%", "%%")}/apps/hydra/current/hydralauncher" %U\n`);
  assert.equal(installedExecutable(q, "hydra"), "hydralauncher");
});

test("installedExecutable refuses a path outside current/, a missing file and a missing Exec", () => {
  assert.throws(() => installedExecutable(withDesktop(() => '"/opt/Hydra/hydralauncher" %U'), "hydra"), /not under .*apps\/hydra\/current/);
  assert.throws(() => installedExecutable(withDesktop(() => "/opt/Hydra/hydralauncher %U"), "hydra"), /not under .*apps\/hydra\/current/);
  assert.throws(() => installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/../evil" %U`), "hydra"), /unsafe executable/);
  const p = withDesktop();
  assert.throws(() => installedExecutable(p, "hydra"), /hydra is not installed/);
  writeFileSync(join(p.applications, "revamp-hydra.desktop"), "[Desktop Entry]\nName=x\n");
  assert.throws(() => installedExecutable(p, "hydra"), /no Exec/);
});
