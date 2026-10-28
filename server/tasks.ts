import { resolve } from "node:path";
import { api, baseUrl, deriveStatus, parseModel } from "./opencode.ts";
import { createWorktree, discardWorktree, mergeWorktree } from "./git.ts";
import type { WorktreeInfo } from "./git.ts";
import type { Message, StatusResult } from "./opencode.ts";

const PREFIX = "[foreman] ";
const PREAMBLE =
  "You are a worker dispatched by a foreman (another AI) who cannot see your screen. Work autonomously to finish the task. If you are blocked by something genuinely unclear, stop and end your reply with a single line starting with `QUESTION:` followed by your question. If a command or tool is denied, do not retry it; mention it in your final reply. When you finish, reply with a concise summary: what you changed, files touched, how you verified it, and anything left undone. When working in a git worktree, commit your work before replying.";

const bashDeny = ["*git*push*", "*npm*publish*", "*sudo *", "*rm -rf /*", "*rm -rf ~*", "*rm -rf ..*", "*Remove-Item*-Recurse*"];
const PERMISSION = [
  { permission: "*", pattern: "*", action: "allow" },
  { permission: "question", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" },
  ...bashDeny.map((pattern) => ({ permission: "bash", pattern, action: "deny" })),
];

type Session = { id: string; directory: string; title: string; metadata?: Record<string, any> };

export async function statusOf(id: string): Promise<StatusResult & { directory: string }> {
  const { directory } = await api<Session>("GET", `/session/${id}`);
  const map = await api<Record<string, { type: string }>>("GET", "/session/status", { directory });
  const messages = await api<Message[]>("GET", `/session/${id}/message`, { directory });
  const t = map[id]?.type;
  return { ...deriveStatus(t === "busy" || t === "retry", messages), directory };
}

const fmt = (id: string, s: StatusResult) =>
  [`${id}: ${s.status}`, s.question && `question: ${s.question}`, s.message].filter(Boolean).join("\n");

export async function listModels(): Promise<string> {
  const r = await api<{ providers: { id: string; models: Record<string, unknown> }[]; default: Record<string, string> }>(
    "GET",
    "/config/providers",
  );
  const all = r.providers
    .flatMap((p) => Object.keys(p.models).map((m) => `${p.id}/${m}${r.default[p.id] === m ? " (default)" : ""}`))
    .join("\n");
  // FOREMAN_MODELS: comma-separated provider/model ids the user picks from most often
  const fav = (process.env.FOREMAN_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return fav.length ? `favorites:\n${fav.join("\n")}\n\nall:\n${all}` : all;
}

const promptBody = (text: string, model?: string, agent?: string) => ({
  parts: [{ type: "text", text }],
  system: PREAMBLE,
  ...(model ? { model: parseModel(model) } : {}),
  ...(agent ? { agent } : {}),
});

export async function startTask(a: {
  prompt: string;
  model?: string;
  directory?: string;
  title?: string;
  agent?: string;
  worktree?: boolean;
  readonly?: boolean;
}): Promise<string> {
  if (a.model) parseModel(a.model);
  if (a.readonly && a.worktree) throw new Error("readonly tasks cannot use a worktree");
  const title = a.title ?? a.prompt.slice(0, 50);
  const wt = a.worktree ? createWorktree(a.directory ?? process.cwd(), title) : undefined;
  try {
    const directory = wt?.worktree ?? a.directory ?? process.cwd();
    // ponytail: readonly only denies the `edit` tool; bash can still write files. Upgrade path: also
    // deny bash write patterns (e.g. "*> *", "*writeFile*") for a fully read-only worker.
    const permission = a.readonly ? [...PERMISSION, { permission: "edit", pattern: "*", action: "deny" }] : PERMISSION;
    const s = await api<Session>("POST", "/session", {
      directory,
      body: { title: PREFIX + title, metadata: { foreman: true, ...wt }, permission },
    });
    await api<void>("POST", `/session/${s.id}/prompt_async`, { directory, body: promptBody(a.prompt, a.model, a.agent) });
    const out = [`task_id: ${s.id}`];
    if (wt) out.push(`branch: ${wt.branch}`, `base: ${wt.base}`, `worktree: ${wt.worktree}`);
    out.push(`watch: opencode attach ${baseUrl()} --session ${s.id}`, `web: ${baseUrl()}`);
    return out.join("\n");
  } catch (e) {
    if (wt) try { discardWorktree(wt) } catch {}
    throw e;
  }
}

export async function taskStatus(a: { task_id: string }): Promise<string> {
  return fmt(a.task_id, await statusOf(a.task_id));
}

export async function waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string> {
  const sec = Number(a.timeout_sec ?? 300);
  const deadline = Date.now() + (Number.isFinite(sec) ? Math.min(Math.max(sec, 0), 3600) : 300) * 1000;
  for (;;) {
    const all = await Promise.all(a.task_ids.map(async (id) => [id, await statusOf(id)] as const));
    const fin = all.filter(([, s]) => s.status !== "running");
    if (fin.length) return fin.map(([id, s]) => fmt(id, s)).join("\n\n");
    if (Date.now() >= deadline) return `still running: ${a.task_ids.join(", ")}`;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function sendMessage(a: { task_id: string; message: string; model?: string }): Promise<string> {
  if (a.model) parseModel(a.model);
  const { directory } = await api<Session>("GET", `/session/${a.task_id}`);
  await api<void>("POST", `/session/${a.task_id}/prompt_async`, { directory, body: promptBody(a.message, a.model) });
  return `sent to ${a.task_id}`;
}

const norm = (p: string) => resolve(p).toLowerCase();

export async function listTasks(a: { all?: boolean }): Promise<string> {
  const cwd = norm(process.cwd());
  const sessions = (await api<Session[]>("GET", "/experimental/session?limit=100")).filter(
    (s) => s.metadata?.foreman === true && (a.all || norm(s.directory) === cwd || (s.metadata.repo && norm(s.metadata.repo) === cwd)),
  );
  const rows = await Promise.all(
    sessions.map(async (s) => {
      const st = await statusOf(s.id).catch(() => ({ status: "error" }));
      return `${s.id}  ${st.status}  ${s.title}  ${s.directory}${s.metadata?.branch ? `  ${s.metadata.branch}` : ""}`;
    }),
  );
  return rows.join("\n") || "no tasks";
}

export async function cancelTask(a: { task_id: string }): Promise<string> {
  const { directory } = await api<Session>("GET", `/session/${a.task_id}`);
  await api<void>("POST", `/session/${a.task_id}/abort`, { directory });
  return `cancelled ${a.task_id}`;
}

export async function taskDetails(a: { task_id: string }): Promise<string> {
  const { directory } = await api<Session>("GET", `/session/${a.task_id}`);
  const msgs = await api<{ info: { role: string }; parts: any[] }[]>("GET", `/session/${a.task_id}/message`, { directory });
  const out = msgs.map((m) => {
    const lines = m.parts.flatMap((p) =>
      p.type === "text" && p.text
        ? [p.text]
        : p.type === "tool"
          ? [`tool: ${p.tool} ${p.state?.status}${p.state?.error ? " " + p.state.error : ""}`]
          : [],
    );
    return `[${m.info.role}]\n${lines.join("\n")}`;
  });
  const diff = await api<{ file: string }[]>("GET", `/session/${a.task_id}/diff`, { directory }).catch(() => []);
  out.push(`files changed:\n${diff.map((d) => d.file).join("\n") || "(none)"}`);
  return out.join("\n\n").slice(0, 20000);
}

export async function finishTask(a: { task_id: string; action: "merge" | "discard" }): Promise<string> {
  const { metadata } = await api<Session>("GET", `/session/${a.task_id}`);
  if (!metadata?.worktree) throw new Error("task has no worktree");
  if ((await statusOf(a.task_id)).status === "running") throw new Error("task is still running");
  const info = metadata as WorktreeInfo;
  try {
    await api<void>("POST", "/instance/dispose", { directory: info.worktree });
  } catch {}
  if (a.action === "merge") return mergeWorktree(info);
  if (a.action === "discard") return discardWorktree(info);
  throw new Error(`action must be merge or discard`);
}

export const handlers: Record<string, (args: any) => Promise<string>> = {
  list_models: listModels,
  start_task: startTask,
  task_status: taskStatus,
  wait_task: waitTask,
  send_message: sendMessage,
  list_tasks: listTasks,
  cancel_task: cancelTask,
  task_details: taskDetails,
  finish_task: finishTask,
};
