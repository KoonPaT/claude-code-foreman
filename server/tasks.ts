import { resolve } from "node:path";
import { api, deriveStatus, parseModel } from "./opencode.ts";
import type { Message, StatusResult } from "./opencode.ts";

const PREFIX = "[foreman] ";
const PREAMBLE =
  "You are a worker dispatched by a foreman (another AI) who cannot see your screen. Work autonomously to finish the task. If you are blocked by something genuinely unclear, stop and end your reply with a single line starting with `QUESTION:` followed by your question. If a command or tool is denied, do not retry it; mention it in your final reply. When you finish, reply with a concise summary: what you changed, files touched, how you verified it, and anything left undone. When working in a git worktree, commit your work before replying.";

const bashDeny = ["*git push*", "*npm publish*", "*sudo *", "*rm -rf /*", "*rm -rf ~*", "*rm -rf ..*", "*Remove-Item*-Recurse*"];
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
  return r.providers
    .flatMap((p) => Object.keys(p.models).map((m) => `${p.id}/${m}${r.default[p.id] === m ? " (default)" : ""}`))
    .join("\n");
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
}): Promise<string> {
  if (a.worktree) throw new Error("worktree support not implemented");
  if (a.model) parseModel(a.model);
  const directory = a.directory ?? process.cwd();
  const s = await api<Session>("POST", "/session", {
    directory,
    body: { title: PREFIX + (a.title ?? a.prompt.slice(0, 50)), metadata: { foreman: true }, permission: PERMISSION },
  });
  await api<void>("POST", `/session/${s.id}/prompt_async`, { directory, body: promptBody(a.prompt, a.model, a.agent) });
  return `task_id: ${s.id}`;
}

export async function taskStatus(a: { task_id: string }): Promise<string> {
  return fmt(a.task_id, await statusOf(a.task_id));
}

export async function waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string> {
  const deadline = Date.now() + Math.min(a.timeout_sec ?? 300, 3600) * 1000;
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

export const handlers: Record<string, (args: any) => Promise<string>> = {
  list_models: listModels,
  start_task: startTask,
  task_status: taskStatus,
  wait_task: waitTask,
  send_message: sendMessage,
  list_tasks: listTasks,
  cancel_task: cancelTask,
  task_details: taskDetails,
  finish_task: async () => {
    throw new Error("not implemented");
  },
};
