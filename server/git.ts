import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

export type WorktreeInfo = { repo: string; branch: string; worktree: string };

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (cwd: string, ...args: string[]) => run(cwd, ...args).trim();
const lines = (s: string) => s.split("\n").filter(Boolean);

function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return `${s || "task"}-${randomBytes(2).toString("hex")}`;
}

export function createWorktree(repoDir: string, title: string): WorktreeInfo {
  let repo: string;
  try {
    repo = git(repoDir, "rev-parse", "--show-toplevel");
  } catch {
    throw new Error(`not a git repository: ${repoDir}`);
  }
  const s = slug(title);
  const branch = `foreman/${s}`;
  const worktree = join(dirname(repo), `${basename(repo)}.foreman`, s);
  git(repo, "worktree", "add", "-q", "-b", branch, worktree);
  return { repo, branch, worktree };
}

export function mergeWorktree(info: WorktreeInfo): string {
  const { repo, branch, worktree } = info;
  if (git(worktree, "status", "--porcelain")) throw new Error("worktree has uncommitted changes; ask the worker to commit");
  const touched = new Set(lines(git(repo, "diff", "--name-only", `HEAD...${branch}`)));
  const dirty = lines(run(repo, "status", "--porcelain")).map((l) => l.slice(3)).filter((f) => touched.has(f));
  if (dirty.length) throw new Error(`repo has uncommitted changes in ${dirty.join(", ")}; commit or stash them first`);
  try {
    git(repo, "merge", "--no-ff", "-m", `Merge ${branch}`, branch);
  } catch (e: any) {
    const conflicts = lines(git(repo, "diff", "--name-only", "--diff-filter=U"));
    if (!conflicts.length) throw new Error(`merge failed; worktree kept: ${e.stderr || e.message}`);
    git(repo, "merge", "--abort");
    throw new Error(`merge conflict in: ${conflicts.join(", ")}; worktree kept`);
  }
  const sha = git(repo, "rev-parse", "--short", "HEAD");
  git(repo, "worktree", "remove", worktree);
  git(repo, "branch", "-d", branch);
  return `merged ${branch} into ${basename(repo)} (${sha}); worktree removed`;
}

export function discardWorktree(info: WorktreeInfo): string {
  git(info.repo, "worktree", "remove", "--force", info.worktree);
  git(info.repo, "branch", "-D", info.branch);
  return `discarded ${info.branch}; worktree removed`;
}
