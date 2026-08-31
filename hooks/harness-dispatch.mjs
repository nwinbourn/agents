#!/usr/bin/env node
/**
 * harness-dispatch — PreToolUse hook on Task|Agent.
 *
 * The harness's one interruption, applied to individual dispatches. Each
 * worker's tier is resolved (its explicit `model`, or the session model it
 * inherits when none is set) and added to a rolling burst counter; a dispatch
 * that takes a tier PAST its cap becomes a permission prompt with the count in
 * front of the user. Under the caps it is completely silent — routing is the
 * orchestrator's job and the harness has nothing to say about it. It never
 * denies and never allows on its own.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { activeConfig } from "./lib/harness-config.mjs";
import { addAndCheck } from "./lib/harness-counter.mjs";

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** The session's own model, read from the tail of its transcript. Null if unreadable. */
function sessionModel(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const size = statSync(transcriptPath).size;
    const want = Math.min(size, 65536);
    const buf = Buffer.alloc(want);
    const fd = openSync(transcriptPath, "r");
    try {
      readSync(fd, buf, 0, want, size - want);
    } finally {
      closeSync(fd);
    }
    let last = null;
    for (const m of buf.toString("utf8").matchAll(/"model"\s*:\s*"([^"]+)"/g)) last = m[1];
    return last ? last.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Reduce a model name to a cap key ("fable"/"opus"/"sonnet"/…), or null if unknowable. */
function capKey(model, cfg) {
  const m = String(model ?? "").toLowerCase();
  for (const name of [...cfg.expensiveModels, ...cfg.cheapModels]) {
    if (m.includes(name)) return name;
  }
  return null;
}

try {
  const cfg = activeConfig();
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  if (!/^(Task|Agent)$/.test(String(evt.tool_name ?? ""))) process.exit(0);

  const declared = (evt.tool_input ?? {}).model;
  // No model (or "inherit") means the worker runs as the session model — count
  // it as what it will actually be. A real-but-unrecognized model is never
  // attributed to a tier; don't guess.
  const inherits = !declared || String(declared).toLowerCase() === "inherit";
  const key = inherits ? capKey(sessionModel(evt.transcript_path), cfg) : capKey(declared, cfg);
  if (!key) process.exit(0);

  const { exceeded } = addAndCheck({ [key]: 1 }, cfg, Date.now());
  const hit = exceeded.find((e) => e.tier === key);
  if (hit) {
    ask(
      `harness: that's ${hit.count} ${hit.tier} workers inside ${cfg.capWindowSeconds}s (cap ${hit.cap} in parallel). ` +
        `Approve to launch it anyway, or deny and the extra work gets re-routed to a cheaper tier or run in sequence.`,
    );
  }
} catch {
  /* never wedge a dispatch on our own bug */
}
process.exit(0);
