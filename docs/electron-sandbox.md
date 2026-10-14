# Electron's sandbox and Revamped apps

Revamped apps live in your home folder (`~/.local/share/revamp/apps/`), so their `chrome-sandbox` helper can't be
setuid-root. Electron then sandboxes its renderers with unprivileged user namespaces.

Check your system:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

- `0` (Linux Mint 22, most distributions): nothing to do.
- `1` (stock Ubuntu 24.04 and newer): Revamped apps fail to start with a sandbox error. Revamp v1 does not change
  this for you; pick one of the options below.

## Option 1: an AppArmor profile for the Revamped path (needs root once)

This mirrors the profile Hydra ships for `/opt/Hydra` (`resources/apparmor-profile`). Save as
`/etc/apparmor.d/revamp-hydra`:

```
abi <abi/4.0>,
include <tunables/global>

profile revamp-hydra "/home/*/.local/share/revamp/apps/hydra/*/hydralauncher" flags=(unconfined) {
  userns,
  include if exists <local/revamp-hydra>
}
```

Then load it:

```bash
sudo apparmor_parser -r /etc/apparmor.d/revamp-hydra
```

## Option 2: run without Chromium's sandbox

Add `--no-sandbox` to the `Exec=` line of `~/.local/share/applications/revamp-hydra.desktop`, right after the
quoted program path. This turns off a security layer of the app; prefer option 1.
