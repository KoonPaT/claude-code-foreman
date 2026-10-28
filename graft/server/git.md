# server/git.ts

- WorktreeInfo · type · L5-L5 — type WorktreeInfo = { repo: string; branch: string; worktree: string };
- run · function · L7-L8 — run = (cwd: string, ...args: string[])
- git · function · L9-L9 — git = (cwd: string, ...args: string[])
- lines · function · L10-L10 — lines = (s: string)
- slug · function · L12-L15 — function slug(title: string): string
- createWorktree · function · L17-L29 — function createWorktree(repoDir: string, title: string): WorktreeInfo
- mergeWorktree · function · L31-L49 — function mergeWorktree(info: WorktreeInfo): string
- discardWorktree · function · L51-L55 — function discardWorktree(info: WorktreeInfo): string
