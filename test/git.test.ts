import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createWorktree, discardWorktree, mergeWorktree } from "../server/git.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "foreman-git-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "user.email", "t@t");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return git(dir, "rev-parse", "--show-toplevel");
}

const commitIn = (dir: string, file: string, text: string) => {
  writeFileSync(join(dir, file), text);
  git(dir, "add", ".");
  git(dir, "commit", "-qm", file);
};

test("createWorktree makes a sibling worktree on a slugged branch", () => {
  const r = repo();
  const w = createWorktree(r, "Login Page!");
  assert.match(w.branch, /^foreman\/login-page-[0-9a-f]{4}$/);
  assert.equal(w.base, "main");
  assert.equal(basename(dirname(w.worktree)), basename(r) + ".foreman");
  assert.ok(existsSync(w.worktree));
  assert.ok(git(r, "worktree", "list").includes(basename(w.worktree)));
});

test("mergeWorktree merges a committed branch and cleans up", () => {
  const r = repo();
  const w = createWorktree(r, "feat");
  commitIn(w.worktree, "b.txt", "b\n");
  assert.match(mergeWorktree(w), /merged/);
  assert.ok(existsSync(join(r, "b.txt")));
  assert.equal(git(r, "branch", "--list", w.branch), "");
  assert.ok(!existsSync(w.worktree));
});

test("mergeWorktree refuses uncommitted changes", () => {
  const r = repo();
  const w = createWorktree(r, "dirty");
  writeFileSync(join(w.worktree, "c.txt"), "c\n");
  assert.throws(() => mergeWorktree(w), /uncommitted/);
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree aborts on conflict and keeps the worktree", () => {
  const r = repo();
  const w = createWorktree(r, "conflict");
  commitIn(w.worktree, "a.txt", "branch\n");
  commitIn(r, "a.txt", "main\n");
  assert.throws(() => mergeWorktree(w), /merge conflict in: a\.txt/);
  assert.equal(git(r, "status", "--porcelain"), "");
  assert.equal(readFileSync(join(r, "a.txt"), "utf8"), "main\n");
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree refuses when the repo has dirty files the branch touches", () => {
  const r = repo();
  const w = createWorktree(r, "overlap");
  commitIn(w.worktree, "a.txt", "branch\n");
  writeFileSync(join(r, "a.txt"), "local edit\n");
  assert.throws(() => mergeWorktree(w), /uncommitted changes in a\.txt/);
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree catches dirty files with spaces in their names", () => {
  const r = repo();
  const w = createWorktree(r, "spaces");
  commitIn(w.worktree, "a b.txt", "branch\n");
  writeFileSync(join(r, "a b.txt"), "local edit\n");
  assert.throws(() => mergeWorktree(w), /uncommitted changes in a b\.txt/);
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree catches dirty files renamed in the branch", () => {
  const r = repo();
  const w = createWorktree(r, "rename");
  git(w.worktree, "mv", "a.txt", "moved.txt");
  git(w.worktree, "commit", "-qm", "rename");
  writeFileSync(join(r, "a.txt"), "local edit\n");
  assert.throws(() => mergeWorktree(w), /uncommitted changes in a\.txt/);
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree catches untracked files inside new directories", () => {
  const r = repo();
  const w = createWorktree(r, "untracked");
  mkdirSync(join(w.worktree, "src"), { recursive: true });
  commitIn(w.worktree, "src/new.ts", "n\n");
  mkdirSync(join(r, "src"), { recursive: true });
  writeFileSync(join(r, "src/new.ts"), "local\n");
  assert.throws(() => mergeWorktree(w), /uncommitted changes in src\/new\.ts/);
  assert.ok(existsSync(w.worktree));
});

test("mergeWorktree still merges when the worktree folder is locked", { skip: process.platform !== "win32" }, async () => {
  const r = repo();
  const w = createWorktree(r, "locked");
  commitIn(w.worktree, "b.txt", "b\n");
  // opencode holds the worktree folder as its process cwd; Windows refuses to delete a dir that
  // is some process's cwd (an open file handle won't block: libuv opens with FILE_SHARE_DELETE).
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1e3)"], { cwd: w.worktree, stdio: "ignore" });
  try {
    await new Promise((res) => setTimeout(res, 100));
    const out = mergeWorktree(w);
    assert.match(out, /merged/);
    assert.match(out, /still on disk/);
    assert.equal(git(r, "branch", "--list", w.branch), "");
    assert.ok(existsSync(w.worktree));
  } finally {
    child.kill();
  }
});

test("discardWorktree removes branch and dir", () => {
  const r = repo();
  const w = createWorktree(r, "nope");
  commitIn(w.worktree, "d.txt", "d\n");
  discardWorktree(w);
  assert.equal(git(r, "branch", "--list", w.branch), "");
  assert.ok(!existsSync(w.worktree));
});

test("createWorktree rejects a non-repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "foreman-nogit-"));
  assert.throws(() => createWorktree(dir, "x"), /not a git repository/);
});
