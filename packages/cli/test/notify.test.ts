import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyCheck } from "../src/notify.ts";

function recorder(clicked = "") {
  const calls: Array<[string, string[]]> = [];
  const run = (command: string, args: string[]) => {
    calls.push([command, args]);
    return { stdout: command === "notify-send" ? `${clicked}\n` : "" };
  };
  return { calls, run };
}

test("one notification for all lines; nothing when there is nothing to say", () => {
  const r = recorder();
  notifyCheck([], "/gui", r.run);
  assert.deepEqual(r.calls, []);
  notifyCheck(["Hydra 4.1.7 out, 6/6 patches apply", "Heroic 2.22.3: Revamp official 0.4.0 is out; re-patch to use it"], undefined, r.run);
  assert.deepEqual(r.calls, [["notify-send", ["--app-name=Revamp", "Revamp", "Hydra 4.1.7 out, 6/6 patches apply\nHeroic 2.22.3: Revamp official 0.4.0 is out; re-patch to use it"]]]);
});

test("with the GUI installed, Open Revamp starts it in its own user unit", () => {
  const clicked = recorder("open");
  notifyCheck(["Hydra 4.1.7 out"], "/home/me/.local/share/revamp/gui/revamp-gui", clicked.run);
  assert.deepEqual(clicked.calls, [
    ["notify-send", ["--app-name=Revamp", "--action=open=Open Revamp", "Revamp", "Hydra 4.1.7 out"]],
    ["systemd-run", ["--user", "--collect", "--quiet", "/home/me/.local/share/revamp/gui/revamp-gui"]],
  ]);
  const dismissed = recorder("");
  notifyCheck(["Hydra 4.1.7 out"], "/gui", dismissed.run);
  assert.equal(dismissed.calls.length, 1);
});
