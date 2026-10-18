# Revamp v2: design

- **Date:** 2026-10-18
- **Status:** draft for the owner's review. The owner asked for a first draft from the v1 limits without an interview, so every decision below is the planner's call until the owner confirms or changes it (§2).
- **Builds on:** [2026-10-14-revamp-v1-design.md](2026-10-14-revamp-v1-design.md) (frozen; its §14 risks and §15 non-goals are the starting point) and [2026-10-16-revamp-patches-split-design.md](2026-10-16-revamp-patches-split-design.md) (the two repos).
- **Where v1 ended:** Revamp 1.0.0 (CLI, window, `@revamp-app/*` on npm, a prebuilt Linux x86_64 tarball with `revamp self-install`) and bundle 0.4.2 in `xb00tt/revamp-patches` (Hydra 4.1.6/4.2.0, Heroic 2.22.3/2.22.4).

## 1. Intent

v1 proved the idea and runs on the owner's machine. v2 makes Revamp safe and workable for **people who aren't the owner**: it must start Revamped apps on a stock Ubuntu 24.04, keep itself up to date without a `git clone`, and let someone trust a bundle source for a better reason than "the repo looked fine the day I added it".

One sentence: **v2 is "Revamp for everyone else": it installs, runs, updates and trusts without the owner's machine or hands.**

Three things make it special:
- **The sandbox problem gets solved, not documented.** Today a Revamped app fails to start on stock Ubuntu 24.04+ and the user reads a doc. In v2 Revamp fixes it with one root prompt.
- **Revamp updates itself** the way it updates apps: verified, atomic, announced by the daily check and the window.
- **Trust has a key, not just a hash.** A source can sign its bundles; Revamp pins the key and refuses an unsigned or wrongly signed update.

## 2. Decisions (planner's calls, for the owner to confirm)

| # | Decision | Why | The owner may prefer |
|---|---|---|---|
| 1 | Scope = sandbox fix + `doctor`, self-update, signed sources/releases, per-app source choice. arm64 is a stretch milestone. | Each removes a reason a non-owner can't use Revamp. | Dropping or reordering milestones. |
| 2 | **No AppImage, rpm, pacman or tar.xz input.** | Revamp downloads and extracts the official `.deb` itself (no `dpkg` needed), so it already works on any distro. Both apps publish a `.deb`. Another input format would add a squashfs reader and gain nothing until an app stops shipping `.deb`s. | Adding AppImage anyway, for an app that only ships one. |
| 3 | The sandbox fix is **an AppArmor profile per app**, written with one `pkexec` prompt. `--no-sandbox` stays a documented fallback, never the default. | It's what Hydra itself ships for `/opt/Hydra`; it keeps Chromium's sandbox on. | `sudo` in the terminal instead of `pkexec`. |
| 4 | Signing uses **ed25519 through `node:crypto`**, minisign-like, no new dependency. Keys are pinned on first use, like SHA-256 pins today. | Runtime deps stay `acorn` + `xz-decompress`; TOFU matches v1's trust model. | A fixed, built-in key for the official source only. |
| 5 | Self-update verifies the **release signature** with a public key built into the binary, and the tarball's SHA-256 from `SHA256SUMS`. | `SHA256SUMS` next to the tarball proves integrity only; the signature proves it came from the maintainer. | Checksum only, if key handling feels heavy. |
| 6 | v2 ships as **Revamp 1.x** releases (1.1, 1.2, …), one per milestone. "v2" names this design, not a 2.0 version. | Nothing breaks for v1 users or bundles; semver says minor. | A 2.0 at the end. |
| 7 | The bundle format gains optional fields only. `minEngine` stays the compatibility mechanism. | Existing bundles keep working unchanged. | — |
| 8 | Hydra Big Picture, Windows/macOS, Flatpak, root installs, a patch website and distributing patched builds stay non-goals. | Unchanged from v1 §15; nothing in v1's use changed the reasoning. | — |

