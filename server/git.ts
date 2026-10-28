import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

export type WorktreeInfo = { repo: string; branch: string; worktree: string; base: string };

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (cwd: string, ...args: string[]) => run(cwd, ...args).trim();
const lines = (s: string) => s.split("\n").filter(Boolean);
// diff --name-status -z: status field, NUL, then path(s) — renames/copies carry old then new.
const diffPaths = (raw: string): string[] => {
  const parts = raw.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    out.push(parts[i++]);
    if (code[0] === "R" || code[0] === "C") out.push(parts[i++]);
  }
  return out;
};
// status --porcelain=v1 -z: "XY <path>\0" (space between code and path); renames add "XY <new>\0<old>\0".
const statusPaths = (raw: string): string[] => {
  const parts = raw.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    out.push(p.slice(3));
    if (p[0] === "R" || p[0] === "C") out.push(parts[++i]);
  }
  return out;
};

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
  const base = git(repo, "rev-parse", "--abbrev-ref", "HEAD");
  git(repo, "worktree", "add", "-q", "-b", branch, worktree);
  return { repo, branch, worktree, base };
}

const mergeInProgress = (repo: string) => {
  try {
    git(repo, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
};

export function mergeWorktree(info: WorktreeInfo): string {
  const { repo, branch, worktree } = info;
  if (git(worktree, "status", "--porcelain")) throw new Error("worktree has uncommitted changes; ask the worker to commit");
  const touched = new Set(diffPaths(run(repo, "diff", "--name-status", "-z", "-M", `HEAD...${branch}`)));
  const dirty = statusPaths(run(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")).filter((f) => touched.has(f));
  if (dirty.length) throw new Error(`repo has uncommitted changes in ${dirty.join(", ")}; commit or stash them first`);
  try {
    git(repo, "merge", "--no-ff", "-m", `Merge ${branch}`, branch);
  } catch (e: any) {
    const conflicts = lines(git(repo, "diff", "--name-only", "--diff-filter=U"));
    if (mergeInProgress(repo)) git(repo, "merge", "--abort");
    if (!conflicts.length) throw new Error(`merge failed; worktree kept: ${e.stderr || e.message}`);
    throw new Error(`merge conflict in: ${conflicts.join(", ")}; worktree kept`);
  }
  const sha = git(repo, "rev-parse", "--short", "HEAD");
  let leftover: string | undefined;
  try {
    git(repo, "worktree", "remove", worktree);
  } catch {
    git(repo, "worktree", "prune");
    leftover = worktree;
  }
  git(repo, "branch", "-d", branch);
  const kept = leftover ? `; worktree folder still on disk (in use): ${leftover} — delete it later` : "; worktree removed";
  return `merged ${branch} into ${basename(repo)} (${sha})${kept}`;
}

export function discardWorktree(info: WorktreeInfo): string {
  const { repo, branch, worktree } = info;
  let leftover: string | undefined;
  try {
    git(repo, "worktree", "remove", "--force", worktree);
  } catch {
    leftover = worktree;
  }
  git(repo, "worktree", "prune");
  git(repo, "branch", "-D", branch);
  const kept = leftover ? `; worktree folder still on disk (in use): ${leftover} — delete it later` : "; worktree removed";
  return `discarded ${branch}${kept}`;
}
