# server/tasks.ts

- Session · type · L17-L17 — type Session = { id: string; directory: string; title: string; metadata?: Record<string, any> };
- statusOf · function · L19-L25 — async function statusOf(id: string): Promise<StatusResult & { directory: string }>
- fmt · function · L27-L28 — fmt = (id: string, s: StatusResult)
- listModels · function · L30-L38 — async function listModels(): Promise<string>
- promptBody · function · L40-L45 — promptBody = (text: string, model?: string, agent?: string)
- startTask · function · L47-L64 — async function startTask(a: { prompt: string; model?: string; directory?: string; title?: string; agent?: string; worktree?: boolean; }): Promise<string>
- taskStatus · function · L66-L68 — async function taskStatus(a: { task_id: string }): Promise<string>
- waitTask · function · L70-L79 — async function waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string>
- sendMessage · function · L81-L86 — async function sendMessage(a: { task_id: string; message: string; model?: string }): Promise<string>
- norm · function · L88-L88 — norm = (p: string)
- listTasks · function · L90-L102 — async function listTasks(a: { all?: boolean }): Promise<string>
- cancelTask · function · L104-L108 — async function cancelTask(a: { task_id: string }): Promise<string>
- taskDetails · function · L110-L126 — async function taskDetails(a: { task_id: string }): Promise<string>
