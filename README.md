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

Patch Hydra with the bundle in this repo:

```bash
npm run build -w @revamp/bundle-official
npm run revamp -- patch hydra
```

The other commands are `npm run revamp -- list`, `npm run revamp -- rollback hydra` and
`npm run revamp -- uninstall hydra`.

If a Revamped app won't start on Ubuntu 24.04 or newer, see [docs/electron-sandbox.md](docs/electron-sandbox.md).
