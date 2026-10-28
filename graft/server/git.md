# server/git.ts

- WorktreeInfo · type · L5-L5 — type WorktreeInfo = { repo: string; branch: string; worktree: string; base: string };
- run · function · L7-L8 — run = (cwd: string, ...args: string[])
- git · function · L9-L9 — git = (cwd: string, ...args: string[])
- lines · function · L10-L10 — lines = (s: string)
- diffPaths · function · L12-L22 — diffPaths = (raw: string): string[]
- statusPaths · function · L24-L34 — statusPaths = (raw: string): string[]
- slug · function · L36-L39 — function slug(title: string): string
- createWorktree · function · L41-L54 — function createWorktree(repoDir: string, title: string): WorktreeInfo
- mergeInProgress · function · L56-L63 — mergeInProgress = (repo: string)
- dropBranch · function · L66-L73 — dropBranch = (repo: string, flag: string, branch: string)
- mergeWorktree · function · L75-L99 — function mergeWorktree(info: WorktreeInfo): string
- discardWorktree · function · L101-L112 — function discardWorktree(info: WorktreeInfo): string
