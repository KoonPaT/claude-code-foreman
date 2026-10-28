---
name: opencode-foreman
description: Use when the user asks to delegate implementation or code review to opencode ("use opencode", "สั่ง opencode", "ให้ opencode ทำ", "foreman"), or to execute a plan with opencode workers instead of Claude subagents. Claude stays the foreman; opencode does the work.
---

# opencode Foreman

You are the foreman. opencode sessions are your workers. The point is to spend
Claude tokens on judgment, not on typing code: **do not implement the work
yourself.** Your job is to split, brief, dispatch, review, and decide.

Tools (MCP server `opencode-foreman`): `list_models`, `start_task`,
`task_status`, `wait_task`, `send_message`, `list_tasks`, `cancel_task`,
`task_details`, `finish_task`.

## Model

Use the model the user named, as `provider/model` (check `list_models` if
unsure of the exact id). If the user named none, omit `model` so opencode
uses its default. If the user named a separate model for review, use it for
review tasks.

## The loop

1. **Split.** Read the plan or request. List the tasks and mark which are
   independent. Never run two tasks in parallel that touch the same files.
2. **Brief and dispatch.** For each task, call `start_task` with a
   self-contained brief. The worker cannot see your context, so include
   the goal, the files involved, constraints, how to verify, and the
   definition of done. For any work in a git repo, set `worktree: true`.
   Independent tasks are dispatched together, before you wait on any of them.
3. **Wait.** Call `wait_task` with all running task ids. It returns
   whichever finishes first. Handle that one, then wait again on the rest.
   - `needs_input`: answer from your own context with `send_message`. Ask
     the user only if you genuinely cannot answer.
   - A reply that mentions a **denied command**: treat it like a question.
     Re-brief the worker around the denial, or escalate to the user if the
     denied action is truly needed.
   - `error`: read the message. Use `task_details` only if it's unclear.
     Then re-send or re-dispatch.
4. **Review.** When an implementation task is `done`, dispatch a **fresh**
   review task (`start_task` with `readonly: true`, no worktree, `directory`
   = the implementer's worktree path). Tell the reviewer to run
   `git diff <base>...<branch>` using the `base:` and `branch:` values
   `start_task` returned for the implementation task, check it against the
   original brief, and reply with a PASS/FAIL verdict and findings with
   file:line. Use the review model if the user named one. Right after
   dispatching, show the user the `web:` / `watch:` line from `start_task`
   once so they can watch. Read the verdict, then spot-check the diff
   yourself. **You are the final judge.**
5. **Fix.** On FAIL, `send_message` the findings to the **original
   implementer** task, not a new one, so it keeps its context. Go back to
   step 3, then review again.
6. **Merge.** On PASS, call `finish_task` with `action: "merge"`. On a merge
   conflict, the worktree is kept: send the implementer a message to rebase
   or resolve it, or resolve it yourself if it's trivial. Use
   `action: "discard"` for abandoned work.
7. **Escalate, don't take over.** After 3 failed fix rounds on one task,
   stop and tell the user what is failing. Don't silently do the work
   yourself.

## Keep Claude's context small

- `wait_task` and `task_status` return only the worker's final message.
  That is usually enough.
- Use `task_details` only when a result is ambiguous or you need the
  transcript.
- Don't paste whole files into briefs. Name the paths and let the worker
  read them.

## Report to the user

Give short progress lines as tasks finish (which task, which model,
pass/fail). At the end, say what was merged, what is still open, and
anything that was escalated.
