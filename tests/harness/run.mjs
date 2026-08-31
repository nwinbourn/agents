#!/usr/bin/env node
/**
 * Sandbox tests for the harness hooks. Zero deps, no framework.
 *
 *   node tests/harness/run.mjs
 *
 * Both hooks honour HARNESS_HOME, so every case runs against a throwaway state
 * directory and never touches the real ~/.claude.
 *
 * The invariant that matters most is checked against both hooks with malformed
 * input: stdout is empty or exactly one valid JSON object, and the exit code is
 * 0. That's the repo's fail-open contract, mechanised — a hook that throws or
 * emits garbage costs the user a turn.
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

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Run a hook with a payload and a state dir. Returns {out, raw, code}. */
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

/** Fresh state dir. `config` null means "no harness.json at all". */
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
const wf = (script, over = {}) => ({ tool_name: "Workflow", cwd: process.cwd(), tool_input: { script }, ...over });

const cleanup = [];
const track = (h) => (cleanup.push(h), h);

// ---------------------------------------------------------------- silence ---

check("no config → both hooks silent, create nothing", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox(null));
    const r = run(h, wf("await agent('x')"), home);
    assert(r.raw.trim() === "", `${h} emitted output`);
    assert(r.code === 0, `${h} exited ${r.code}`);
    assert(!existsSync(join(home, "harness")), `${h} created state`);
  }
});

check("enabled:false → both hooks silent", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox({ enabled: false }));
    const r = run(h, wf("await agent('x')"), home);
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
      const r = run(h, payload, home); // run() throws on non-JSON stdout
      assert(r.code === 0, `${h} exited ${r.code} on ${JSON.stringify(payload)}`);
    }
  }
});

// ------------------------------------------------------------ core / mode ---

check("core: default posture carries reuse and routing", () => {
  const home = track(sandbox());
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(/ListAgents/.test(c) && /SendMessage/.test(c), `reuse rule missing: ${c}`);
  assert(/`model`/.test(c), "routing rule missing");
  assert(!/ORCHESTRATOR/.test(c), "orchestrator posture leaked into the default");
  assert(run("harness-core.mjs", { cwd: process.cwd() }, home).out.suppressOutput === true, "core should suppress its own output");
});

check("core: stays small — the whole point of it being a pointer", () => {
  const home = track(sandbox());
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(c.length < 900, `standard core is ${c.length} chars; it is injected every turn, keep it under ~900`);
});

check("core: agents mode swaps in the orchestrator posture", () => {
  const home = track(sandbox({ enabled: true }, { mode: "agents" }));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(/ORCHESTRATOR MODE/.test(c), `expected orchestrator posture: ${c.slice(0, 120)}`);
  assert(/END YOUR TURN after dispatching/.test(c), "missing the end-the-turn instruction");
  assert(/ListAgents/.test(c), "reuse rule missing from agents mode");
});

check("core: unknown or junk mode falls back to standard", () => {
  for (const m of ["nonsense", "", "../../etc/passwd", "x".repeat(200)]) {
    const home = track(sandbox({ enabled: true }, { mode: m }));
    const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
    assert(/ListAgents/.test(c) && !/ORCHESTRATOR/.test(c), `mode ${JSON.stringify(m.slice(0, 12))} did not fall back`);
  }
});

check("core: a user override without sections still works", () => {
  const home = track(sandbox({ enabled: true }, { mode: "agents" }));
  writeFileSync(join(home, "harness-core.md"), ["```", "my own core", "```", ""].join("\n"));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(/my own core/.test(c), `unsectioned override ignored: ${c}`);
});

// -------------------------------------------------------- workflow routing --

const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const reason = (r) => r.out?.hookSpecificOutput?.permissionDecisionReason ?? "";

check("workflow: unannotated sites on an expensive session → ASK the user", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf("await agent('a')\nawait agent('b')", { transcript_path: t }), home);
  assert(decision(r) === "ask", `expected an ask, got ${decision(r)}`);
  assert(/no model/.test(reason(r)) && /inherits/.test(reason(r)), `reason should carry the finding: ${reason(r)}`);
  assert(/Deny/.test(reason(r)), "reason should tell the user what deny does");
});

check("workflow: unannotated on a CHEAP session is a note, not an ask", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-sonnet-5");
  const r = run("harness-workflow.mjs", wf("await agent('a')\nawait agent('b')", { transcript_path: t }), home);
  assert(decision(r) === undefined, `inheriting sonnet is fine — got ${decision(r)}`);
  assert(/Set it deliberately/.test(ctx(r)), `expected the gentle note: ${ctx(r)}`);
});

check("dispatch: a fable worker → ASK", () => {
  const home = track(sandbox());
  const r = run("harness-dispatch.mjs", { tool_name: "Task", tool_input: { model: "fable", description: "x" } }, home);
  assert(decision(r) === "ask", `expected an ask, got ${decision(r)}`);
  assert(/fable/.test(reason(r)) && /Deny/.test(reason(r)), `reason should name fable and the deny path: ${reason(r)}`);
});

check("dispatch: opus, sonnet, haiku workers are silent", () => {
  const home = track(sandbox());
  for (const model of ["opus", "sonnet", "haiku"]) {
    const r = run("harness-dispatch.mjs", { tool_name: "Task", tool_input: { model, description: "x" } }, home);
    assert(r.raw.trim() === "", `${model} should be silent, got: ${r.raw.slice(0, 120)}`);
  }
});

