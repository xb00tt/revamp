# Changelog

Revamp's own releases (the app: CLI, window and the @revamp-app npm packages). The official patches have their own changelog in [xb00tt/revamp-patches](https://github.com/xb00tt/revamp-patches).

## 1.0.0

The first release of Revamp.

- Patch, update, roll back and uninstall Revamped Hydra and Heroic from the `revamp` command or the Revamp window.
- Patches come from bundle sources; [xb00tt/revamp-patches](https://github.com/xb00tt/revamp-patches) is added by default. Every patch runs in a Node permission sandbox, every download is checked against a pinned SHA-256, and Revamp asks before a re-patch turns on new patches.
- A daily check (`revamp timer enable`) tells you when an app release or new patches are out.
- Prebuilt for Linux x86_64: download, then `./revamp self-install`. The window needs WebKitGTK 4.1 (`sudo apt install libwebkit2gtk-4.1-0`), and the binaries need glibc 2.39 or newer (Ubuntu 24.04, Linux Mint 22, or newer).
- For bundle authors: `@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` 1.0.0 on npm.
