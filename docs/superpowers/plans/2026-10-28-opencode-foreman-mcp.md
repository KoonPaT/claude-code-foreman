# opencode Foreman MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin with an MCP server that lets Claude dispatch, wait on, converse with, and merge opencode worker sessions, plus a foreman skill that replaces SDD.

**Architecture:** A zero-dependency Node stdio MCP server (`server/foreman.ts`, run directly by Node's built-in TypeScript type stripping) talks over HTTP to a shared, long-lived `opencode serve`. Each task is one opencode session (task id = session id). Session `metadata` and a title prefix carry all task state, so the MCP holds none. Parallel tasks run in their own git worktree and branch.

**Tech Stack:** Node ≥ 23.6 (native `.ts`, global `fetch`, `node:test`), git, opencode 1.19 HTTP API. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-opencode-foreman-mcp-design.md`

## Deviations from spec (builder's calls, allowed by spec)

- **Raw `fetch` instead of `@opencode-ai/sdk`, hand-rolled MCP stdio instead of `@modelcontextprotocol/sdk`.** Reason: plugins install from git without `node_modules`. With zero dependencies there is no install or build step. The opencode surface used is 8 endpoints and the MCP surface is 3 methods. `ponytail:` comment in `foreman.ts`: switch to the official SDK if we need MCP features beyond tools (resources, progress notifications).

## Verified opencode facts (probed against opencode 1.19.0)

- `POST /session?directory=<dir>` body `{title, metadata, permission: [{permission, pattern, action: "allow"|"deny"|"ask"}]}` → `Session` with `id`, `directory`, `metadata`, `title`, `time`.
- The permission ruleset is **last-match-wins**. A `deny` returns an error to the model; the model continues and reports it. The session does not hang.
- `POST /session/{id}/prompt_async?directory=<dir>` body `{parts:[{type:"text",text}], model?:{providerID, modelID}, agent?, system?}` → empty 204 at once.
- `GET /session/status?directory=<dir>` → `{[sessionID]: {type:"busy"|"retry"|"idle"}}`. **Idle sessions may be absent.**
- `GET /session/{id}/message?directory=<dir>` → `[{info:{role, finish?, error?, time}, parts:[{type:"text",text}|{type:"tool",tool,state:{status,error?}}]}]`. A finished turn ends with an assistant message whose `finish` is `"stop"`. Intermediate ones have `finish:"tool-calls"`.
- `GET /experimental/session?limit=N` → sessions across all directories (includes `metadata`).
- `GET /session/{id}` → `Session`. `POST /session/{id}/abort` aborts.
- `GET /config/providers` → `{providers:[{id, models:{[modelID]:…}}], default:{[providerID]: modelID}}`.
- Model ids may contain `/` (e.g. `opencodex/9arm/qwen3.8-27b-fp8` = provider `opencodex`, model `9arm/qwen3.8-27b-fp8`). Split on the **first** `/` only.
- `GET /doc` responds when the server is up (health check).

## Global Constraints

- Server URL: env `FOREMAN_OPENCODE_URL`, default `http://127.0.0.1:4096`.
- If the URL does not answer `GET /doc`, spawn `opencode serve --port <port>` **detached** (`stdio:"ignore"`, `unref()`, `shell:true` on win32 because `opencode` is a `.cmd`). Wait up to 30 s. **Never kill it.**
- Title prefix: `[foreman] `. Metadata on every created session: `{foreman: true}`, plus `{repo, branch, worktree}` for worktree tasks.
- Permission ruleset on every worker session, in this order:
  1. `{permission:"*", pattern:"*", action:"allow"}`
  2. `{permission:"question", pattern:"*", action:"deny"}` (the worker must use the `QUESTION:` convention instead)
  3. `{permission:"external_directory", pattern:"*", action:"deny"}`
  4. bash denies (`permission:"bash"`, `action:"deny"`) for these patterns: `*git push*`, `*npm publish*`, `*sudo *`, `*rm -rf /*`, `*rm -rf ~*`, `*rm -rf ..*`, `*Remove-Item*-Recurse*`
- Never use `action:"ask"` anywhere. Nobody is there to answer.
- Worker preamble, sent as the `system` field of every prompt (exact copy):
  > You are a worker dispatched by a foreman (another AI) who cannot see your screen. Work autonomously to finish the task. If you are blocked by something genuinely unclear, stop and end your reply with a single line starting with `QUESTION:` followed by your question. If a command or tool is denied, do not retry it; mention it in your final reply. When you finish, reply with a concise summary: what you changed, files touched, how you verified it, and anything left undone. When working in a git worktree, commit your work before replying.
- Final message returned to Claude is truncated at 4000 characters with the suffix `\n…[truncated; use task_details]`.
- Worktree location: `<repoParent>/<repoName>.foreman/<slug>`. Branch: `foreman/<slug>`. `slug` = lowercase title, non-alphanumerics → `-`, max 40 chars, plus `-` and 4 random hex chars.
- MCP protocol: echo the client's `protocolVersion` from `initialize`; `serverInfo: {name:"opencode-foreman", version:"0.1.0"}`; capabilities `{tools:{}}`.

## Review Focus

1. **A model id containing `/`** (e.g. `opencodex/9arm/qwen3.8-27b-fp8`) must split on the first `/` only. Covered by the `parseModel` test in Task 1.
2. **Checking status right after dispatch**, before opencode marks the session busy, must report `running`, not `done`. Covered by the "last message is user" case in the Task 1 `deriveStatus` tests.
3. **A worker that writes outside its directory or runs `git push`** must be denied, and the task must still finish rather than hang. Covered by the Task 2 e2e test.
4. **Merging a worktree task that has uncommitted changes, or that conflicts with main**, must not leave the user's repo mid-merge. The merge is refused or aborted cleanly and the worktree is kept. Covered by Task 3 tests.
5. **Tool errors** (opencode down, unknown task id, invalid model) must return as MCP tool results with `isError: true` and a readable message, never crash the stdio loop. Covered by the Task 2 protocol test.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `{"type":"module","private":true,"scripts":{"test":"node --test test/"}}`, nothing else |
| `server/opencode.ts` | HTTP client for opencode, `ensureServer`, `parseModel`, `deriveStatus` |
| `server/git.ts` | Worktree create / merge / discard |
| `server/tasks.ts` | The tool handlers (business logic), one function per tool |
| `server/foreman.ts` | Entry point: stdio JSON-RPC loop + tool schema table → `tasks.ts` |
| `test/opencode.test.ts`, `test/git.test.ts`, `test/mcp.test.ts`, `test/e2e.test.ts` | Tests (`node:test` + `node:assert/strict`) |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Plugin packaging |
| `skills/opencode-foreman/SKILL.md` | Foreman skill |
| `README.md` | Install and usage |

---

### Task 1: opencode client and status derivation

**Files:**
- Create: `package.json`, `server/opencode.ts`
- Test: `test/opencode.test.ts`

**Interfaces:**
- Produces:
  - `type TaskStatus = "running" | "done" | "needs_input" | "error"`
  - `type StatusResult = { status: TaskStatus; message?: string; question?: string }`
  - `parseModel(id: string): { providerID: string; modelID: string }`. Throws `Error("model must be provider/model")` if there is no `/`.
  - `deriveStatus(busy: boolean, messages: Message[]): StatusResult` (pure)
  - `truncate(text: string, max = 4000): string`
  - `baseUrl(): string`: reads `FOREMAN_OPENCODE_URL`
  - `ensureServer(): Promise<void>`
  - `api<T>(method: string, path: string, opts?: { directory?: string; body?: unknown }): Promise<T>`. Appends `?directory=` when given. Throws `Error("opencode <method> <path> → <status>: <body>")` on non-2xx. Returns `undefined` for an empty body.
  - `type Message = { info: { role: "user" | "assistant"; finish?: string; error?: unknown }; parts: Array<{ type: string; text?: string }> }`

- [ ] **Step 1: Write the failing tests** in `test/opencode.test.ts`:
  - `parseModel("opencodex/9arm/qwen3.8-27b-fp8")` → `{providerID:"opencodex", modelID:"9arm/qwen3.8-27b-fp8"}`; `parseModel("big-pickle")` throws.
  - `deriveStatus(true, [...])` → `{status:"running"}`.
  - `deriveStatus(false, [userMsg])` → `running` (just dispatched).
  - `deriveStatus(false, [userMsg, assistant finish:"tool-calls"])` → `running`.
  - `deriveStatus(false, [userMsg, assistant finish:"stop" text "Done. Edited a.ts"])` → `{status:"done", message:"Done. Edited a.ts"}`.
  - Same, with text `"I read the spec.\nQUESTION: Which port?"` → `{status:"needs_input", question:"Which port?", message: <full text>}`.
  - Assistant with `error:{name:"ProviderAuthError"}` → `status:"error"`, and `message` contains `ProviderAuthError`.
  - Multiple text parts in the final assistant message are joined with `\n`.
  - `truncate("x".repeat(5000))` has length `4000 + suffix` and ends with `…[truncated; use task_details]`.
- [ ] **Step 2:** Run `node --test test/`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `server/opencode.ts`.** `ensureServer` does `fetch(baseUrl()+"/doc")`. If that fails, it spawns the server per Global Constraints and polls `/doc` every 500 ms for up to 30 s, then throws `Error("could not start opencode serve on <url>")`.
- [ ] **Step 4:** Run `node --test test/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: opencode client and status derivation`.

---

### Task 2: MCP server with task tools

**Files:**
- Create: `server/tasks.ts`, `server/foreman.ts`
- Test: `test/mcp.test.ts`, `test/e2e.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces (in `tasks.ts`; each returns a `string` that becomes the tool's text content, or throws):
  - `listModels(): Promise<string>`: lines `provider/model`, with `(default)` marked per provider
  - `startTask(a: { prompt: string; model?: string; directory?: string; title?: string; agent?: string; worktree?: boolean }): Promise<string>`. Returns `task_id: <id>` (+ `branch: …` when worktree). `directory` defaults to `process.cwd()`.
  - `taskStatus(a: { task_id: string }): Promise<string>`
  - `waitTask(a: { task_ids: string[]; timeout_sec?: number }): Promise<string>`. Default timeout 300, max 3600. Polls every 2 s. Returns the first task(s) that leave `running`; on timeout, reports `still running: <ids>`.
  - `sendMessage(a: { task_id: string; message: string; model?: string }): Promise<string>`
  - `listTasks(a: { all?: boolean }): Promise<string>`. Lists sessions from `/experimental/session?limit=100` where `metadata.foreman === true`, each with title, status, directory, and branch. Unless `all`, only those whose directory is cwd or a worktree of cwd's repo.
  - `cancelTask(a: { task_id: string }): Promise<string>`
  - `taskDetails(a: { task_id: string }): Promise<string>`. Every message: text parts plus one line per tool call (`tool: <name> <status> <error?>`), plus `GET /session/{id}/diff` file list. Capped at 20000 chars.
  - Internal helper `statusOf(id): Promise<StatusResult & { directory: string }>`: `GET /session/{id}` → directory → status map + messages → `deriveStatus`.
  - `export const handlers: Record<string, (args: any) => Promise<string>>` keyed by tool name. Task 3 adds `finish_task`.
- `foreman.ts`: reads newline-delimited JSON-RPC on stdin and handles `initialize`, `notifications/initialized` (no reply), `tools/list`, and `tools/call`. Unknown methods with an `id` get error `-32601`. A tool that throws → `{content:[{type:"text",text:err.message}], isError:true}`. Calls `ensureServer()` lazily, on the first `tools/call` only, so `initialize` is instant. Writes nothing but JSON-RPC to stdout; logs go to stderr. The tool schema table (JSON Schema `inputSchema` per tool, with a one-line `description`) lives here. The `model` description says: `"provider/model as listed by list_models; omit for opencode's default"`.

- [ ] **Step 1: Write the failing protocol test** `test/mcp.test.ts`. Spawn `node server/foreman.ts` with `FOREMAN_OPENCODE_URL=http://127.0.0.1:1` (dead port; the spawn fallback must not trigger, so also set `FOREMAN_NO_SPAWN=1`, which `ensureServer` honors by throwing immediately). Then assert:
  - `initialize` with `protocolVersion:"2025-06-18"` echoes it back and has `serverInfo.name === "opencode-foreman"`.
  - `tools/list` names exactly: `list_models, start_task, task_status, wait_task, send_message, list_tasks, cancel_task, task_details, finish_task`. `finish_task` is listed now; its handler arrives in Task 3, and until then it throws `"not implemented"`.
  - `tools/call task_status {task_id:"ses_x"}` → `isError: true`, and the process is still alive and answers another `tools/list`.
  - Unknown method `foo/bar` with id → error code `-32601`.
- [ ] **Step 2:** Run `node --test test/mcp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `server/tasks.ts` and `server/foreman.ts`.** Add the `FOREMAN_NO_SPAWN` check to `ensureServer` in `opencode.ts`.
- [ ] **Step 4:** Run `node --test test/mcp.test.ts`. Expected: PASS.
- [ ] **Step 5: Write the e2e test** `test/e2e.test.ts`. Skip unless `FOREMAN_E2E=1`. It uses the real server and model `opencode/big-pickle` (free) in a fresh temp dir, and calls the handlers directly:
  - `startTask` → "create hello.txt containing hi" → `waitTask` → status `done`, and the file exists.
  - `sendMessage` same task → "append a second line 'bye'" → `waitTask` → file has 2 lines (session memory works).
  - New task: "run `git push origin main`, then write the absolute path C:\\foreman-escape.txt (or /tmp/foreman-escape.txt)" → finishes (`done`, not hung), and the escape file does not exist.
  - New task: "Before doing anything, ask me which color to use, using the QUESTION convention" → `needs_input`, with a non-empty `question`.
  - `listTasks({all:true})` includes these task ids.
- [ ] **Step 6:** Run `FOREMAN_E2E=1 node --test test/e2e.test.ts`. Expected: PASS. (Model behavior can be flaky; on a failed run, read `taskDetails` output before changing code.)
- [ ] **Step 7: Commit** `feat: MCP server with opencode task tools`.

---

### Task 3: Worktrees and finish_task

**Files:**
- Create: `server/git.ts`
- Modify: `server/tasks.ts` (the `worktree` option in `startTask`; the `finishTask` handler)
- Test: `test/git.test.ts`

**Interfaces:**
- Produces in `git.ts` (all use `execFileSync("git", …)`, never a shell string):
  - `createWorktree(repoDir: string, title: string): { repo: string; branch: string; worktree: string }`. `repo` = `git rev-parse --show-toplevel`. Branches from current HEAD. Throws `Error("not a git repository: <dir>")`.
  - `mergeWorktree(info: {repo, branch, worktree}): string`. Order:
    1. If `git -C worktree status --porcelain` is non-empty, throw `Error("worktree has uncommitted changes; ask the worker to commit")`.
    2. If the repo's own working tree is dirty in files the branch touches, throw.
    3. `git -C repo merge --no-ff -m "Merge foreman/<slug>" <branch>`. On failure, run `git merge --abort` and throw `Error("merge conflict in: <files>; worktree kept")`.
    4. `git worktree remove` + `git branch -d`.
    5. Return a summary with the merge commit sha.
  - `discardWorktree(info): string`: `git worktree remove --force` + `git branch -D`.
- In `tasks.ts`:
  - `startTask` with `worktree:true` calls `createWorktree(directory, title)`, uses `worktree` as the session directory, and stores `{repo, branch, worktree}` in metadata.
  - `finishTask(a: { task_id: string; action: "merge" | "discard" }): Promise<string>` reads metadata from `GET /session/{id}`. It throws `"task has no worktree"` if absent and `"task is still running"` if running.

- [ ] **Step 1: Write the failing tests** `test/git.test.ts`. Each test inits a temp repo with one commit (set `user.name`/`user.email` locally in the repo).
  - `createWorktree(repo, "Login Page!")`: the branch matches `/^foreman\/login-page-[0-9a-f]{4}$/`, the worktree dir exists as a sibling under `<repoName>.foreman/`, and `git worktree list` includes it.
  - Commit a new file in the worktree → `mergeWorktree` → the file exists in the repo, the branch is gone, and the worktree dir is gone.
  - An uncommitted file in the worktree → `mergeWorktree` throws `/uncommitted/`, and the worktree still exists.
  - Conflicting edits to the same line on main and on the branch → throws `/merge conflict in: a.txt/`. Afterwards `git -C repo status --porcelain` is empty (no half merge) and the worktree still exists.
  - `discardWorktree` → the branch and the dir are gone.
  - `createWorktree` on a non-repo temp dir throws `/not a git repository/`.
- [ ] **Step 2:** Run `node --test test/git.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `server/git.ts`** and wire it into `tasks.ts` (replacing the `finish_task` "not implemented" stub).
- [ ] **Step 4:** Run `node --test test/`. Expected: all PASS.
- [ ] **Step 5: Extend the e2e test.** Add a `startTask({worktree:true})` "create feature.txt and commit it" → `waitTask` done → `finishTask merge` → `feature.txt` is in the temp repo. Run `FOREMAN_E2E=1 node --test test/e2e.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: per-task git worktrees and finish_task`.

---

### Task 4: Plugin packaging, foreman skill, README

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/opencode-foreman/SKILL.md`, `README.md`
- Test: manual check in Claude Code (below)

**Interfaces:**
- `plugin.json`: `{"name":"opencode-foreman","version":"0.1.0","description":"Claude as foreman, opencode as worker","mcpServers":{"opencode-foreman":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/server/foreman.ts"]}}}`. The MCP server is declared inline because the repo-root `.mcp.json` belongs to graft.
- `marketplace.json`: a single-plugin local marketplace named `claude-code-foreman` with source `"./"`.

- [ ] **Step 1: Write `skills/opencode-foreman/SKILL.md`.**
  - Frontmatter `name: opencode-foreman`. The `description` triggers on "use opencode", "สั่ง opencode", "foreman", executing a plan with opencode, or delegating implementation or review to opencode.
  - The body encodes the spec's foreman loop (steps 1–7) and its skill additions, using the exact tool names from Task 2/3. Must include:
    - Briefs are self-contained, because the worker can't see Claude's context.
    - Use the model the user named. Without one, omit `model` (but the review task may use a different model if the user said so).
    - Parallel tasks always use `worktree:true`. Never run two parallel tasks that touch the same files.
    - Review = a fresh `start_task` that tells the reviewer to run `git diff main...<branch>` in the worktree directory. Claude spot-checks the diff itself.
    - Send fixes to the original implementer via `send_message`.
    - Handle `needs_input` from context first. Treat a permission denial like a question.
    - After a pass, call `finish_task merge`.
    - Claude stays foreman. After 3 failed fix rounds on a task, stop and tell the user rather than doing it itself.
    - Return only the minimum to Claude's context. Use `task_details` only when a result is unclear.
- [ ] **Step 2: Write `README.md`.** Cover:
  - Requirements: Node ≥ 23.6, opencode, git.
  - Install: `/plugin marketplace add <path-or-git-url>` then `/plugin install opencode-foreman@claude-code-foreman`.
  - `FOREMAN_OPENCODE_URL`, and the fact that the server is started detached and left running.
  - Example prompts in Thai and English that name a model.
  - Running tests (`npm test`, `FOREMAN_E2E=1`).
- [ ] **Step 3: Verify the plugin loads.** Run `claude plugin validate .`. Expected: no errors. If the subcommand is unavailable in the installed version, install via the marketplace and check that `/mcp` lists `opencode-foreman` with 9 tools.
- [ ] **Step 4: Verify the loop end to end.** In a scratch git repo, prompt Claude: "ใช้ opencode model opencode/big-pickle สร้างไฟล์ hello.txt แล้ว review" and confirm that Claude follows the skill: it calls `start_task` with `worktree:true`, then `wait_task`, a review `start_task`, and `finish_task merge`.
- [ ] **Step 5: Commit** `feat: package as plugin with foreman skill`.
