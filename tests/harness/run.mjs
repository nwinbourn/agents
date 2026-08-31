#!/usr/bin/env node
/**
 * Sandbox tests for the harness hooks. Zero deps, no framework.
 *
 *   node tests/harness/run.mjs
 *
 * Every hook honours HARNESS_HOME, so each case runs against a throwaway state
 * directory and never touches the real ~/.claude.
 *
 * The invariant checked against every hook with malformed input: stdout is empty
 * or exactly one valid JSON object, exit code 0. That is the repo's fail-open
 * contract — a hook that throws or emits garbage costs the user a turn.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks");
const hook = (n) => join(HOOKS, n);
const ALL_HOOKS = ["harness-core.mjs", "harness-workflow.mjs", "harness-dispatch.mjs"];

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function run(hookName, payload, home) {
  let raw = "";
  let code = 0;
  try {
    raw = execFileSync("node", [hook(hookName)], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, HARNESS_HOME: home },
      timeout: 20000,
    });
  } catch (e) {
    code = e.status ?? 1;
    raw = e.stdout ?? "";
  }
  let out = null;
  if (raw.trim()) {
    try {
      out = JSON.parse(raw);
    } catch {
      throw new Error(`non-JSON stdout: ${raw.slice(0, 200)}`);
    }
  }
  return { out, raw, code };
}

/** Fresh state dir. `config` null means "no harness.json". */
function sandbox(config = { enabled: true }, { mode } = {}) {
  const home = mkdtempSync(join(tmpdir(), "harness-test-"));
  if (config !== null) writeFileSync(join(home, "harness.json"), JSON.stringify(config));
  if (mode) {
    mkdirSync(join(home, "harness"), { recursive: true });
    writeFileSync(join(home, "harness", "mode"), mode);
  }
  return home;
}

function transcript(home, model) {
  const p = join(home, "transcript.jsonl");
  writeFileSync(p, JSON.stringify({ type: "assistant", message: { model } }) + "\n");
  return p;
}

const ctx = (r) => r.out?.hookSpecificOutput?.additionalContext ?? "";
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const reason = (r) => r.out?.hookSpecificOutput?.permissionDecisionReason ?? "";
const wf = (script, over = {}) => ({ tool_name: "Workflow", cwd: process.cwd(), tool_input: { script }, ...over });
const task = (model, over = {}) => ({ tool_name: "Task", cwd: process.cwd(), tool_input: { model, description: "x" }, ...over });
const repeat = (n, line) => Array.from({ length: n }, () => line).join("\n");

const cleanup = [];
const track = (h) => (cleanup.push(h), h);

// ---------------------------------------------------------------- silence ---

check("no config → every hook silent, creates nothing", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox(null));
    const r = run(h, h === "harness-core.mjs" ? { cwd: process.cwd() } : wf("await agent('x',{model:'opus'})"), home);
    assert(r.raw.trim() === "", `${h} emitted output`);
    assert(r.code === 0, `${h} exited ${r.code}`);
    assert(!existsSync(join(home, "harness")), `${h} created state`);
  }
});

check("enabled:false → every hook silent", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox({ enabled: false }));
    const r = run(h, h === "harness-core.mjs" ? { cwd: process.cwd() } : wf(repeat(50, "await agent('x',{model:'fable'})")), home);
    assert(r.raw.trim() === "", `${h} emitted output`);
  }
});

check("corrupt config → silent, not assumed-on", () => {
  for (const h of ALL_HOOKS) {
    const home = mkdtempSync(join(tmpdir(), "harness-test-"));
    track(home);
    writeFileSync(join(home, "harness.json"), "{not json");
    const r = run(h, wf("await agent('x')"), home);
    assert(r.raw.trim() === "", `${h} emitted output on corrupt config`);
    assert(r.code === 0, `${h} exited ${r.code}`);
  }
});

check("malformed payloads → empty or one JSON object, exit 0", () => {
  const bad = ["", "not json", "{", "null", "[]", '{"tool_name":null}', '{"tool_input":"str"}', '{"tool_name":"Workflow","tool_input":null}'];
  for (const h of ALL_HOOKS) {
    const home = track(sandbox());
    for (const payload of bad) {
      const r = run(h, payload, home);
      assert(r.code === 0, `${h} exited ${r.code} on ${JSON.stringify(payload)}`);
    }
  }
});

// ------------------------------------------------------------ core / mode ---

