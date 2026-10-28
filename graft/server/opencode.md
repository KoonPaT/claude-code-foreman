# server/opencode.ts

- TaskStatus · type · L3-L3 — type TaskStatus = "running" | "done" | "needs_input" | "error";
- StatusResult · type · L4-L4 — type StatusResult = { status: TaskStatus; message?: string; question?: string };
- Message · type · L5-L8 — type Message = { info: { role: "user" | "assistant"; finish?: string; error?: unknown }; parts: Array<{ type: string; text?: string }>; };
- parseModel · function · L10-L14 — function parseModel(id: string): { providerID: string; modelID: string }
- truncate · function · L16-L18 — function truncate(text: string, max = 4000): string
- deriveStatus · function · L20-L36 — function deriveStatus(busy: boolean, messages: Message[]): StatusResult
- baseUrl · function · L38-L40 — function baseUrl(): string
- up · function · L42-L43 — up = ()
- ensureServer · function · L45-L65 — async function ensureServer(): Promise<void>
- api · function · L67-L82 — async function api<T>( method: string, path: string, opts: { directory?: string; body?: unknown } = {}, ): Promise<T>
