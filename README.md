# opencode-foreman

A Claude Code plugin that makes Claude the **foreman** and
[opencode](https://opencode.ai) the **worker**. Claude splits work, briefs
opencode sessions, reviews their output, sends fixes back, and merges. The
heavy implementation tokens are spent on whatever model you run in opencode.

It ships:

- **An MCP server** (`server/foreman.ts`) with these tools:
  - `list_models`
  - `start_task`
  - `task_status`
  - `wait_task`
  - `send_message`
  - `list_tasks`
  - `cancel_task`
  - `task_details`
  - `finish_task`
- **The `opencode-foreman` skill**, which teaches Claude the
  dispatch → review → fix → merge loop. It is a replacement for
  subagent-driven development.

## Requirements

- Node ≥ 23.6. The server is plain `.ts` run by Node's built-in type
  stripping, with no npm dependencies and no build step.
- `opencode` on PATH, already working with your models.
- git (for worktree tasks).

## Install

```
/plugin marketplace add KoonPaT/claude-code-foreman
/plugin install opencode-foreman@claude-code-foreman
```

Restart Claude Code. `/mcp` should then list `opencode-foreman`.

## How it works

- **The opencode server.** The MCP talks to an `opencode serve` at
  `FOREMAN_OPENCODE_URL` (default `http://127.0.0.1:4096`). If nothing
  answers there, it starts one **detached** and leaves it running. Workers
  survive Claude restarts, and several Claude windows share one server.
- **Tasks.** Each task is one opencode session, and the task id is the
  session id. Sessions are tagged (`[foreman] ` title prefix plus metadata),
  so `list_tasks` still works after a restart.
- **Status.** `start_task` and `send_message` return immediately.
  `wait_task` blocks until any of the given tasks finishes. A task's status
  is one of:
  - `running`
  - `done`
  - `needs_input`: the worker ended with a `QUESTION:` line
  - `error`
- **Permissions.** Workers run unattended with a per-session ruleset. The
  ruleset denies `git push`, `npm publish`, `sudo`, destructive `rm -rf`,
  writes outside the task directory, and interactive questions. A denied
  command is reported back and never hangs the task. Your own opencode
  config is untouched. The bash deny list is a best-effort pattern match,
  not a sandbox: a determined worker can still find a way to write or push.
- **Worktrees.** With `worktree: true`, the task runs in its own git
  worktree at `<repo>/../<repo>.foreman/<slug>`, on the branch
  `foreman/<slug>`. `finish_task` merges or discards the branch and removes
  the worktree. A conflicting merge is aborted cleanly and the worktree is
  kept.

## Usage

Just ask Claude, naming a model if you want one:

> ใช้ opencode model opencodex/gpt-5.5 ทำหน้า login ตามแผนนี้ แล้วให้ opencode/big-pickle review

> Use opencode with opencodex/gpt-5.5 to implement the plan in docs/plan.md, two tasks in parallel.

If you name no model, Claude asks you to pick one. To control the choices,
set your favorites in `~/.claude/settings.json`:

```json
"env": { "FOREMAN_MODELS": "opencodex/gpt-6-luna,opencodex/tokenme/google/gemma-4-31b-it" }
```

`list_models` shows them first, under `favorites:`.

## Watching workers

Every `start_task` returns a `web:` URL and a `watch:` command for the new
session. Open the `web:` URL in a browser to watch the worker live, or run
the `watch:` command (`opencode attach <url> --session <id>`) to attach.
`list_tasks` gives a quick summary of running and finished tasks.

## Tests

```
npm test                                  # unit + MCP protocol + git tests
FOREMAN_E2E=1 node --test test/e2e.test.ts  # real opencode, free model opencode/big-pickle
```

## License

[MIT](LICENSE)
