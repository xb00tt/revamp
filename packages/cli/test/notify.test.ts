import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyCheck } from "../src/notify.ts";

const fail = (line: string) => assert.fail(`unexpected log: ${line}`);

function recorder(clicked = "") {
  const calls: Array<[string, string[]]> = [];
  const run = (command: string, args: string[]) => {
    calls.push([command, args]);
    return { stdout: command === "notify-send" ? `${clicked}\n` : "", status: 0 };
  };
  return { calls, run };
}

test("one notification for all lines; nothing when there is nothing to say", () => {
  const r = recorder();
  notifyCheck([], "/gui", fail, r.run);
  assert.deepEqual(r.calls, []);
  notifyCheck(["Hydra 4.1.7 out, 6/6 patches apply", "Heroic 2.22.3: Revamp official 0.4.0 is out; re-patch to use it"], undefined, fail, r.run);
  assert.deepEqual(r.calls, [["notify-send", ["--app-name=Revamp", "--", "Revamp", "Hydra 4.1.7 out, 6/6 patches apply\nHeroic 2.22.3: Revamp official 0.4.0 is out; re-patch to use it"]]]);
});

test("with the GUI installed, Open Revamp starts it in its own user unit", () => {
  const clicked = recorder("open");
  notifyCheck(["Hydra 4.1.7 out"], "/home/me/.local/share/revamp/gui/revamp-gui", fail, clicked.run);
  assert.deepEqual(clicked.calls, [
    ["notify-send", ["--app-name=Revamp", "--action=open=Open Revamp", "--", "Revamp", "Hydra 4.1.7 out"]],
    ["systemd-run", ["--user", "--collect", "--quiet", "/home/me/.local/share/revamp/gui/revamp-gui"]],
  ]);
  const dismissed = recorder("");
  notifyCheck(["Hydra 4.1.7 out"], "/gui", fail, dismissed.run);
  assert.equal(dismissed.calls.length, 1);
});

test("bundle text can't format the notification", () => {
  const r = recorder();
  notifyCheck(["<b>Hydra</b> & co 4.1.7 out"], undefined, fail, r.run);
  assert.equal(r.calls[0][1].at(-1), "&lt;b&gt;Hydra&lt;/b&gt; &amp; co 4.1.7 out");
});

test("a notification that can't be shown, or a window that can't start, is logged; the click wait ending isn't", () => {
  const logs: string[] = [];
  const log = (line: string) => void logs.push(line);
  const enoent = Object.assign(new Error("spawnSync notify-send ENOENT"), { code: "ENOENT" });
  notifyCheck(["x"], undefined, log, () => ({ error: enoent, status: null }));
  notifyCheck(["x"], undefined, log, () => ({ status: 1, stderr: "no notification server\n" }));
  const timeout = Object.assign(new Error("spawnSync notify-send ETIMEDOUT"), { code: "ETIMEDOUT" });
  notifyCheck(["x"], "/gui", log, () => ({ error: timeout, status: null, stdout: "" }));
  notifyCheck(["x"], "/gui", log, (command) => (command === "notify-send" ? { status: 0, stdout: "open\n" } : { status: 1, stderr: "Failed to connect to bus" }));
  notifyCheck(["x"], undefined, log, () => ({ status: null, signal: "SIGKILL" }));
  assert.deepEqual(logs, [
    "Couldn't show the notification: notify-send isn't installed",
    "Couldn't show the notification: notify-send exited with 1: no notification server",
    "Couldn't open Revamp: systemd-run exited with 1: Failed to connect to bus",
    "Couldn't show the notification: notify-send was stopped by SIGKILL",
  ]);
});
