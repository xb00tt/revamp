import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcError, rpcClient, type Transport } from "../src/rpc.ts";

function fake() {
  const sent: string[] = [];
  let deliver: (line: string) => void = () => {};
  const transport: Transport = { send: (line) => void sent.push(line), onLine: (l) => void (deliver = l) };
  return { transport, sent, deliver: (message: object) => deliver(JSON.stringify(message)) };
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