**Calls made after the builder check** (a fresh reader planned from the draft and asked; these are the planner's answers):

| # | Call | Why |
|---|---|---|
| 9 | Self-update runs the **new** binary's `self-install`, not the old binary's install code. `installCli` / `installWindow` stay in the CLI. | The old version can't know a newer layout. The window's button does the same through `serve`. |
| 10 | Only **`bundle.json` is signed**; it already carries the bundle's SHA-256. Signature file: `bundle.json.sig` beside it (GitHub), `<url>.sig` (URL sources); local `.mjs` sources are unsigned. | One signature, one place. |
| 11 | A refresh **re-fetches `bundle.json` every run** (it's small) and verifies hash and signature, even at the same version. A changed hash at the same version, a missing or invalid signature, a key change, or a lower version than the pin is **refused and reported**, never applied. Only an interactive `revamp sources add <location>` can accept a new key or a downgrade. | Today's refresh skips unchanged versions, so tampering at the same version would pass. Non-interactive runs (the timer, the window's check) must never move a key pin. |
| 12 | Unsigned records stay unsigned until the user re-adds the source; the refresh only *reports* "this source is now signed". A pin with a key never accepts unsigned again. | No silent trust escalation either way. |
| 13 | Two keys: a **release key** built into the binary (a list, so a successor key can be added by a release the old key signed) and the **official source's key**, pinned through sources. Lost or leaked release key = reinstall from the tarball; written down as a v2 limit. The first binary with self-update carries the list, so there's no bootstrap gap: users on older versions reinstall once. | Different lifetimes, different holders. |
| 14 | Sources are identified by `location` in `sources prefer` and in `preferred_for`; names from bundles are untrusted. A preferred source that's gone or lacks the app falls back to the first source with it, and `sources list` says so. | `location` is already the real key for `sources remove`. |
| 15 | revamp-patches work (signing in its release script, CI verification, bundle 0.5.0) is **in M7's plan**, as its own task group in that repo. The private keys live with the owner (a file path or env var at release time), never in CI; CI-built artifacts (M10) are signed by the owner afterwards with a `release:app --sign-only` step. | The checker couldn't tell whether the sibling repo was in scope. |
| 16 | `doctor` reads **local state only** (sources.json, cached bundles, last-check.json's age per source) and never fetches. | No GitHub calls outside `check`. |
| 17 | The AppArmor profile uses **this user's real data path** (`revampPaths().data`), not a `/home/*` glob, and the app's `executable` relative path as the bundle gives it (it may be nested). One profile per app, Heroic included; acceptance covers both apps. | Covers a custom `XDG_DATA_HOME`; matches what's installed. |
| 18 | The glibc floor is the **window's** (built on the owner's machine, glibc 2.39); the CLI's floor is Node's own (2.28). `doctor` checks 2.39 only when the window is installed. | The draft had it as one floor. |

## 3. Verified facts (2026-10-18)

- **Release formats.** Hydra 4.2.0: `.deb`, `.AppImage`, `.rpm`, `.snap`, Windows; **no arm64**. Heroic 2.22.4: `.deb` (amd64 **and arm64**), `.AppImage` (x86_64 and arm64), `.rpm`, `.pacman`, `.tar.xz`, macOS, Windows.
- **The sandbox.** v1's `docs/electron-sandbox.md`: with `kernel.apparmor_restrict_unprivileged_userns=1` (stock Ubuntu 24.04+) a home-installed Electron app can't start its sandbox. Hydra's own fix is an AppArmor profile that marks the executable path `flags=(unconfined)` with `userns`. The owner's Linux Mint 22.3 has the sysctl at `0`, so the owner never hits this; most Ubuntu users do.
- **Revamp 1.0.0 install layout** (`packages/cli/src/install.ts`): `~/.local/share/revamp/bin/revamp` (linked from `~/.local/bin/revamp`), `~/.local/share/revamp/gui/{revamp-gui,revamp,revamp.png}`, `~/.local/share/applications/revamp.desktop`. Every file is written as `.new` and renamed over, so a running `revamp` or window keeps its old binary. The window's sidecar is a link to the installed CLI.
- **Releases.** `npm run publish:packages` (owner's terminal, npm needs a browser one-time password) then `npm run release:app` makes GitHub release `v<version>` with `revamp-<v>-linux-x86_64.tar.gz` + `SHA256SUMS`. The daily `revamp check` already asks GitHub's release API for each app; the same code can ask for Revamp.
- **Sources today** (`engine/bundle-sources.ts`): a GitHub repo (`bundle.json` on the default branch), a `bundle.json` URL, or a local `.mjs`. `sources add` shows the manifest and pins the bundle's SHA-256; `refreshSources` moves only GitHub pins, and **skips a `bundle.json` whose version equals the pin** (so a same-version change is never examined today; decision 11 changes that). The first source with an app wins. `DEFAULT_SOURCE = "xb00tt/revamp-patches"` is a constant Revamp adds on first use; v1 ships no key for it.
- **Node 26** `crypto` has ed25519 `generateKeyPair`, `sign` and `verify`; no addon needed. `pkexec` (polkit) is present on Ubuntu and Mint desktops; `apparmor_parser` ships with AppArmor.
- **Window extras v1 deferred** (M5 plan, decision 2): patch list polish, per-app source choice, add-source links, saved selections, search and filters.

## 4. Goals, non-goals, anti-goals

**Goals**
- A stock Ubuntu 24.04 user installs Revamp from the tarball, patches Hydra, and **it starts**, after at most one root prompt that Revamp explains.
- `revamp doctor` tells any user why something won't work (glibc, WebKitGTK, the sandbox sysctl, PATH, the timer, sources) before they ask for help.
- `revamp self-update` and the window keep Revamp current, with the same verify-then-atomic-rename discipline as app updates.
- A bundle source can be signed; Revamp pins the key, shows its fingerprint at trust time, and refuses a bundle the key didn't sign.
- When two sources offer the same app, the user picks which one patches it.

**Non-goals (v2)**
- New input formats (decision 2), Windows, macOS, Flatpak, root installs, replacing the stock app.
- Hydra Big Picture patches.
- A patch directory or website. (A list of known sources in the revamp-patches README is documentation, not a feature.)
- Automatic application of Revamp updates: v2 announces and offers; the user runs it.
- Rewriting any v1 piece. The engine, CLI and window grow; they don't move.

**Anti-goals** (a failure even if it works)
- Any step that weakens Chromium's sandbox by default, or writes to `/etc` without the user seeing exactly what and why.
- A self-update that can replace the binary with something the maintainer didn't sign, or that leaves a half-written install.
- A signing scheme that makes unsigned third-party sources stop working. Unsigned stays allowed, labeled.
- Asking for root more than once per app, or at all on a machine that doesn't need it.

## 5. What the user sees

### 5.1 `revamp doctor`

Prints one line per check, with ✓ / ✗ and the fix:
- Linux x86_64, glibc ≥ 2.39 (the binary's floor), WebKitGTK 4.1 present (for the window).
- `kernel.apparmor_restrict_unprivileged_userns`: `0` fine; `1` → "Revamped apps need an AppArmor profile: run `revamp sandbox <app>`" per installed app, and whether the profile is already loaded (`/sys/kernel/security/apparmor/profiles`). (`/sys/kernel/security/apparmor/profiles` is root-only, so `doctor` reports the profile file in `/etc/apparmor.d/`, not the loaded state.)
- `~/.local/bin` on PATH; the timer enabled and its last run; each source's pin, whether it's signed, and when it was last checked successfully (from `last-check.json`). `doctor` never fetches anything (decision 16).
- Installed apps and whether each one's current version has a receipt.
- The glibc check applies to the window (2.39) only when it's installed; the CLI needs Node's 2.28 (decision 18).

Exit code 1 when any ✗ is fixable by the user, 2 when something is broken.

### 5.2 `revamp sandbox <app>` (the fix)

- Writes `/etc/apparmor.d/revamp-<app>` with the profile from v1's doc, with this user's real data path instead of the `/home/*` glob (`profile revamp-<app> "<data>/apps/<app>/*/<executable>" flags=(unconfined) { userns, include if exists <local/revamp-<app>> }`, decision 17), then `apparmor_parser -r` on it, in one `pkexec` invocation of a small helper script that Revamp writes to a temp file and shows the user first. Without a polkit agent (no `DISPLAY`/`WAYLAND_DISPLAY`, or no `pkexec`), it prints the `sudo` commands instead of prompting.
- Before the prompt it prints the full profile and the two commands, and asks `Write it with administrator rights? [y/N]` (`--yes` skips).
- Runs automatically **only** when asked: `revamp patch`/`update` end their report with "This machine restricts user namespaces: run `revamp sandbox hydra` once, or see docs/electron-sandbox.md" when the sysctl is `1` and no profile is loaded. The window shows the same as a banner with a "Fix the sandbox" button that runs the command (the pkexec dialog is the system's).
- The profile's path uses the app id and executable from the bundle, both already `assertSafeName`-checked; the app id is also the file name.
- `revamp uninstall <app>` mentions the profile and how to remove it (`pkexec rm` + `apparmor_parser -R`), and offers to do it.

### 5.3 Signed sources

- A bundle author runs `revamp keygen <name>` once: an ed25519 key pair, private key in `~/.config/revamp/keys/<name>.key` (0600), public key printed as `revamp-pk:<base64>`.
- `npm run release` in a bundle repo signs `bundle.json` (decision 10): `bundle.json.sig` (base64 ed25519 over the file bytes) is committed beside it in the same commit, and `bundle.json` gains `"signing_key": "revamp-pk:…"`. The `.mjs` is covered by the SHA-256 inside the signed `bundle.json`. A URL source's signature is at `<url>.sig`.
- `revamp sources add` shows the key fingerprint with the manifest. After the user confirms, the source record pins `{ sha256, signing_key }`.
- **Every refresh** re-fetches `bundle.json` and `.sig` and verifies them (decision 11). It moves the pin only to a newer version with a valid signature by the pinned key. Anything else (same version with another hash, missing or bad signature, a different key, a lower version) is refused and reported: "run `revamp sources add <location>` to review". The timer and the window never change a key pin.
- Unsigned sources still work and are labeled "unsigned" in `sources list`, the trust prompt and the window. When an unsigned source starts publishing a key, the refresh reports it and keeps using the source unsigned until the user re-adds it (decision 12).
- The official source `xb00tt/revamp-patches` is signed from bundle 0.5.0. Revamp ships its public key as a constant beside `DEFAULT_SOURCE`: when Revamp adds the default source on first use, that key is pinned without a prompt, and a `bundle.json` that names a different key is an error. Existing installs (the owner's included) see the "now signed" report once and re-add the source to pin the key.

### 5.4 Self-update

- `revamp self-update [--check]`: asks GitHub for the latest `v*` release of `xb00tt/revamp`, compares with `ENGINE_VERSION`, downloads the tarball, `SHA256SUMS` and `SHA256SUMS.sig`, verifies the signature with a release key built into the binary (a list, decision 13) and the tarball's hash, extracts to a temp dir, and only then **runs the extracted binary's own `self-install`** (decision 9), so the new version's install code does the install. A failed verification leaves the install untouched. It prints what changed (the CHANGELOG section from the release notes) and "Restart the Revamp window to use it" when the window is running.
- `--check` prints the verdict and exits 0 (current) or 3 (update available).
- The daily `revamp check` adds a line "Revamp 1.1.0 is out (`revamp self-update`)" and the notification mentions it. The window shows a banner with an "Update Revamp" button; after the update it restarts its sidecar and tells the user to reopen the window.
- From the repo (`isSea()` false) it refuses, like `self-install`.
- Never automatic. The timer only announces.

### 5.5 Per-app source choice

- `revamp sources list` shows, per app, which source will patch it. `revamp sources prefer <app> <location>` records `preferred_for: [appId]` on that source's record (sources are identified by `location`, decision 14); the engine's "first source with the app wins" becomes "the preferred source if it has the app, else the first", and `sources list` says when a preference isn't in effect.
- The window: on the app screen, a "Source" dropdown appears only when two sources offer the app.

## 6. How it's built

**Engine (`packages/engine`)**
- `doctor.ts`: the checks as data (`{ id, label, ok, fix? }`), pure where possible; the sysctl and `/sys` reads are the only I/O.
- `sandbox-profile.ts`: builds the profile text and the helper script from `(appId, executable)`; the CLI runs `pkexec`. The engine never calls `pkexec` itself.
- `signing.ts`: `keygen`, `sign(file, key)`, `verify(file, sig, publicKey)`, key fingerprinting; `bundle-sources.ts` grows `signing_key` in the source record, the per-run re-fetch, and the verify-and-refuse step in `refreshSources` (decision 11).
- `self-update.ts`: release lookup (reusing `download.ts` + `releaseDigest` patterns), signature and hash verification, extraction to a temp dir, then spawning `<tmp>/revamp self-install` (decision 9). `installCli` / `installWindow` stay in `cli/src/install.ts`.
- `bundle-sources.ts`: the preference, keyed by `location`.

**CLI (`packages/cli`)**: `doctor`, `sandbox`, `keygen`, `self-update`, `sources prefer`; the end-of-report sandbox note; `check` reports Revamp releases.

**serve**: `doctor.run`, `sandbox.fix` (spawns `pkexec`; the dialog is the system's), `self.update`, `sources.prefer`.

**Window (`packages/gui`)**: the sandbox banner and button, the Revamp-update banner and button, the source dropdown, "unsigned" labels.

**revamp-patches** (in scope for M7, decision 15): `npm run release` signs `bundle.json` with the owner's key (path or env var at release time, never in CI) and commits `bundle.json.sig` with it; CI verifies the committed signature against the key in `bundle.json`.

**Format changes** (all optional fields): `bundle.json.signing_key`; `bundle.json.sig` beside it; source records `signing_key`, `preferred_for: [appId]`; release assets `SHA256SUMS.sig`. `minEngine` is unchanged by signing; bundles that use no new SDK feature keep `0.2.0`. Old source records without `signing_key` are unsigned.

**Constraints carried from v1 (binding):** runtime deps stay `acorn` + `xz-decompress`; no native addons; erasable TypeScript; bundle code only in the sandbox; names from bundles through `assertSafeName`; unit tests never touch the network or the real home; port 3000 and `/opt/*` off limits; the window holds no engine logic.

## 7. Milestones

One plan per milestone, one Revamp 1.x release each. Each milestone leaves the previous release's users working.

**M6: doctor and the sandbox fix (Revamp 1.1).**
- `revamp doctor`, `revamp sandbox <app>`, the report note, the window banner and button, uninstall's profile cleanup.
- Acceptance: on a throwaway VM or container with `apparmor_restrict_unprivileged_userns=1`, a fresh tarball install patches Hydra and Heroic, `revamp sandbox <app>` asks once per app, and both Revamped apps start. `doctor` is green there afterwards. Unit tests cover the profile text (both apps, a nested executable, a non-`/home` data dir) and the doctor checks with stubbed reads.

**M7: signed sources (Revamp 1.2, bundle 0.5.0).**
- `keygen`, signing in revamp-patches' release script and CI, the per-run re-fetch and verification in `refreshSources`, verification in `sources add`, the labels, the built-in key for the default source.
- Acceptance: with a local HTTP server standing in for GitHub, a refresh refuses each of these and keeps the old pin: a same-version `bundle.json` with another hash, a missing `.sig`, a bad `.sig`, a different key, a lower version. A valid newer version moves the pin. An unsigned local `.mjs` still works and says "unsigned". A key change is accepted only through `sources add`. CI in revamp-patches verifies its own committed signature.

**M8: self-update (Revamp 1.3).**
- `self-update`, `check` reporting Revamp releases, the window banner, `SHA256SUMS.sig` in `release:app`, the built-in release key list.
- Acceptance: a 1.3 install updates itself to a later release from the real GitHub release in a throwaway home (the first self-updating binary is 1.3, so this is tested with a 1.3.x or 1.4 release); a tarball with a bad signature or hash is refused and the install is untouched; the extracted binary's `self-install` did the install; the running window survives the swap and restarts its sidecar.

**M9: per-app source choice (Revamp 1.4).**
- `sources prefer`, the window dropdown.
- Acceptance: two local sources with Hydra; the preferred one patches it; removing it falls back to the other.

**M10 (stretch): arm64 (Revamp 1.5).**
- `release:app` builds in CI on GitHub's arm64 runner too; `defineApp` assets per architecture; Heroic arm64 `.deb` listed. Hydra has no arm64 release, so it stays x86_64-only.
- Only if someone asks for it; otherwise it stays here as the written-down plan.

## 8. Risks and open questions

- **pkexec on non-desktop sessions** (SSH, no polkit agent): the prompt can't appear. `revamp sandbox` must detect that and print the `sudo` commands instead.
- **The AppArmor profile is per user** (it names this user's data path, decision 17). A second user on the same machine runs `revamp sandbox` too; Revamp names the profile `revamp-<app>` for the first and must not overwrite it: the builder gives later profiles a user suffix.
- **Key compromise**: there's no revocation in v2. Official-source key rotation = a new key confirmed by every user through `sources add`; release-key rotation = a release signed by the old key that adds the successor to the built-in list; a lost or leaked release key = users reinstall from the tarball once. Written down as v2 limits.
- **Signature skew**: `bundle.json` and `.sig` are committed together, so a refresh can only see them apart mid-push; it reports "signature missing" and tries again next run.
- **GitHub API rate limit** (60/hour unauthenticated): `self-update --check` runs inside the daily `check`, which already spends requests; one more per day is fine, but `doctor` must not call GitHub.
- **Self-update of a running `revamp serve`**: the rename is atomic and Linux keeps the old inode for the running process; the window must restart the sidecar, and the design says so. Tested in M8's acceptance.
- **Open for the owner:** the milestone order (sandbox first is the planner's bet on what blocks other users most); whether signing is worth it before there's a second source in the wild; whether `doctor` belongs in the window too (the draft keeps it CLI-only).

## 9. What's left to the builder

- Exact command output text, exit codes beyond those named, and the window's wording.
- The helper script's exact contents and how `pkexec` is detected (`which pkexec`, `DISPLAY`/`WAYLAND_DISPLAY` set).
- Where the built-in release key list lives in the binary and how `release:app` gets the private key (an env var or a file path, never committed), and the `--sign-only` step for CI-built artifacts.
- The user suffix for a second user's AppArmor profile, and the uninstall cleanup's exact prompt.
- Test fixtures for a signed bundle, a tampered one, a wrong key and a downgrade.
