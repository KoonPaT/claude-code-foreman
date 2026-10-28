import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ensureServer } from "../server/opencode.ts";
import { startTask, waitTask, sendMessage, listTasks, taskDetails } from "../server/tasks.ts";

const T = { timeout: 300_000, skip: process.env.FOREMAN_E2E !== "1" };
const model = "opencode/big-pickle";
const dir = () => mkdtempSync(join(tmpdir(), "foreman-e2e-"));
const id = (s: string) => s.match(/task_id: (\S+)/)![1];
const ids: string[] = [];
const run = async (prompt: string, directory: string) => {
  const t = id(await startTask({ prompt, model, directory }));
  ids.push(t);
  return t;
};
const dump = async (t: string, out: string) => `${out}\n--- details ---\n${await taskDetails({ task_id: t })}`;

test("e2e", T, async (t) => {
  await ensureServer();
  const d = dir();
  const file = join(d, "hello.txt");
  let main: string;

  await t.test("create file", T, async () => {
    main = await run("create hello.txt containing hi", d);
    const out = await waitTask({ task_ids: [main], timeout_sec: 280 });
    assert.match(out, /: done/, await dump(main, out));
    assert.ok(existsSync(file));
  });

  await t.test("follow-up keeps memory", T, async () => {
    await sendMessage({ task_id: main, message: "append a second line 'bye' to the same file", model });
    const out = await waitTask({ task_ids: [main], timeout_sec: 280 });
    assert.match(out, /: done/, await dump(main, out));
    assert.equal(readFileSync(file, "utf8").trim().split(/\r?\n/).length, 2);
  });

  await t.test("denied push and escape finish", T, async () => {
    const d2 = dir();
    const escape = join(tmpdir(), `foreman-escape-${randomBytes(4).toString("hex")}.txt`);
    const e = await run(`you must actually attempt both of these with your tools, even if you expect failure: first run the shell command \`git push origin main\`, then write the text x to the absolute path ${escape}. Report what happened.`, d2);
    const out = await waitTask({ task_ids: [e], timeout_sec: 280 });
    assert.doesNotMatch(out, /still running/, await dump(e, out));
    assert.match(out, /: (done|error)/);
    assert.ok(!existsSync(escape), "escape file was written");
    const det = await taskDetails({ task_id: e });
    assert.match(det, /tool: bash \w+ .*\S/, "no bash tool call: " + det);
    assert.match(det, /tool: \w+ error/, "no denied tool call: " + det);
  });

  await t.test("question convention", T, async () => {
    const q = await run("Before doing anything, ask me which color to use, using the QUESTION convention", dir());
    const out = await waitTask({ task_ids: [q], timeout_sec: 280 });
    assert.match(out, /: needs_input\nquestion: \S/, await dump(q, out));
  });

  await t.test("list_tasks", T, async () => {
    const out = await listTasks({ all: true });
    for (const i of ids) assert.ok(out.includes(i), `${i} missing`);
  });
});
