#!/usr/bin/env node
/**
 * Sandbox tests for the harness hooks. Zero deps, no framework.
 *
 *   node tests/harness/run.mjs
 *
 * Every hook honours HARNESS_HOME, so each case runs against a throwaway state
 * directory and never touches the real ~/.claude.
 *
 * The invariant that matters most is checked against EVERY hook with malformed
 * input: stdout is empty or exactly one valid JSON object, and the exit code is
 * 0. That is the repo's fail-open contract, mechanised — a hook that throws or
 * emits garbage costs the user a turn.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks");
const hook = (n) => join(HOOKS, n);
const ALL_HOOKS = ["harness-core.mjs", "harness-dispatch.mjs", "harness-workflow.mjs", "harness-settle.mjs", "harness-stop.mjs"];

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
function run(hookName, payload, home, extraEnv = {}) {
  let raw = "";
  let code = 0;
  try {
    raw = execFileSync("node", [hook(hookName)], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, HARNESS_HOME: home, ...extraEnv },
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
function sandbox(config = { enabled: true }, { tally, ledger, mode } = {}) {
  const home = mkdtempSync(join(tmpdir(), "harness-test-"));
  if (config !== null) writeFileSync(join(home, "harness.json"), JSON.stringify(config));
  if (tally || ledger || mode) mkdirSync(join(home, "harness"), { recursive: true });
  if (tally) writeFileSync(join(home, "harness", "tally.md"), tally);
  if (ledger) writeFileSync(join(home, "harness", "fleet.json"), JSON.stringify(ledger));
  if (mode) writeFileSync(join(home, "harness", "mode"), mode);
  return home;
}

function transcript(home, model) {
  const p = join(home, "transcript.jsonl");
  writeFileSync(p, [JSON.stringify({ type: "assistant", message: { model } }), ""].join("\n"));
  return p;
}

const ctx = (r) => r.out?.hookSpecificOutput?.additionalContext ?? "";
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const taskEvent = (over = {}) => ({
  tool_name: "Task",
  session_id: "s1",
  cwd: process.cwd(),
  tool_input: { description: "do a thing", model: "sonnet", subagent_type: "general-purpose", ...(over.tool_input || {}) },
  ...over,
});

const cleanup = [];
const track = (h) => (cleanup.push(h), h);

// ---------------------------------------------------------------- silence ---

check("no config → every hook silent, creates nothing", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox(null));
    const r = run(h, taskEvent(), home);
    assert(r.raw.trim() === "", `${h} emitted output`);
    assert(r.code === 0, `${h} exited ${r.code}`);
    assert(!existsSync(join(home, "harness")), `${h} created state`);
  }
});

check("enabled:false → every hook silent", () => {
  for (const h of ALL_HOOKS) {
    const home = track(sandbox({ enabled: false }));
    const r = run(h, taskEvent(), home);
    assert(r.raw.trim() === "", `${h} emitted output`);
    assert(!existsSync(join(home, "harness")), `${h} created state`);
  }
});

check("corrupt config → silent, not assumed-on", () => {
  for (const h of ALL_HOOKS) {
    const home = mkdtempSync(join(tmpdir(), "harness-test-"));
    track(home);
    writeFileSync(join(home, "harness.json"), "{not json");
    const r = run(h, taskEvent(), home);
    assert(r.raw.trim() === "", `${h} emitted output on corrupt config`);
    assert(r.code === 0, `${h} exited ${r.code}`);
  }
});

check("shadow mode: tallyWhenDisabled measures but never injects", () => {
  const home = track(sandbox({ enabled: false, tallyWhenDisabled: true }));
  const settle = run("harness-settle.mjs", { ...taskEvent(), tool_response: { usage: { output_tokens: 1234 } } }, home);
  assert(settle.raw.trim() === "", "settle emitted output");
  assert(existsSync(join(home, "harness", "tally.md")), "shadow mode did not write a tally");
  const core = run("harness-core.mjs", { cwd: process.cwd() }, home);
  assert(core.raw.trim() === "", "core injected while disabled");
});

// ------------------------------------------------------- malformed payloads --

check("malformed payloads → empty or one JSON object, exit 0 (all hooks)", () => {
  const bad = ["", "not json", "{", "null", "[]", '{"tool_name":null}', '{"tool_input":"string"}', '{"tool_name":"Task","tool_input":null}'];
  for (const h of ALL_HOOKS) {
    const home = track(sandbox({ enabled: true }));
    for (const payload of bad) {
      const r = run(h, payload, home); // run() already throws on non-JSON stdout
      assert(r.code === 0, `${h} exited ${r.code} on payload ${JSON.stringify(payload)}`);
    }
  }
});

// --------------------------------------------------------------- core hook --

check("core injects, substitutes BOOT and FLEET", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home);
  const c = ctx(r);
  assert(c.includes("[harness]"), "no core text");
  assert(!c.includes("{BOOT}") && !c.includes("{FLEET}"), "placeholders left unsubstituted");
  assert(/no workers on the ledger/.test(c), "empty-fleet wording missing");
  assert(r.out.suppressOutput === true, "core should suppress its own output");
});

check("core surfaces idle workers as reuse candidates", () => {
  const now = Date.now();
  const home = track(
    sandbox({ enabled: true }, { ledger: { live: [{ id: "a1", ts: now - 60000, settledTs: now - 60000, session: "s1", model: "sonnet", agentType: "general-purpose", state: "idle", desc: "audit routes", label: "audit routes" }] } }),
  );
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
  assert(c.includes("audit routes"), `reuse candidate not surfaced: ${c}`);
  assert(c.includes("ledger thinks"), "ledger should be described as a guess");
});

check("mode: default posture is the standard core", () => {
  const home = track(sandbox({ enabled: true }));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
  assert(/\[harness\] ON/.test(c), `expected the standard core: ${c.slice(0, 80)}`);
  assert(!/ORCHESTRATOR MODE/.test(c), "orchestrator posture leaked into the default");
});

check("mode: agents swaps in the orchestrator posture", () => {
  const home = track(sandbox({ enabled: true }, { mode: "agents" }));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
  assert(/ORCHESTRATOR MODE/.test(c), `expected orchestrator posture: ${c.slice(0, 120)}`);
  assert(/END YOUR TURN after dispatching/.test(c), "missing the end-the-turn instruction");
  assert(!c.includes("{BOOT}") && !c.includes("{FLEET}"), "placeholders unsubstituted in agents mode");
});

check("mode: unknown or junk mode falls back to standard", () => {
  for (const m of ["nonsense", "", "../../etc/passwd", "x".repeat(200)]) {
    const home = track(sandbox({ enabled: true }, { mode: m }));
    const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
    assert(/\[harness\] ON/.test(c), `mode ${JSON.stringify(m.slice(0, 20))} did not fall back: ${c.slice(0, 80)}`);
  }
});

check("mode: a user override template without sections still works", () => {
  const home = track(sandbox({ enabled: true }, { mode: "agents" }));
  writeFileSync(join(home, "harness-core.md"), ["```", "my own core, boot {BOOT}", "```", ""].join("\n"));
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
  assert(/my own core/.test(c), `unsectioned override ignored: ${c}`);
  assert(!c.includes("{BOOT}"), "placeholder not substituted in override");
});

// ------------------------------------------------- missing-model escalation --

check("explicit model → context note, no permission decision", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-dispatch.mjs", taskEvent(), home);
  assert(ctx(r).includes("[harness]"), "no context");
  assert(decision(r) === undefined, `unexpected decision: ${decision(r)}`);
});

check("no model + cheap session → no inherit note", () => {
  const home = track(sandbox({ enabled: true }));
  const t = transcript(home, "claude-sonnet-5");
  const r = run("harness-dispatch.mjs", { ...taskEvent({ tool_input: { model: undefined } }), transcript_path: t }, home);
  assert(!/inherits the session model/.test(ctx(r)), "warned about inheriting on a cheap session");
  assert(decision(r) === undefined, "should not ask");
});

check("no model + expensive session, small burst → note but no ask", () => {
  const home = track(sandbox({ enabled: true }));
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-dispatch.mjs", { ...taskEvent({ tool_input: { model: undefined } }), transcript_path: t }, home);
  assert(/inherits the session model/.test(ctx(r)), `expected inherit note: ${ctx(r)}`);
  assert(decision(r) === undefined, "should not ask under threshold");
});

check("never denies", () => {
  const home = track(sandbox({ enabled: true, askThresholdTokens: 1 }));
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-dispatch.mjs", { ...taskEvent({ tool_input: { model: undefined } }), transcript_path: t }, home);
  assert(decision(r) !== "deny", "hook denied a dispatch");
});

check("never emits allow (would override user permission settings)", () => {
  const home = track(sandbox({ enabled: true }));
  for (const h of ["harness-dispatch.mjs", "harness-workflow.mjs"]) {
    const r = run(h, h.includes("workflow") ? { tool_name: "Workflow", cwd: process.cwd(), tool_input: { script: "await agent('x', {model:'sonnet'})" } } : taskEvent(), home);
    assert(decision(r) !== "allow", `${h} emitted allow`);
  }
});

check("unreadable transcript → costed, no crash, no ask under threshold", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-dispatch.mjs", { ...taskEvent({ tool_input: { model: undefined } }), transcript_path: join(home, "nope.jsonl") }, home);
  assert(r.code === 0, "crashed on missing transcript");
  assert(ctx(r).includes("[harness]"), "no context emitted");
});

// ---------------------------------------------------------------- burst -----

check("burst: threshold fires once, then the window suppresses", () => {
  const home = track(sandbox({ enabled: true, askThresholdTokens: 250000, burstWindowSeconds: 300, baseBootTokens: 10000, defaultEstimates: { cheap: 200000 } }));
  const asks = [];
  for (let i = 0; i < 5; i++) {
    const r = run("harness-dispatch.mjs", taskEvent({ tool_input: { description: `w${i}` } }), home);
    if (decision(r) === "ask") asks.push(i);
  }
  assert(asks.length === 1, `expected exactly 1 ask across the burst, got ${asks.length} (at ${asks})`);
});

check("burst: ask reason shows the arithmetic, not just a total", () => {
  const home = track(sandbox({ enabled: true, askThresholdTokens: 1000 }));
  const r = run("harness-dispatch.mjs", taskEvent(), home);
  const reason = r.out?.hookSpecificOutput?.permissionDecisionReason ?? "";
  assert(decision(r) === "ask", "expected an ask");
  assert(/boot/.test(reason) && /typical/.test(reason), `reason lacks a breakdown: ${reason}`);
});

check("burst: sessions don't cross-contaminate", () => {
  const now = Date.now();
  const other = Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, ts: now, session: "OTHER", model: "sonnet", agentType: "general-purpose", state: "live", desc: "x" }));
  const home = track(sandbox({ enabled: true, askThresholdTokens: 400000 }, { ledger: { live: other } }));
  const r = run("harness-dispatch.mjs", taskEvent(), home);
  assert(decision(r) === undefined, "another session's fleet triggered an ask");
});

check("ledger: 400 stale entries pruned, hook still fast", () => {
  const old = Date.now() - 5 * 60 * 60 * 1000;
  const stale = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, ts: old, session: "s1", model: "sonnet", agentType: "general-purpose", state: "live", desc: "old" }));
  const home = track(sandbox({ enabled: true }, { ledger: { live: stale } }));
  const started = Date.now();
  const r = run("harness-dispatch.mjs", taskEvent(), home);
  assert(Date.now() - started < 10000, "hook took over 10s");
  const after = JSON.parse(readFileSync(join(home, "harness", "fleet.json"), "utf8"));
  assert(after.live.length < 10, `stale entries not pruned: ${after.live.length}`);
});

// -------------------------------------------------------------- workflow ----

const wf = (script, over = {}) => ({ tool_name: "Workflow", cwd: process.cwd(), tool_input: { script }, ...over });

check("workflow: model inside a prompt string doesn't count as set", () => {
  const home = track(sandbox({ enabled: true }));
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf("await agent('please use model: sonnet for this')", { transcript_path: t }), home);
  assert(/set no `model`/.test(ctx(r)), `string should not satisfy the check: ${ctx(r)}`);
});

check("workflow: quoted object key counts as set", () => {
  const home = track(sandbox({ enabled: true }));
  const t = transcript(home, "claude-opus-5");
  const r = run("harness-workflow.mjs", wf(`await agent('x', { "model": "sonnet" })`, { transcript_path: t }), home);
  assert(!/set no `model`/.test(ctx(r)), `quoted key should count: ${ctx(r)}`);
});

check("workflow: spread and helper opts are unresolved, never denied", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-workflow.mjs", wf("await agent('a', {...o}); await agent('b', mk())"), home);
  assert(/can't read/.test(ctx(r)), `expected an unreadable note: ${ctx(r)}`);
  assert(decision(r) !== "deny", "denied unreadable opts");
});

check("workflow: estimate is labelled a floor", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-workflow.mjs", wf("await agent('x', {model:'sonnet'})"), home);
  assert(/FLOOR/.test(ctx(r)), `floor label missing: ${ctx(r)}`);
});

check("workflow: big fan-out asks", () => {
  const home = track(sandbox({ enabled: true, askThresholdTokens: 400000 }));
  const script = Array.from({ length: 12 }, (_, i) => `await agent('t${i}', {model:'opus'})`).join("\n");
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(decision(r) === "ask", `expected ask for a 12-worker opus fan-out, got ${decision(r)}`);
});

check("workflow: 15k sites completes and emits (the O(n·m) regression)", () => {
  const home = track(sandbox({ enabled: true, askThresholdTokens: 999999999 }));
  const script = Array.from({ length: 15000 }, (_, i) => `await agent('t${i}', {model:'sonnet'})`).join("\n");
  const started = Date.now();
  const r = run("harness-workflow.mjs", wf(script), home);
  assert(r.raw.trim() !== "", "no stdout on a large script — this is the fail-closed mode");
  assert(Date.now() - started < 20000, "took over 20s");
});

check("workflow: named workflow with no script is not policed", () => {
  const home = track(sandbox({ enabled: true }));
  const r = run("harness-workflow.mjs", { tool_name: "Workflow", cwd: process.cwd(), tool_input: { name: "saved-thing" } }, home);
  assert(r.raw.trim() === "", "policed a saved workflow it can't see");
});

// ------------------------------------------------------------- accounting ---

check("tokens extracted from three response shapes, never '?'", () => {
  const shapes = [
    [{ usage: { output_tokens: 5150 } }, 5150],
    [{ totalTokens: 9000 }, 9000],
    ["x".repeat(4000), 1000],
  ];
  for (const [resp, want] of shapes) {
    const home = track(sandbox({ enabled: true }));
    run("harness-settle.mjs", { ...taskEvent(), tool_response: resp }, home);
    const tally = readFileSync(join(home, "harness", "tally.md"), "utf8");
    assert(tally.includes(`${want} tok`), `expected ${want} tok in tally, got: ${tally.split("\n").filter((l) => !l.startsWith("#")).join("|")}`);
  }
});

check("tally row uses local date, not UTC", () => {
  const home = track(sandbox({ enabled: true }));
  run("harness-settle.mjs", { ...taskEvent(), tool_response: { usage: { output_tokens: 10 } } }, home);
  const row = readFileSync(join(home, "harness", "tally.md"), "utf8").split("\n").find((l) => l && !l.startsWith("#"));
  assert(row.startsWith(new Date().toLocaleDateString("en-CA")), `row not stamped with local date: ${row}`);
});

check("learning: '? tok' rows excluded; enough known rows switch provenance", () => {
  const today = new Date().toLocaleDateString("en-CA");
  const unknownOnly = ["# h", ...Array.from({ length: 9 }, () => `${today} · p · sonnet · general-purpose · ? tok · x`)].join("\n") + "\n";
  let home = track(sandbox({ enabled: true }, { tally: unknownOnly }));
  let c = ctx(run("harness-dispatch.mjs", taskEvent(), home));
  assert(/\[default\]/.test(c), `unmeasured rows should not train the estimator: ${c}`);

  const known = ["# h", ...Array.from({ length: 9 }, () => `${today} · p · sonnet · general-purpose · 123456 tok · x`)].join("\n") + "\n";
  home = track(sandbox({ enabled: true }, { tally: known }));
  c = ctx(run("harness-dispatch.mjs", taskEvent(), home));
  assert(/learned \(n=9\)/.test(c), `expected learned estimate: ${c}`);
});

check("settle: background → live, foreground → idle reuse candidate", () => {
  for (const [bg, want] of [[true, "live"], [false, "idle"]]) {
    const home = track(sandbox({ enabled: true }));
    run("harness-dispatch.mjs", taskEvent({ tool_input: { run_in_background: bg } }), home);
    run("harness-settle.mjs", { ...taskEvent({ tool_input: { run_in_background: bg } }), tool_response: { usage: { output_tokens: 50 } } }, home);
    const led = JSON.parse(readFileSync(join(home, "harness", "fleet.json"), "utf8"));
    assert(led.live[0]?.state === want, `bg=${bg} expected ${want}, got ${led.live[0]?.state}`);
  }
});

check("stop: marks idle, never deletes (finished workers stay resumable)", () => {
  const now = Date.now();
  const home = track(
    sandbox({ enabled: true }, { ledger: { live: [{ id: "a1", ts: now, session: "s1", model: "sonnet", agentType: "general-purpose", state: "live", desc: "w", label: "w" }] } }),
  );
  run("harness-stop.mjs", { session_id: "s1" }, home);
  const led = JSON.parse(readFileSync(join(home, "harness", "fleet.json"), "utf8"));
  assert(led.live.length === 1, "stop deleted the entry instead of idling it");
  assert(led.live[0].state === "idle", `expected idle, got ${led.live[0].state}`);
});

check("idle entries age out past reuseWindowMinutes", () => {
  const old = Date.now() - 60 * 60 * 1000;
  const home = track(
    sandbox({ enabled: true, reuseWindowMinutes: 45 }, { ledger: { live: [{ id: "a1", ts: old, settledTs: old, session: "s1", model: "sonnet", state: "idle", desc: "old" }] } }),
  );
  const c = ctx(run("harness-core.mjs", { cwd: process.cwd(), session_id: "s1" }, home));
  assert(/no workers on the ledger/.test(c), `stale idle worker still offered: ${c}`);
});

check("SendMessage: known name logs reuse, unknown name writes nothing", () => {
  const now = Date.now();
  const home = track(
    sandbox({ enabled: true }, { ledger: { live: [{ id: "a1", ts: now, session: "s1", model: "sonnet", agentType: "general-purpose", state: "idle", settledTs: now, label: "api-audit", desc: "api-audit" }] } }),
  );
  run("harness-settle.mjs", { tool_name: "SendMessage", session_id: "s1", cwd: process.cwd(), tool_input: { to: "api-audit" }, tool_response: { usage: { output_tokens: 77 } } }, home);
  let tally = existsSync(join(home, "harness", "tally.md")) ? readFileSync(join(home, "harness", "tally.md"), "utf8") : "";
  assert(/reuse/.test(tally), `no reuse row: ${tally}`);

  const home2 = track(sandbox({ enabled: true }));
  run("harness-settle.mjs", { tool_name: "SendMessage", session_id: "s1", cwd: process.cwd(), tool_input: { to: "stranger" }, tool_response: "x" }, home2);
  const t2 = existsSync(join(home2, "harness", "tally.md")) ? readFileSync(join(home2, "harness", "tally.md"), "utf8") : "";
  assert(!/reuse/.test(t2), "logged reuse for a worker we never dispatched");
});

// ---------------------------------------------------------- cross-platform --

check("state dir with spaces and non-ASCII resolves", () => {
  const base = mkdtempSync(join(tmpdir(), "harness-test-"));
  track(base);
  const home = join(base, "my çlaude dir");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "harness.json"), JSON.stringify({ enabled: true }));
  const r = run("harness-dispatch.mjs", taskEvent(), home);
  assert(ctx(r).includes("[harness]"), "hook failed under an awkward path");
  assert(existsSync(join(home, "harness", "fleet.json")), "ledger not written under an awkward path");
});

check("hooks run from an unrelated cwd (relative lib imports resolve)", () => {
  const home = track(sandbox({ enabled: true }));
  const raw = execFileSync("node", [hook("harness-dispatch.mjs")], {
    input: JSON.stringify(taskEvent()),
    encoding: "utf8",
    cwd: tmpdir(),
    env: { ...process.env, HARNESS_HOME: home },
  });
  assert(raw.includes("[harness]"), "libs did not resolve from a foreign cwd");
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
