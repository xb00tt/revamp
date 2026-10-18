# Changelog

Revamp's own releases (the app: CLI, window and the @revamp-app npm packages). The official patches have their own changelog in [xb00tt/revamp-patches](https://github.com/xb00tt/revamp-patches).

## 1.1.0

- `revamp doctor` checks this machine: libraries, the user-namespace sandbox, `~/.local/bin` on PATH, the daily timer, bundle sources and installed apps. It prints a fix beside failed checks that have one and exits 1 when you can fix it, 2 when something is broken.
- `revamp sandbox <app>` makes Revamped apps start on stock Ubuntu 24.04 and newer: it shows the AppArmor profile and the script root will run, asks once, and installs the profile through `pkexec` (or prints `sudo` instructions without a polkit agent or `pkexec`). `revamp uninstall` offers to remove it again.
- The window shows a banner with a "Fix the sandbox" button per app that needs the profile.
- `revamp patch` and `revamp update` end with `revamp sandbox <app>` when the machine needs the profile and the app has none.
- `@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` 1.1.0 on npm.

## 1.0.0

The first release of Revamp.

- Patch, update, roll back and uninstall Revamped Hydra and Heroic from the `revamp` command or the Revamp window.
- Patches come from bundle sources; [xb00tt/revamp-patches](https://github.com/xb00tt/revamp-patches) is added by default. Every patch runs in a Node permission sandbox, every download is checked against a pinned SHA-256, and Revamp asks before a re-patch turns on new patches.
- A daily check (`revamp timer enable`) tells you when an app release or new patches are out.
- Prebuilt for Linux x86_64: download, then `./revamp self-install`. The window needs WebKitGTK 4.1 (`sudo apt install libwebkit2gtk-4.1-0`), and the binaries need glibc 2.39 or newer (Ubuntu 24.04, Linux Mint 22, or newer).
- For bundle authors: `@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` 1.0.0 on npm.
