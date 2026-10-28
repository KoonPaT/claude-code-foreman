import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModel, deriveStatus, truncate } from "../server/opencode.ts";
import type { Message } from "../server/opencode.ts";

const user: Message = { info: { role: "user" }, parts: [{ type: "text", text: "go" }] };
const asst = (finish: string | undefined, ...texts: string[]): Message => ({
  info: { role: "assistant", finish },
  parts: texts.map((text) => ({ type: "text", text })),
});

test("parseModel splits on first slash", () => {
  assert.deepEqual(parseModel("opencodex/9arm/qwen3.8-27b-fp8"), { providerID: "opencodex", modelID: "9arm/qwen3.8-27b-fp8" });
  assert.throws(() => parseModel("big-pickle"), /model must be provider\/model/);
});

test("deriveStatus running cases", () => {
  assert.deepEqual(deriveStatus(true, [user, asst("stop", "x")]), { status: "running" });
  assert.deepEqual(deriveStatus(false, [user]), { status: "running" });
  assert.deepEqual(deriveStatus(false, [user, asst("tool-calls")]), { status: "running" });
});

test("deriveStatus done / needs_input", () => {
  assert.deepEqual(deriveStatus(false, [user, asst("stop", "Done. Edited a.ts")]), { status: "done", message: "Done. Edited a.ts" });
  const t = "I read the spec.\nQUESTION: Which port?";
  assert.deepEqual(deriveStatus(false, [user, asst("stop", t)]), { status: "needs_input", question: "Which port?", message: t });
});

test("deriveStatus error", () => {
  const m: Message = { info: { role: "assistant", error: { name: "ProviderAuthError" } }, parts: [] };
  const r = deriveStatus(false, [user, m]);
  assert.equal(r.status, "error");
  assert.match(r.message!, /ProviderAuthError/);
});

test("deriveStatus joins text parts", () => {
  assert.equal(deriveStatus(false, [user, asst("stop", "a", "b")]).message, "a\nb");
});

test("truncate", () => {
  const s = "\n…[truncated; use task_details]";
  const out = truncate("x".repeat(5000));
  assert.equal(out.length, 4000 + s.length);
  assert.ok(out.endsWith("…[truncated; use task_details]"));
  assert.equal(truncate("short"), "short");
});
