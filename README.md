# Revamp

Revamp is Morphe for Linux Electron apps. It downloads an app's official release, verifies it, patches the shipped
JavaScript inside `app.asar`, and installs the result next to the stock app ("Hydra (Revamped)"). Patched builds
are never distributed: everyone patches locally. License: GPL-3.0-only.

Design: [docs/superpowers/specs/2026-10-14-revamp-v1-design.md](docs/superpowers/specs/2026-10-14-revamp-v1-design.md).

## Install

Requirements: Linux x86_64, glibc 2.28 or newer for the command; the window needs glibc 2.39 and WebKitGTK 4.1
(Ubuntu 24.04, Linux Mint 22, or newer; `sudo apt install libwebkit2gtk-4.1-0`).

1. Download `revamp-1.1.0-linux-x86_64.tar.gz` and `SHA256SUMS` from the [Releases](https://github.com/xb00tt/revamp/releases) page.
2. Check the download:

```bash
sha256sum -c SHA256SUMS
```

3. Unpack it:

```bash
tar -xzf revamp-1.1.0-linux-x86_64.tar.gz
```

4. Install it for your user (no root):

```bash
./revamp-1.1.0-linux-x86_64/revamp self-install
```

5. Patch an app:

```bash
revamp patch hydra
```

**If a Revamped app won't start:** run `revamp doctor` to check the machine. On Ubuntu 24.04 or newer, `revamp sandbox hydra`
installs the AppArmor profile the app needs (one administrator prompt, after showing you what it writes); see
[docs/electron-sandbox.md](docs/electron-sandbox.md).

## Develop

Revamp needs Node 26 (the repo refuses older versions):

```bash
export PATH="$HOME/.local/node26/bin:$PATH"
npm install
npm test
npm run typecheck
```

Patch Hydra or Heroic:

```bash
npm run revamp -- patches hydra
npm run revamp -- patch hydra
```

Without `--bundle <file>`, the patches come from the default source, `xb00tt/revamp-patches`, which the first of these
commands adds to `~/.config/revamp/sources.json` and says so. A local bundle under development is `--bundle <file>`.

`revamp patches <app>` lists an app's patches: which are required or on by default, their options, and the
versions they were tested with. `patch` takes `--enable "<patch>"`, `--disable "<patch>"` and
`--option "<patch>:<key>=<value>"`, and remembers them for the next run. A version the bundle doesn't list
needs `--version <v> --force`; it is verified only against the SHA-256 GitHub publishes and is labeled untested.

The other commands are `npm run revamp -- list`, `npm run revamp -- rollback hydra` and
`npm run revamp -- uninstall hydra`.

The official patches live in [xb00tt/revamp-patches](https://github.com/xb00tt/revamp-patches). Bundle authors install
`@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` from npm: the SDK declares apps, patches and fingerprints,
the engine describes and runs a bundle, and the CLI is the `revamp` command.

If a Revamped app won't start on Ubuntu 24.04 or newer, see [docs/electron-sandbox.md](docs/electron-sandbox.md).
