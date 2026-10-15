// revamp timer enable|disable (spec §7.3): a systemd user timer runs `revamp check --notify` daily.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "revamp-check.service";
const TIMER = "revamp-check.timer";

export type Systemctl = (...args: string[]) => void;

function systemctl(...args: string[]): void {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
}

/** systemd's ExecStart quoting: the path in double quotes, with \ and " escaped and % and $ doubled. */
const execPath = (path: string) => `"${path.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

export function timerUnits(revamp: string): Record<string, string> {
  return {
    [SERVICE]: `[Unit]\nDescription=Check for new releases of Revamped apps\n\n[Service]\nType=oneshot\nExecStart=${execPath(revamp)} check --notify\n`,
    [TIMER]: `[Unit]\nDescription=Daily Revamp update check\n\n[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=1h\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export function enableTimer(unitDir: string, revamp: string, run: Systemctl = systemctl): void {
  mkdirSync(unitDir, { recursive: true });
  for (const [name, text] of Object.entries(timerUnits(revamp))) writeFileSync(join(unitDir, name), text);
  run("daemon-reload");
  run("enable", "--now", TIMER);
}

export function disableTimer(unitDir: string, run: Systemctl = systemctl): void {
  if (existsSync(join(unitDir, TIMER))) run("disable", "--now", TIMER);
  for (const name of [SERVICE, TIMER]) rmSync(join(unitDir, name), { force: true });
  run("daemon-reload");
}