check("dispatch: no model + expensive session → note only, no ask", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-fable-5");
  const r = run("harness-dispatch.mjs", { tool_name: "Task", tool_input: { description: "x" }, transcript_path: t }, home);
  assert(decision(r) === undefined, `should not ask, got ${decision(r)}`);
  assert(/inherits/.test(ctx(r)), `expected the inherit note: ${ctx(r)}`);
});

check("dispatch: no model + cheap session → silent", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-sonnet-5");
  const r = run("harness-dispatch.mjs", { tool_name: "Task", tool_input: { description: "x" }, transcript_path: t }, home);
  assert(r.raw.trim() === "", `should be silent, got: ${r.raw.slice(0, 120)}`);
});

check("workflow: fully annotated cheap script says nothing", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const script = Array.from({ length: 6 }, (_, i) => `await agent('t${i}', {model:'sonnet'})`).join("\n");
  const r = run("harness-workflow.mjs", wf(script, { transcript_path: t }), home);
  assert(r.raw.trim() === "", `deliberate routing should be silent, got: ${ctx(r)}`);
});

check("workflow: a top-heavy fan-out → ASK", () => {
  const home = track(sandbox());
  const script = Array.from({ length: 6 }, (_, i) => `await agent('t${i}', {model:'opus'})`).join("\n");
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(decision(r) === "ask", `expected an ask, got ${decision(r)}`);
  assert(/top-tier/.test(reason(r)), `reason should name the pattern: ${reason(r)}`);
});

check("workflow: a couple of expensive sites is normal, not flagged", () => {
  const home = track(sandbox());
  const script = ["await agent('a', {model:'opus'})", "await agent('b', {model:'sonnet'})", "await agent('c', {model:'sonnet'})", "await agent('d', {model:'sonnet'})"].join("\n");
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(r.raw.trim() === "", `mixed routing should be silent, got: ${ctx(r)}`);
});

check("workflow: fable in a fleet → ASK", () => {
  const home = track(sandbox());
  const script = ["await agent('a', {model:'fable'})", "await agent('b', {model:'sonnet'})"].join("\n");
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(decision(r) === "ask", `expected an ask, got ${decision(r)}`);
  assert(/fable/.test(reason(r)), `reason should name fable: ${reason(r)}`);
});

check("workflow: asks but never denies", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const scripts = ["await agent('a')", Array.from({ length: 20 }, (_, i) => `await agent('t${i}', {model:'fable'})`).join("\n")];
  for (const script of scripts) {
    const r = run("harness-workflow.mjs", wf(script, { transcript_path: t }), home);
    assert(decision(r) === "ask", `flagged waste must ask, got ${decision(r)}`);
  }
});

check("workflow: `model` inside a prompt string doesn't count as set", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf("await agent('please use model: sonnet here')", { transcript_path: t }), home);
  assert(decision(r) === "ask", `unannotated on expensive session should ask, got ${decision(r)}`);
  assert(/no model/.test(reason(r)), `a string should not satisfy the check: ${reason(r)}`);
});

check("workflow: quoted object key counts as set", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf(`await agent('x', { "model": "sonnet" })`, { transcript_path: t }), home);
  assert(r.raw.trim() === "", `quoted key should count as annotated, got: ${ctx(r)}`);
});

check("workflow: unreadable opts are never flagged", () => {
  const home = track(sandbox());
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf("await agent('a', {...o})\nawait agent('b', mk())", { transcript_path: t }), home);
  assert(r.raw.trim() === "", `unreadable opts must not produce findings, got: ${ctx(r)}`);
});

check("workflow: 15k sites completes and stays fast", () => {
  const home = track(sandbox());
  const script = Array.from({ length: 15000 }, (_, i) => `await agent('t${i}', {model:'opus'})`).join("\n");
  const started = Date.now();
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(r.raw.trim() !== "", "no stdout on a large script — this is the fail-closed mode");
  assert(Date.now() - started < 20000, "took over 20s");
});

check("workflow: a saved workflow with no script isn't policed", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", { tool_name: "Workflow", cwd: process.cwd(), tool_input: { name: "saved" } }, home);
  assert(r.raw.trim() === "", "policed a saved workflow it can't see");
});

check("workflow: unreadable transcript degrades quietly", () => {
  const home = track(sandbox());
  const r = run("harness-workflow.mjs", wf("await agent('a')", { transcript_path: join(home, "nope.jsonl") }), home);
  assert(r.code === 0, "crashed on a missing transcript");
  assert(!/inherit this session/.test(ctx(r)), "claimed to know the session model without reading it");
});

// ---------------------------------------------------------- cross-platform --

check("state dir with spaces and non-ASCII resolves", () => {
  const base = mkdtempSync(join(tmpdir(), "harness-test-"));
  track(base);
  const home = join(base, "my çlaude dir");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "harness.json"), JSON.stringify({ enabled: true }));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd() }, home));
  assert(/ListAgents/.test(c), "hook failed under an awkward path");
});

check("hooks run from an unrelated cwd (relative lib imports resolve)", () => {
  const home = track(sandbox());
  const raw = execFileSync("node", [hook("harness-core.mjs")], {
    input: JSON.stringify({ cwd: process.cwd() }),
    encoding: "utf8",
    cwd: tmpdir(),
    env: { ...process.env, HARNESS_HOME: home },
  });
  assert(raw.includes("ListAgents"), "libs did not resolve from a foreign cwd");
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
