import { createInterface } from "node:readline";
import { ensureServer } from "./opencode.ts";
import { handlers } from "./tasks.ts";

// ponytail: hand-rolled stdio JSON-RPC (tools only); switch to @modelcontextprotocol/sdk if we need resources/progress.
const str = (description: string) => ({ type: "string", description });
const model = str("provider/model as listed by list_models; omit for opencode's default");
const tid = { task_id: str("task id from start_task") };
const obj = (properties: object, required: string[] = []) => ({ type: "object", properties, required });

const tools = [
  ["list_models", "List available opencode models as provider/model", obj({})],
  ["start_task", "Start an opencode worker session on a prompt; returns task_id immediately", obj({
    prompt: str("task for the worker"), model, directory: str("working directory; defaults to the server's cwd"),
    title: str("short task title"), agent: str("opencode agent name"),
    worktree: { type: "boolean", description: "run in an isolated git worktree on a new branch" },
  }, ["prompt"])],
  ["task_status", "Get a task's status (running, done, needs_input, error) and latest reply", obj(tid, ["task_id"])],
  ["wait_task", "Block until any of the tasks leaves running, or timeout", obj({
    task_ids: { type: "array", items: { type: "string" }, description: "task ids to wait on" },
    timeout_sec: { type: "number", description: "default 300, max 3600" },
  }, ["task_ids"])],
  ["send_message", "Send a follow-up message to an existing task", obj({ ...tid, message: str("message text"), model }, ["task_id", "message"])],
  ["list_tasks", "List foreman tasks for the current repo", obj({ all: { type: "boolean", description: "include tasks from all directories" } })],
  ["cancel_task", "Abort a running task", obj(tid, ["task_id"])],
  ["task_details", "Full transcript of a task: messages, tool calls, changed files", obj(tid, ["task_id"])],
  ["finish_task", "Merge or discard a worktree task's branch", obj({ ...tid, action: { type: "string", enum: ["merge", "discard"] } }, ["task_id", "action"])],
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

const send = (m: object) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
let ready: Promise<void> | undefined;

async function handle(msg: any) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications get no reply
  if (method === "initialize")
    return send({ id, result: { protocolVersion: params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "opencode-foreman", version: "0.1.0" } } });
  if (method === "tools/list") return send({ id, result: { tools } });
  if (method === "tools/call") {
    try {
      const h = Object.hasOwn(handlers, params?.name) ? handlers[params.name] : undefined;
      if (!h) throw new Error(`unknown tool ${params?.name}`);
      await (ready ??= ensureServer().catch((e) => ((ready = undefined), Promise.reject(e))));
      return send({ id, result: { content: [{ type: "text", text: await h(params.arguments ?? {}) }] } });
    } catch (e: any) {
      console.error(e);
      return send({ id, result: { content: [{ type: "text", text: e.message }], isError: true } });
    }
  }
  send({ id, error: { code: -32601, message: `method not found: ${method}` } });
}

createInterface({ input: process.stdin }).on("line", (l) => {
  try {
    handle(JSON.parse(l));
  } catch (e) {
    console.error("bad line", e);
  }
});
