import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcError, rpcClient, type Transport } from "../src/rpc.ts";

function fake() {
  const sent: string[] = [];
  let deliver: (line: string) => void = () => {};
  let close: (reason: string) => void = () => {};
  const transport: Transport = { send: (line) => void sent.push(line), onLine: (l) => void (deliver = l), onClose: (l) => void (close = l) };
  return { transport, sent, deliver: (message: object) => deliver(JSON.stringify(message)), close: (reason: string) => close(reason) };
}

test("calls get their own id, and replies settle the matching call", async () => {
  const t = fake();
  const rpc = rpcClient(t.transport);
  const first = rpc.call("apps.list");
  const second = rpc.call("patches.list", { appId: "hydra" });
  assert.deepEqual(t.sent.map((l) => JSON.parse(l)), [
    { jsonrpc: "2.0", id: 1, method: "apps.list" },
    { jsonrpc: "2.0", id: 2, method: "patches.list", params: { appId: "hydra" } },
  ]);
  t.deliver({ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "no source" } });
  t.deliver({ jsonrpc: "2.0", id: 1, result: { apps: [] } });
  assert.deepEqual(await first, { apps: [] });
  await assert.rejects(second, (e) => e instanceof RpcError && e.code === -32000 && e.message === "no source");
});

test("notifications reach listeners until they unsubscribe; stray lines are ignored", () => {
  const t = fake();
  const rpc = rpcClient(t.transport);
  const heard: unknown[] = [];
  const stop = rpc.onNotification((method, params) => heard.push([method, params]));
  t.deliver({ jsonrpc: "2.0", method: "job.progress", params: { id: 1, step: "extract" } });
  t.deliver({ jsonrpc: "2.0", id: 99, result: 1 }); // no such call
  stop();
  t.deliver({ jsonrpc: "2.0", method: "job.progress", params: { id: 1, step: "repack" } });
  assert.deepEqual(heard, [["job.progress", { id: 1, step: "extract" }]]);
});

test("a stopped serve rejects pending calls and every later call", async () => {
  const t = fake();
  const rpc = rpcClient(t.transport);
  const heard: string[] = [];
  rpc.onClose((reason) => heard.push(reason));
  const pending = rpc.call("job.patch");
  t.close("exit code 1");
  const stopped = (e: unknown) => e instanceof RpcError && e.code === -32001 && e.message === "revamp serve stopped: exit code 1";
  await assert.rejects(pending, stopped);
  await assert.rejects(rpc.call("apps.list"), stopped);
  assert.deepEqual(heard, ["exit code 1"]);
});
