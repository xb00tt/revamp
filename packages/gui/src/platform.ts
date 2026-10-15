// Where the window runs: the Tauri app (revamp serve as its sidecar) or a browser on Vite's dev server.
import type { Transport } from "./rpc.ts";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function connect(): Promise<Transport> {
  if (inTauri()) {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const command = Command.sidecar("binaries/revamp", ["serve"]);
    let listener = (_line: string) => {};
    command.stdout.on("data", (line) => listener(line));
    command.stderr.on("data", (line) => console.warn("revamp serve:", line));
    const child = await command.spawn();
    return { send: (line) => void child.write(`${line}\n`), onLine: (l) => void (listener = l) };
  }
  const hot = import.meta.hot;
  if (!hot) throw new Error("Revamp's window runs in the Revamp app, or in a browser on `npm run dev -w @revamp/gui`.");
  return { send: (line) => hot.send("revamp:rpc", line), onLine: (l) => hot.on("revamp:rpc", l) };
}

/** A desktop notification when a job ends while the window is in the background. */
export async function notifyDone(body: string): Promise<void> {
  if (!document.hidden) return;
  if (inTauri()) {
    const n = await import("@tauri-apps/plugin-notification");
    if ((await n.isPermissionGranted()) || (await n.requestPermission()) === "granted") n.sendNotification({ title: "Revamp", body });
  } else if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Revamp", { body });
  }
}
