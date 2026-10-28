import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function start() {
  const p = spawn("node", ["server/foreman.ts"], {
    env: { ...process.env, FOREMAN_OPENCODE_URL: "http://127.0.0.1:1", FOREMAN_NO_SPAWN: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map<number, (m: any) => void>();
  createInterface({ input: p.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let n = 0;
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((res) => {
      const id = ++n;
      pending.set(id, res);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return { p, rpc };
}

test("mcp protocol", { timeout: 20000 }, async () => {
  const { p, rpc } = start();
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "opencode-foreman");
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const names = (await rpc("tools/list")).result.tools.map((t: any) => t.name);
    assert.deepEqual(names, ["list_models", "start_task", "task_status", "wait_task", "send_message", "list_tasks", "cancel_task", "task_details", "finish_task"]);

    const call = await rpc("tools/call", { name: "task_status", arguments: { task_id: "ses_x" } });
    assert.equal(call.result.isError, true);
    assert.equal((await rpc("tools/list")).result.tools.length, 9);

    assert.equal((await rpc("foo/bar")).error.code, -32601);
  } finally {
    p.kill();
  }
});
