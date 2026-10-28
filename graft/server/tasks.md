# server/tasks.ts

- Session · type · L19-L19 — type Session = { id: string; directory: string; title: string; metadata?: Record<string, any> };
- statusOf · function · L21-L27 — async function statusOf(id: string): Promise<StatusResult & { directory: string }>
- fmt · function · L29-L30 — fmt = (id: string, s: StatusResult)
- listModels · function · L32-L40 — async function listModels(): Promise<string>
- promptBody · function · L42-L47 — promptBody = (text: string, model?: string, agent?: string)
- startTask · function · L49-L69 — async function startTask(a: { prompt: string; model?: string; directory?: string; title?: string; agent?: string; worktree?: boolean; }): Promise<string>
- taskStatus · function · L71-L73 — async function taskStatus(a: { task_id: string }): Promise<string>
- waitTask · function · L75-L85 — async function waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string>
- sendMessage · function · L87-L92 — async function sendMessage(a: { task_id: string; message: string; model?: string }): Promise<string>
- norm · function · L94-L94 — norm = (p: string)
- listTasks · function · L96-L108 — async function listTasks(a: { all?: boolean }): Promise<string>
- cancelTask · function · L110-L114 — async function cancelTask(a: { task_id: string }): Promise<string>
- taskDetails · function · L116-L132 — async function taskDetails(a: { task_id: string }): Promise<string>
- finishTask · function · L134-L142 — async function finishTask(a: { task_id: string; action: "merge" | "discard" }): Promise<string>
