# Electron's sandbox and Revamped apps

Revamped apps live in your home folder (`~/.local/share/revamp/apps/`), so their `chrome-sandbox` helper can't be
setuid-root. Electron then sandboxes its renderers with unprivileged user namespaces.

Check your system:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

- `0` (Linux Mint 22, most distributions): nothing to do.
- `1` (stock Ubuntu 24.04 and newer): Revamped apps fail to start with a sandbox error. Revamp 1.1 fixes this for
  you with `revamp sandbox <app>`. Option 1 below does the same by hand; option 2 turns the sandbox off instead.

## The fix: `revamp sandbox <app>`

```bash
revamp sandbox hydra
```

It writes `/etc/apparmor.d/revamp-hydra` (the profile in option 1, with the real path of your data folder) and loads
it with `apparmor_parser -r`, after checking that the file parses; a profile that doesn't parse never stays in
`/etc/apparmor.d`. The profile is normally called `revamp-hydra`. When another user's profile on the machine already
holds that name, yours is `revamp-hydra-u<your uid>` (`id -u` prints it).

First it prints the whole script that will run as root, then asks once (`--yes` skips the question) and shows the
system's administrator prompt (`pkexec`). Without a graphical session or `pkexec`, when you say no or cancel the
prompt, or when `pkexec` fails, it saves the same script under `~/.local/state/revamp/sandbox/` and prints
`sudo sh <that file>` for you to run. On a system that doesn't restrict user namespaces it does nothing and asks for
nothing. It refuses a data folder that another user could change (one under a folder others can write to, such as
`/tmp`), and an AppArmor older than 4.0.

`revamp patch` and `revamp update` end with this command when the machine restricts user namespaces and the app has no
profile yet, and the Revamp window shows the same as a banner with a button per app (where no administrator prompt can appear, it
says "Run revamp sandbox <app> in a terminal" instead of the button). `revamp doctor` checks the whole
setup (including whether the profile file is in `/etc/apparmor.d/`; whether it is loaded needs root to read) and
`revamp uninstall <app>` offers to remove the profile, and a half-written `<profile>.new` file that an interrupted
run left (a killed `revamp sandbox` can).

## Option 1: an AppArmor profile for the Revamped path by hand (needs root once)

This mirrors the profile Hydra ships for `/opt/Hydra` (`resources/apparmor-profile`), with your data path, as
`revamp sandbox hydra` prints it. Your shell fills in the path (the real one, if your home folder is a link) before
`sudo` writes `/etc/apparmor.d/revamp-hydra`:

```bash
sudo tee /etc/apparmor.d/revamp-hydra > /dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile revamp-hydra "$(realpath "$HOME/.local/share/revamp")/apps/hydra/*/hydralauncher" flags=(unconfined) {
  userns,
  include if exists <local/revamp-hydra>
}
EOF
```

Then load it:

```bash
sudo apparmor_parser -r /etc/apparmor.d/revamp-hydra
```

## Option 2: run without Chromium's sandbox

Add `--no-sandbox` to the `Exec=` line of `~/.local/share/applications/revamp-hydra.desktop`, right after the
quoted program path. This turns off a security layer of the app; use it only as a last resort.
