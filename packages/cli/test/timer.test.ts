import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableTimer, enableTimer, timerUnits } from "../src/timer.ts";

test("enable writes the daily timer and its service, then starts the timer; disable undoes both", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "revamp-timer-")), "systemd/user");
  const calls: string[] = [];
  const run = (...args: string[]) => void calls.push(args.join(" "));
  enableTimer(dir, "/home/me/.local/share/revamp/bin/revamp", run);
  assert.equal(
    readFileSync(join(dir, "revamp-check.service"), "utf8"),
    '[Unit]\nDescription=Check for new releases of Revamped apps\n\n[Service]\nType=oneshot\nExecStart="/home/me/.local/share/revamp/bin/revamp" check --notify\n',
  );
  assert.equal(
    readFileSync(join(dir, "revamp-check.timer"), "utf8"),
    "[Unit]\nDescription=Daily Revamp update check\n\n[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=1h\n\n[Install]\nWantedBy=timers.target\n",
  );
  assert.deepEqual(calls, ["daemon-reload", "enable --now revamp-check.timer"]);

  disableTimer(dir, run);
  assert.equal(existsSync(join(dir, "revamp-check.service")) || existsSync(join(dir, "revamp-check.timer")), false);
  assert.deepEqual(calls.slice(2), ["disable --now revamp-check.timer", "daemon-reload"]);
  disableTimer(dir, run); // nothing to disable: only the reload
  assert.deepEqual(calls.slice(4), ["daemon-reload"]);
});

test("ExecStart quotes the path the way systemd reads it", () => {
  assert.match(timerUnits('/home/a b/100%$"x\\/revamp')["revamp-check.service"], /^ExecStart="\/home\/a b\/100%%\$\$\\"x\\\\\/revamp" check --notify$/m);
});
