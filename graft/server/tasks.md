# server/tasks.ts

- Session · type · L19-L19 — type Session = { id: string; directory: string; title: string; metadata?: Record<string, any> };
- statusOf · function · L21-L27 — async function statusOf(id: string): Promise<StatusResult & { directory: string }>
- fmt · function · L29-L30 — fmt = (id: string, s: StatusResult)
- listModels · function · L32-L43 — async function listModels(): Promise<string>
- promptBody · function · L45-L50 — promptBody = (text: string, model?: string, agent?: string)
- startTask · function · L52-L83 — async function startTask(a: { prompt: string; model?: string; directory?: string; title?: string; agent?: string; worktree?: boolean; readonly?: boolean; }): Promise<string>
- taskStatus · function · L85-L87 — async function taskStatus(a: { task_id: string }): Promise<string>
- waitTask · function · L89-L99 — async function waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string>
- sendMessage · function · L101-L106 — async function sendMessage(a: { task_id: string; message: string; model?: string }): Promise<string>
- norm · function · L108-L108 — norm = (p: string)
- listTasks · function · L110-L122 — async function listTasks(a: { all?: boolean }): Promise<string>
- cancelTask · function · L124-L128 — async function cancelTask(a: { task_id: string }): Promise<string>
- taskDetails · function · L130-L146 — async function taskDetails(a: { task_id: string }): Promise<string>
- finishTask · function · L148-L159 — async function finishTask(a: { task_id: string; action: "merge" | "discard" }): Promise<string>
