# Morphe: how the Android patching ecosystem works

Research notes for Revamp, gathered 2026-10-14 from shallow clones of the MorpheApp
GitHub org, the FAQ (https://morphe.software/faq) and the GitHub DMCA repo.
[V] = verified in code or primary source. [I] = inference.

## Repos

| Repo | License | Role |
|---|---|---|
| morphe-patcher | GPL-3.0 | Core patching library (`app.morphe:morphe-patcher`) |
| morphe-patches | GPL-3.0 | Official bundle: YouTube, YT Music, Reddit, universal ("all") patches |
| morphe-manager | GPL-3.0 | Android manager app |
| morphe-desktop | GPL-3.0 | CLI (from revanced-cli) + Compose desktop GUI; also `brew install morphe` |
| morphe-library | GPL-3.0 | Installers (ADB, local, root mount), repackaging helpers |
| morphe-patches-library | GPL-3.0 | Shared patch utilities (bytecode utils, hex/Hermes/string-replace patches) |
| morphe-patches-gradle-plugin | GPL-3.0 | Builds `.mpp` bundles and `.mpe` extensions |
| morphe-patches-template | GPL-3.0 | Starter for third-party bundles |
| MicroG-RE | Apache-2.0 | GmsCore fork so non-root Google apps can sign in |
| forks: smali, ARSCLib, Apktool, multidexlib2 | various | Toolchain |

## Relationship to ReVanced

- Hard fork (copied, not GitHub-forked) of ReVanced patcher, patches, gradle plugin and
  a ReVanced Manager derivative, by former ReVanced developers. Created 2025-11-26 [V].
- Two DMCA fights since (Morphe vs ReVanced 2026-03, ReVanced vs Morphe 2026-05), both
  about GPLv3 §7 "additional terms" in NOTICE files [V]. Motives come only from partisan
  sources.
- License: GPLv3 plus §7 terms forbidding use of the "Morphe" name and branding by
  derivatives; third-party bundles may say "compatible with Morphe" [V].
- **Lesson for Revamp:** plain GPLv3 with no extra §7 terms. The extra terms are what
  the DMCA fights were about.

## Patch anatomy [V]

**Declaration.** Kotlin DSL, top-level values built with `bytecodePatch {}`,
`resourcePatch {}` or `rawResourcePatch {}`. The loader collects every public value of
type `Patch` by reflection. Unnamed patches are not shown to users, so they serve as
internal dependencies.

Builder API:
- `compatibleWith(...)`
- `dependsOn(...)`
- `extendWith("x.mpe")`
- `execute {}`
- `finalize {}`: runs after all patches, in reverse order
- `availability {}`
- `category(...)`

**Patch types.**
- Bytecode: edits DEX classes via dexlib2.
- Resource: edits decoded resources and XML through a DOM.
- Raw: edits arbitrary files inside the APK.

The patcher decodes only what the selected patch graph needs.

**Execution order.**
- Dependencies run first.
- If a dependency fails, every patch that depends on it fails too.
- Top-level patches run sorted by name.

**Fingerprints.** A fingerprint is a *partial* description of a method, and every
declared trait must match. Traits:
- Method traits: defining class, name, access flags, return type, parameters.
- An unordered set of `strings` the method uses.
- An ordered list of instruction `filters`: string, literal, resourceLiteral (resolved
  from the target's own resource table), methodCall, fieldAccess, opcode, newInstance,
  checkCast, and `anyInstruction(a, b)` for differences between versions.
  - Position constraints: `MatchAfterImmediately`, `MatchAfterWithin(n)`, `MatchFirst`.
  - Gaps between filters are allowed by default.
- A `custom` predicate, and a `classFingerprint` that resolves the class first.

Type strings are matched loosely so obfuscated names don't matter:
- `"L"` = any object type (prefix match).
- A `;` suffix = ends-with match.
- Anything else = contains.

Matching behavior:
- A string → classes index narrows candidates before full matching.
- A fingerprint resolves once, is cached, and can be shared across patches.
- `matchAll` returns every hit.
- Matched instruction indices let the patch insert code at exact positions.
- Pure opcode sequences are discouraged as fragile.

**Compatibility.** Each compatibility entry declares:
- package name, app name and file type
- SHA-256 of the signer certificate
- targets: version, version codes, `isExperimental`, minSdk

A null version means any version. A null package means a *universal* patch, which is
forced default-off. Compatibility is advisory inside the patcher. The CLI enforces it
unless `--force` is passed. A `versionCheckPatch` exposes flags such as
`is_21_05_or_greater` so patches can branch on the app version.

**Options.** Typed: bool, int, long, float, string and their arrays, color, ranges,
sliders, file path, folder, image. Each option takes key, default, `values` (named
presets), title, description, `required` and `validator`. Hosts set them with
`patch.options["key"] = v`, type-checked at runtime.

**Availability.** A per-install-mode function returns ENABLED, DISABLED, REQUIRED or
UNAVAILABLE. Example: the GmsCore patch is required for normal installs and unavailable
for root mount.

**Extensions.** Helper code that gets injected into the patched app:
- Written in Java as an Android module and compiled to DEX. Shipped as `.mpe` inside
  the bundle.
- `compileOnly` *stub* modules declare target-app classes so extension code compiles
  against them without bundling them.
- At patch time the extension classes are merged into the app. Patches then insert
  small `invoke-static` calls into extension methods.
- Runtime toggles live in an injected settings screen, with translated strings.

## Example patches (abbreviated)

Simple ("Hide timestamp"). The fingerprint uses no names or strings, only types,
opcodes and adjacency. The patch inserts a call to an extension method that reads a
setting and returns early:

```kotlin
val hideTimestampPatch = bytecodePatch(name = "Hide timestamp") {
    dependsOn(sharedExtensionPatch, settingsPatch)
    compatibleWith(COMPATIBILITY_YOUTUBE)
    execute {
        PreferenceScreen.SEEKBAR.addPreferences(SwitchPreference("morphe_hide_timestamp"))
        TimeCounterFingerprint.method.addInstructionsWithLabels(0, """
            invoke-static { }, Lapp/morphe/extension/youtube/patches/HideTimestampPatch;->hideTimestamp()Z
            move-result v0
            if-eqz v0, :hide_time
            return-void
            :hide_time
            nop """)
    }
}
```

With options (universal "Change installer source"). A patch factory parameterized by a
string option with presets:

```kotlin
val changeInstallerSource = resourcePatch(name = "Change installer source", default = false) {
    val name = stringOption(key = "packageInstallerName", default = "com.android.vending",
        values = mapOf("Google Play" to "com.android.vending", "Amazon Appstore" to "com.amazon.venezia"),
        title = "Spoofed package installer name")
    dependsOn(changePackageInstallerPatch({ name.value!! }))
}
```

## Bundles and distribution [V]

**Format.** A bundle is one `.mpp` file: a JAR that also carries DEX, so one file loads
on both the desktop JVM and Android. It contains:
- the compiled patches
- the extension `.mpe` files
- manifest attributes: Name, Version, Source, Author, License, Patcher-Version

The Manager shows an "update Morphe" badge if a bundle needs a newer patcher.

**Release** (semantic-release, conventional commits). `feat` = minor release, `fix` and
`bump` = patch release, where `bump` means "updated app support". CI then:
1. Generates `patches-list.json`, a machine-readable dump of every patch, option and
   compatibility entry, plus the README.
2. Commits `patches-bundle.json` = `{version, created_at, description (changelog),
   download_url, signature_download_url: ""}`.
3. Uploads the `.mpp` to GitHub Releases (11.5 MB for 170 patches).
4. Creates a Sigstore build-provenance attestation.
5. Sends a push notification to Manager installs.

**Discovery.** The Manager polls `raw.githubusercontent.com/<owner>/<repo>/<branch>/patches-bundle.json`
and falls back to the GitHub API. Source types:
- GitHub repo
- GitLab repo
- arbitrary JSON URL
- local file
- PR CI artifacts

Other mechanics:
- Stable vs prerelease is a per-source toggle.
- Deep links can add a source, always confirmed by the user.
- Each source gets its own tab. Mixing sources for one app triggers a warning.

**Trust (weak spot).**
- Signature URLs are parsed but never verified.
- Attestations are never checked.
- Trust rests on:
  - TLS to GitHub
  - a remote blocklist of `owner/repo` sources
  - quarantine for bundles that crash on load
  - a UI warning
- Loading a bundle executes arbitrary code in the patcher process [V/I].

## Manager flow [V]

1. **Pick an app.** Only apps declared by enabled sources are listed.
2. **Pick a version.** Simple mode uses the single recommended version (newest
   non-experimental). Expert mode lists all targets, with Recommended, Experimental,
   Saved and Installed badges.
3. **Supply the original.** Morphe does *not* download it. It opens APKMirror at the
   exact version and the user picks the file. Every file is checked for package,
   version and signer hash.
4. **Select patches.** Simple mode applies defaults. Expert mode has per-patch toggles
   and options. Selections persist and can be exported as JSON.
5. **Patch.** Runs in a separate child process with a configurable heap. If the system
   kills it, it retries with less memory.
6. **Sign** with a generated keystore. Losing the keystore means patched apps can't be
   updated in place.
7. **Install** through one of:
   - the system installer
   - Shizuku (silent installs)
   - a root bind-mount over the stock app

   Non-root Google apps get a renamed package plus MicroG.
8. **Update** = re-patch. A badge shows when the bundle changelog touches the app or a
   newer supported version exists. A batch re-patch queue is available.

## Toolchain [V]

- **Bytecode:** smali/dexlib2 fork. The default mode writes only modified or new
  classes into new DEX files.
- **Resources:** ARSCLib, not apktool any more. It re-encodes only the values files a
  patch touched.
- **Signing:** apksig.
- **CLI:** `patch -p <bundle|repo-url> [-e/-d patch] [-Okey=val] [--options-file] [--force] app.apk`,
  plus `list-patches` and `options-create`.

## Pain points and limits (FAQ and docs)

- **Version pinning.** Patches target specific versions. Newer app versions risk
  breakage. New versions land as "experimental" first.
- **Updates are manual re-patches.** Store auto-update overwrites patched apps.
  Outdated patches break features even when the app version is unchanged.
- **Signature conflicts.** The original app must be uninstalled first, which loses its
  data.
- **MicroG friction.** Sign-in, push notifications and similar issues.
- **Resource limits.** Patching is memory and storage heavy on phones.
- **App scope.** Only 3 apps are officially supported (plus universal patches).
- **No pre-patched builds.** The FAQ tells users never to use pre-patched APKs.
- **No legal statement.** There is no "won't patch" policy anywhere.

## Maintenance and testing

- **Fingerprints:**
  - They avoid obfuscated names.
  - They use type wildcards, positional filters, resource-literal lookups and
    `anyInstruction` alternatives to survive version drift.
  - Resources that only exist in some versions are marked optional.
- **App updates:** each new app release is a `bump:` commit adding a target, marked
  experimental first.
- **PR testing:** the PR template requires testing on the minimum and maximum supported
  versions.
- **Patcher tests:** unit tests, coverage, and a CI matrix across OS × JDK.
- **Patch tests:** CI only *builds* the patches. **No CI ever applies patches to a real
  APK.**
- **Scale (v1.47.0):** 170 patches (97 for YouTube), about 500 Kotlin patch files and
  about 635 extension source files.
- **Bundle compatibility:** the patcher keeps old bundles loadable (binary-compatibility
  validator, deprecated constructors kept).
- **Non-DEX targets:** a `hermesPatch` (React Native bundle byte replacement) and a
  generic `hexPatch` exist. Precedent for patching non-native code formats.

## What Revamp takes from this

**Copy:**
- partial-match fingerprints with a cheap string prefilter, cached and shareable
- dependency graph with failure propagation
- typed options with presets
- universal patches, default-off
- compatibility targets (stable/experimental) that the CLI enforces, with `--force`
- extensions + stubs
- one-file bundle with manifest and min-engine version
- `bundle.json` pointer polled from GitHub
- generated patch list JSON
- multiple sources
- "never distribute pre-patched builds"

**Do better, cheaply:**
- Download official releases ourselves and verify pinned SHA-256 per version.
- Pin bundle SHA-256.
- Run bundle code in a sandboxed child process.
- Have CI apply every patch to the real release on every push.

**Skip:**
- signing and keystores (Linux doesn't need re-signing)
- install modes and root mount
- MicroG equivalent
- push infrastructure (a daily timer is enough)

## Sources

- https://github.com/MorpheApp (all repos above)
- https://morphe.software/faq
- https://github.com/MorpheApp/morphe-patcher/issues/22 (ReVanced → Morphe migration guide)
- https://github.com/github/dmca/blob/master/2026/03/2026-03-12-morpheapp.md
- https://github.com/github/dmca/blob/master/2026/05/2026-05-12-revanced.md
- https://morphe-patches.software (community bundle directory)
