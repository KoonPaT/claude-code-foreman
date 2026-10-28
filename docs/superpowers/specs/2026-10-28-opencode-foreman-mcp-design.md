# opencode Foreman MCP — Design

Date: 2026-10-28

## Intent

Claude Code acts as the foreman (หัวหน้างาน), the way it does under
superpowers' subagent-driven-development (SDD): it splits work, dispatches it,
reviews results, and sends fixes back. The difference is who does the work.
Instead of Claude subagents, the workers are **opencode** sessions.

**Why:** save Claude quota and cost. Claude spends its tokens on thinking and
judging; the token-heavy implementation and review work runs in opencode on
cheaper or different models (the user's models sit behind an OpenAI-compatible
API, and already work in opencode directly).

## Goals

1. Claude can dispatch a task to opencode and **not block**. It can do other
   work and check back, or explicitly wait.
2. Claude can **continue the same opencode session** after a result: request
   fixes, and opencode still remembers the task context.
3. opencode can **stop and ask Claude a question** mid-task when something is
   unclear; Claude answers in the same session and the worker continues.
4. **Several tasks in parallel** (e.g. one worker builds a page while another
   reviews).
5. **The user chooses the model.** The user tells Claude, e.g. "use opencode
   with `opencodex/gpt-5.5` to build the login page", and Claude passes that
   model through. If none is named, opencode's configured default model is used.
6. A **foreman skill** that replaces SDD: it teaches Claude the
   dispatch → review → fix loop on top of this MCP.

## Non-goals

- Not a general opencode remote control or UI. Only what the foreman loop needs.
- No custom session store, queue, or database. opencode's server already
  keeps sessions; the MCP is a thin adapter.
- No model routing logic. Claude/user picks the model; the MCP does not choose.

## Anti-goals (a failure even if it technically works)

- Claude ends up doing the heavy implementation itself, which defeats the point.
  The skill must keep Claude in the foreman role.
- A dispatch call that blocks Claude until the worker finishes, so parallel
  work is impossible.
- Worker output dumped into Claude's context in full (long transcripts and
  tool logs). That burns the Claude tokens we are trying to save. Return the
  worker's final message only, with full detail available on request.

## Constraints and environment

- Windows 11, Node v26, opencode 1.19.0 installed and on PATH.
- Models are listed by `opencode models` as `provider/model`
  (e.g. `opencodex/gpt-5.5`, `opencode/big-pickle`). The user's models come
  through an OpenAI-compatible provider configured in opencode.
- This repo (`claude-code-foreman`) is the home for the MCP and the skill.
  It already registers MCP servers in `.mcp.json` (Claude Code) and
  `opencode.json` (opencode).

## Decided by the user

- Claude is the foreman; opencode is the worker, for both implementation and review.
- opencode, not Codex CLI or Aider. Codex's built-in `codex mcp-server` blocks
  per call and cannot ask Claude questions mid-task.
- Both conversation modes: follow-ups in the same session and worker → Claude questions.
- Parallel tasks are required.
- The user picks the model per task through Claude.
- A foreman skill comes with the MCP.
- **Permissions:** workers may edit files and run normal commands unattended.
  Denied: `git push`, deleting files outside the project, and other dangerous
  commands. Anything that would raise a permission prompt is **auto-denied**
  and reported back to Claude in the task result. It never hangs.
- **Isolation and commits:** each parallel task gets its **own git worktree
  and branch**. The worker commits its work there. After review passes, Claude
  merges the branch back and removes the worktree. Review sees exactly one
  task's change (its branch diff).
- **Packaging:** ship as a **Claude Code plugin** that bundles the MCP server and
  the foreman skill together, so installing it once gives any project both.

## Decided by Claude (the builder may revisit with reason)

- **Architecture:** a stdio MCP server in **Node/TypeScript** that talks to a
  `opencode serve` HTTP server using the official `@opencode-ai/sdk`.
- **Server lifetime: shared and long-lived.** The MCP connects to a server at a
  known URL (default a fixed localhost port, overridable by env var). If none
  answers, it starts `opencode serve` **detached** on that port and never kills
  it. Workers therefore survive a Claude restart or MCP reload, several Claude
  windows share one server, and a task can be picked up later by `task_id`.
- **Tagging instead of local state.** Sessions this MCP creates get a title
  prefix (e.g. `[foreman] `). `list_tasks` filters opencode's own session list
  by that prefix, so it still works after a restart.