check("core: default posture carries reuse and routing", () => {
  const home = track(sandbox());
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(/ListAgents/.test(c) && /`model`/.test(c), `reuse/routing missing: ${c}`);
  assert(!/ORCHESTRATOR/.test(c), "orchestrator posture leaked into default");
});

check("core: agents mode swaps posture; junk falls back", () => {
  let c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, track(sandbox({ enabled: true }, { mode: "agents" }))));
  assert(/ORCHESTRATOR MODE/.test(c), `expected orchestrator posture: ${c.slice(0, 80)}`);
  for (const m of ["nonsense", "", "x".repeat(200)]) {
    c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, track(sandbox({ enabled: true }, { mode: m }))));
    assert(/ListAgents/.test(c) && !/ORCHESTRATOR/.test(c), `mode ${JSON.stringify(m.slice(0, 12))} did not fall back`);
  }
});

// -------------------------------------------------- workflow fan-out caps ---

check("workflow: under every cap → silent", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf([repeat(12, "await agent('t',{model:'opus'})"), repeat(25, "await agent('t',{model:'sonnet'})")].join("\n")), home);
  assert(r.raw.trim() === "", `under caps should be silent, got: ${reason(r) || ctx(r)}`);
});

check("workflow: over the opus cap (>15) → ASK", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf(repeat(20, "await agent('t',{model:'opus'})")), home);
  assert(decision(r) === "ask", `expected ask, got ${decision(r)}`);
  assert(/20 opus \(cap 15\)/.test(reason(r)), `reason should name the count: ${reason(r)}`);
});

check("workflow: over the fable cap (>3) → ASK", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf(repeat(4, "await agent('t',{model:'fable'})")), home);
  assert(decision(r) === "ask", `expected ask, got ${decision(r)}`);
  assert(/4 fable \(cap 3\)/.test(reason(r)), `reason: ${reason(r)}`);
});

check("workflow: over the sonnet cap (>30) → ASK", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf(repeat(31, "await agent('t',{model:'sonnet'})")), home);
  assert(decision(r) === "ask", `expected ask, got ${decision(r)}`);
  assert(/31 sonnet \(cap 30\)/.test(reason(r)), `reason: ${reason(r)}`);
});

check("workflow: unannotated fan-out on a fable session counts as fable → ASK", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-fable-5");
  const r = run("harness-workflow.mjs", wf(repeat(4, "await agent('t')"), { transcript_path: t }), home);
  assert(decision(r) === "ask", `expected ask, got ${decision(r)}`);
  assert(/inherit/.test(reason(r)) && /fable/.test(reason(r)), `should explain the inherit: ${reason(r)}`);
});

check("workflow: unannotated fan-out on a sonnet session counts as sonnet (silent under 30)", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-sonnet-5");
  const r = run("harness-workflow.mjs", wf(repeat(10, "await agent('t')"), { transcript_path: t }), home);
  assert(r.raw.trim() === "", `10 inherited-sonnet is under cap, should be silent: ${reason(r)}`);
});

check("workflow: unreadable sites (spread/helper) are never counted", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-fable-5");
  const r = run("harness-workflow.mjs", wf(repeat(10, "await agent('t', mk())"), { transcript_path: t }), home);
  assert(r.raw.trim() === "", `unknown verdicts must not count toward a cap: ${reason(r)}`);
});

check("workflow: `model` inside a prompt string doesn't count as set", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-fable-5");
  // 4 sites, model only mentioned inside the prompt text → all 'missing' → inherit fable → over 3
  const r = run("harness-workflow.mjs", wf(repeat(4, "await agent('use model: sonnet please')"), { transcript_path: t }), home);
  assert(decision(r) === "ask", `a string should not satisfy the check: ${reason(r)}`);
});

check("workflow: asks but never denies or allows", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf(repeat(50, "await agent('t',{model:'fable'})")), home);
  assert(decision(r) === "ask", `flagged fan-out must ask, got ${decision(r)}`);
  assert(decision(r) !== "deny" && decision(r) !== "allow", "must never deny or allow");
});

check("workflow: 15k sites completes and stays fast", () => {
  const home = track(sandbox());
  const started = Date.now();
  const r = run("harness-workflow.mjs", wf(repeat(15000, "await agent('t',{model:'opus'})")), home);
  assert(decision(r) === "ask", "should ask on a huge fan-out");
  assert(Date.now() - started < 20000, "took over 20s");
});

