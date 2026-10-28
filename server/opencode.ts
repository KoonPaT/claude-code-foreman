import { spawn } from "node:child_process";

export type TaskStatus = "running" | "done" | "needs_input" | "error";
export type StatusResult = { status: TaskStatus; message?: string; question?: string };
export type Message = {
  info: { role: "user" | "assistant"; finish?: string; error?: unknown };
  parts: Array<{ type: string; text?: string }>;
};

export function parseModel(id: string): { providerID: string; modelID: string } {
  const i = id.indexOf("/");
  if (i < 0) throw new Error("model must be provider/model");
  return { providerID: id.slice(0, i), modelID: id.slice(i + 1) };
}

export function truncate(text: string, max = 4000): string {
  return text.length > max ? text.slice(0, max) + "\n…[truncated; use task_details]" : text;
}

export function deriveStatus(busy: boolean, messages: Message[]): StatusResult {
  if (busy) return { status: "running" };
  const last = messages.findLast((m) => m.info.role === "assistant");
  if (!last) return { status: "running" };
  const text = last.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n");
  if (last.info.error) {
    const err = JSON.stringify(last.info.error);
    return { status: "error", message: truncate(text ? `${err}\n${text}` : err) };
  }
  const finish = last.info.finish;
  if (!finish || finish === "tool-calls") return { status: "running" };
  const q = text.match(/^QUESTION:(.*)$/gm)?.at(-1)?.slice("QUESTION:".length).trim();
  if (q !== undefined) return { status: "needs_input", question: q, message: truncate(text) };
  return { status: "done", message: truncate(text) };
}

export function baseUrl(): string {
  return process.env.FOREMAN_OPENCODE_URL ?? "http://127.0.0.1:4096";
}

const up = () => fetch(baseUrl() + "/doc").then((r) => r.ok, () => false);

export async function ensureServer(): Promise<void> {
  if (await up()) return;
  const port = new URL(baseUrl()).port || "4096";
  spawn("opencode", ["serve", "--port", port], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  }).on("error", () => {}).unref(); // ENOENT: fall through to the poll timeout error
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return;
  }
  throw new Error(`could not start opencode serve on ${baseUrl()}`);
}

export async function api<T>(
  method: string,
  path: string,
  opts: { directory?: string; body?: unknown } = {},
): Promise<T> {
  const url = baseUrl() + path + (opts.directory ? `?directory=${encodeURIComponent(opts.directory)}` : "");
  const res = await fetch(url, {
    method,
    headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`opencode ${method} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}
