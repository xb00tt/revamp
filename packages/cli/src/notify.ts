// revamp check --notify (spec §7.3, §9): one desktop notification for everything the check found. With the GUI
// installed it carries an "Open Revamp" action, which starts the window in its own systemd user unit so it outlives
// the check (a timer's service is stopped, with its processes, when it ends).
import { spawnSync } from "node:child_process";

type Run = (command: string, args: string[], options: { encoding?: "utf8"; timeout?: number; stdio?: "ignore" }) => { stdout?: string | Buffer | null };

export function notifyCheck(lines: string[], gui: string | undefined, run: Run = spawnSync): void {
  if (lines.length === 0) return;
  const body = lines.join("\n");
  // notify-send is optional: without it the lines are still in the timer's journal.
  if (!gui) return void run("notify-send", ["--app-name=Revamp", "--", "Revamp", body], { stdio: "ignore" });
  // -A waits for the click; after ten minutes the check stops waiting and ends.
  const r = run("notify-send", ["--app-name=Revamp", "--action=open=Open Revamp", "--", "Revamp", body], { encoding: "utf8", timeout: 600_000 });
  if (String(r.stdout ?? "").trim() === "open") run("systemd-run", ["--user", "--collect", "--quiet", gui], { stdio: "ignore" });
}