check("workflow: a saved workflow with no script isn't policed", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", { tool_name: "Workflow", cwd: process.cwd(), tool_input: { name: "saved" } }, home);
  assert(r.raw.trim() === "", "policed a saved workflow it can't see");
});

check("workflow: does not touch the rolling dispatch counter (re-submit counts fresh)", () => {
  const home = track(sandbox());
  run("harness-workflow.mjs", wf(repeat(20, "await agent('t',{model:'opus'})")), home);
  // a single later dispatch should still be nowhere near the cap
  const r = run("harness-dispatch.mjs", task("opus"), home);
  assert(r.raw.trim() === "", `workflow leaked into the dispatch counter: ${reason(r)}`);
});

// -------------------------------------------------- dispatch burst caps ----

check("dispatch: a single worker of any tier is silent", () => {
  for (const model of ["fable", "opus", "sonnet", "haiku"]) {
    const home = track(sandbox());
    const r = run("harness-dispatch.mjs", task(model), home);
    assert(r.raw.trim() === "", `one ${model} worker should be silent, got: ${reason(r) || ctx(r)}`);
  }
});

check("dispatch: the 4th fable in a window → ASK", () => {
  const home = track(sandbox());
  let last;
  for (let i = 0; i < 4; i++) last = run("harness-dispatch.mjs", task("fable"), home);
  assert(decision(last) === "ask", `4th fable should ask, got ${decision(last)}`);
  assert(/4th fable/.test(reason(last)) && /cap 3/.test(reason(last)), `reason: ${reason(last)}`);
});

check("dispatch: the 16th opus in a window → ASK, 15th is silent", () => {
  const home = track(sandbox());
  let r;
  for (let i = 0; i < 15; i++) r = run("harness-dispatch.mjs", task("opus"), home);
  assert(r.raw.trim() === "", `15th opus should be silent, got: ${reason(r)}`);
  r = run("harness-dispatch.mjs", task("opus"), home);
  assert(decision(r) === "ask", `16th opus should ask, got ${decision(r)}`);
});

check("dispatch: a stale window resets the count", () => {
  const home = track(sandbox({ enabled: true, capWindowSeconds: 1 }));
  for (let i = 0; i < 3; i++) run("harness-dispatch.mjs", task("fable"), home);
  // wait out the 1s window
  execFileSync("node", ["-e", "setTimeout(()=>{}, 1200)"]); // ~1.2s
  const r = run("harness-dispatch.mjs", task("fable"), home);
  assert(r.raw.trim() === "", `after the window reset, one fable should be silent again: ${reason(r)}`);
});

check("dispatch: no model + fable session counts as fable and nudges", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-fable-5");
  const r = run("harness-dispatch.mjs", task(undefined, { transcript_path: t }), home);
  assert(/inherit/.test(ctx(r)), `expected the inherit nudge: ${ctx(r)}`);
  // three more unannotated → the 4th trips the fable cap
  let last;
  for (let i = 0; i < 3; i++) last = run("harness-dispatch.mjs", task(undefined, { transcript_path: t }), home);
  assert(decision(last) === "ask", `unannotated fable workers should accumulate to the cap, got ${decision(last)}`);
});

check("dispatch: no model + sonnet session is silent (inheriting cheap is fine)", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-sonnet-5");
  const r = run("harness-dispatch.mjs", task(undefined, { transcript_path: t }), home);
  assert(r.raw.trim() === "", `one inherited-sonnet worker should be silent, got: ${ctx(r) || reason(r)}`);
});

check("dispatch: an unknowable model is not counted (no guess)", () => {
  const home = track(sandbox());
  for (let i = 0; i < 10; i++) run("harness-dispatch.mjs", task("some-future-model"), home);
  const r = run("harness-dispatch.mjs", task("some-future-model"), home);
  assert(r.raw.trim() === "", `unknown models must not trip a cap: ${reason(r)}`);
});

// ---------------------------------------------------------- cross-platform --

check("state dir with spaces and non-ASCII resolves", () => {
  const base = track(mkdtempSync(join(tmpdir(), "harness-test-")));
  const home = join(base, "my çlaude dir");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "harness.json"), JSON.stringify({ enabled: true }));
  const r = run("harness-workflow.mjs", wf(repeat(20, "await agent('t',{model:'opus'})")), home);
  assert(decision(r) === "ask", "hook failed under an awkward path");
});

// ------------------------------------------------------------------ report --

for (const h of cleanup) {
  try {
    rmSync(h, { recursive: true, force: true });
  } catch {}
}
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
