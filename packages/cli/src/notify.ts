// revamp check --notify (spec §7.3, §9): one desktop notification for everything the check found. With the GUI
// installed it carries an "Open Revamp" action, which starts the window in its own systemd user unit so it outlives
// the check (a timer's service is stopped, with its processes, when it ends).
import { spawnSync } from "node:child_process";

type Result = { stdout?: string | Buffer | null; stderr?: string | Buffer | null; status?: number | null; signal?: string | null; error?: Error };
type Run = (command: string, args: string[], options: { encoding: "utf8"; timeout?: number }) => Result;

/** Notification servers read the body as markup, so &, < and > in bundle text are escaped to show as written. */
const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Why running `command` failed, or undefined. A timeout is how the wait for a click ends, not a failure. */
function failure(command: string, r: Result): string | undefined {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ETIMEDOUT") return undefined;
  if (code === "ENOENT") return `${command} isn't installed`;
  if (r.error) return `${command}: ${r.error.message}`;
  if (r.status !== 0) return `${command} ${r.signal ? `was stopped by ${r.signal}` : `exited with ${r.status}`}${String(r.stderr ?? "").trim() ? `: ${String(r.stderr).trim()}` : ""}`;
}

/** Shows the notification; what goes wrong goes to `log` (the timer's journal), where the check's lines are too. */
export function notifyCheck(lines: string[], gui: string | undefined, log: (line: string) => void, run: Run = spawnSync): void {
  if (lines.length === 0) return;
  const body = escapeMarkup(lines.join("\n"));
  const ran = (what: string, command: string, r: Result) => {
    const why = failure(command, r);
    if (why) log(`Couldn't ${what}: ${why}`);
    return r;
  };
  if (!gui) return void ran("show the notification", "notify-send", run("notify-send", ["--app-name=Revamp", "--", "Revamp", body], { encoding: "utf8" }));
  // -A waits for the click; after ten minutes the check stops waiting and ends.
  const r = ran("show the notification", "notify-send", run("notify-send", ["--app-name=Revamp", "--action=open=Open Revamp", "--", "Revamp", body], { encoding: "utf8", timeout: 600_000 }));
  if (String(r.stdout ?? "").trim() === "open") ran("open Revamp", "systemd-run", run("systemd-run", ["--user", "--collect", "--quiet", gui], { encoding: "utf8" }));
}
