# Revamp

Revamp is Morphe for Linux Electron apps. It downloads an app's official release, verifies it, patches the shipped
JavaScript inside `app.asar`, and installs the result next to the stock app ("Hydra (Revamped)"). Patched builds
are never distributed: everyone patches locally. License: GPL-3.0-only.

Design: [docs/superpowers/specs/2026-10-14-revamp-v1-design.md](docs/superpowers/specs/2026-10-14-revamp-v1-design.md).

## Develop

Revamp needs Node 26 (the repo refuses older versions):

```bash
export PATH="$HOME/.local/node-26/bin:$PATH"
npm install
npm test
npm run typecheck
```

Patch Hydra or Heroic with the bundle in this repo:

```bash
npm run build -w @revamp-app/bundle-official
npm run revamp -- patches hydra
npm run revamp -- patch hydra
```

`revamp patches <app>` lists an app's patches: which are required or on by default, their options, and the
versions they were tested with. `patch` takes `--enable "<patch>"`, `--disable "<patch>"` and
`--option "<patch>:<key>=<value>"`, and remembers them for the next run. A version the bundle doesn't list
needs `--version <v> --force`; it is verified only against the SHA-256 GitHub publishes and is labeled untested.

The other commands are `npm run revamp -- list`, `npm run revamp -- rollback hydra` and
`npm run revamp -- uninstall hydra`.

If a Revamped app won't start on Ubuntu 24.04 or newer, see [docs/electron-sandbox.md](docs/electron-sandbox.md).