- **One opencode server and many sessions.** Parallelism means several
  concurrent sessions. Each task is one opencode session; the task id **is**
  the session id. The MCP keeps no state that opencode does not already hold.
- **Mid-task questions by convention, not a special opencode feature.** Every
  dispatched prompt is wrapped in a short worker preamble: "If you are blocked
  on something unclear, stop and end your reply with a line starting
  `QUESTION:` followed by your question." When the worker finishes its turn,
  the MCP reports status `needs_input` if the final message has a `QUESTION:`
  line, otherwise `done`. Claude answers with the same "send message" tool.
  This is simpler and more robust than depending on opencode's interactive
  question or permission prompts.
- **Where the permission rules live:** applied to worker sessions only (e.g. a
  dedicated opencode agent defined by the plugin), not by changing the user's
  global opencode config, so the user's own interactive opencode is unaffected.
- **Worktree lifecycle in the MCP:** `start_task` takes an optional
  `worktree: true` (the skill always sets it for parallel work). The MCP creates the
  worktree and branch, runs the session there, and reports the branch name.
  A `finish_task` tool merges or discards the branch and removes the worktree.

## Tool surface (MCP tools Claude sees)

Names are indicative; the builder may adjust them.

| Tool | Purpose | Returns |
|---|---|---|
| `list_models` | Models opencode can use | `provider/model` ids, plus the default |
| `start_task` | `prompt`, optional `model`, optional `directory` (default: Claude's cwd), optional `title`, optional `agent` (e.g. build/plan). Creates a session, sends the prompt **asynchronously**, returns at once. | `task_id` |
| `task_status` | One task, non-blocking | `running` / `done` / `needs_input` / `error`, plus the final message when not running |
| `wait_task` | Block until one of the given task ids leaves `running`, or a timeout passes | same as `task_status`, for whichever finished |
| `send_message` | Continue a task: a fix request or the answer to a question. Async, like `start_task`; optional `model` override | `task_id` |
| `list_tasks` | Sessions this MCP started, with status | list |
| `cancel_task` | Abort a running session | ok |
| `finish_task` | For worktree tasks: `merge` or `discard` the branch, remove the worktree | result / merge conflicts |
| `task_details` (optional) | Fuller output: files changed / diff summary, tool calls | text, capped in size |

`wait_task` taking several ids is what lets Claude run N workers in parallel and
handle whichever finishes first.

Result sizing: `task_status` and `wait_task` return only the worker's **final
assistant message** (truncated with a note when very long). Anything bigger
goes through `task_details`.

## The foreman skill

A Claude Code skill in this repo (e.g. `.claude/skills/opencode-foreman/SKILL.md`)
that mirrors SDD's loop with opencode as the worker:

1. Read the plan or task list. Identify which tasks are independent.
2. For each task, `start_task` with a self-contained brief: goal, files, constraints,
   and the definition of done. The worker cannot see Claude's context.
   Use the model the user asked for. Run independent tasks in parallel.
3. `wait_task`. On `needs_input`, answer from context with `send_message`.
   Ask the user only if Claude truly cannot answer.
4. On `done`, dispatch a **review task** (a fresh session, optionally a
   different model) to check the change against the brief. Claude reads the
   review and spot-checks the diff itself. Claude is the final judge.
5. If the review fails, `send_message` the findings to the **original
   implementer session** so it fixes with its context intact. Repeat from step 3.
6. Claude stays in the foreman role: it does not take over implementation
   unless the worker repeatedly fails, and then it tells the user.
7. Same-files rule: never run two parallel workers that edit the same files.

Skill additions from the decisions above: parallel tasks always use worktrees;
the review task runs against the implementer's branch; after a pass Claude
calls `finish_task` with `merge`; a permission denial in a result is handled
like a question (re-brief or escalate to the user).

## Packaging

- This repo is a Claude Code plugin: plugin manifest, the MCP server, and the
  foreman skill. Installing the plugin registers both in any project.
- README covers install, the env var for the opencode server URL, and how to
  name a model when instructing Claude.

## Left to the builder

- Exact SDK calls and event handling (polling vs. the server's event stream)
  for detecting "turn finished".
- How to start, find, and reuse the `opencode serve` process (port choice,
  health check, an existing server URL from an env var).
- Precise permission configuration for unattended workers.
- Tool names and parameter schemas, within the surface above.
- Testing approach (a smoke test against a real `opencode serve` with a free
  model such as `opencode/big-pickle` is expected).
