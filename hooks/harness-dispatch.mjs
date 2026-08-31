#!/usr/bin/env node
/**
 * harness-dispatch — PreToolUse hook on Task|Agent.
 *
 * Enforces the per-tier fan-out caps on individual dispatches. Each worker's
 * tier is resolved (its explicit `model`, or the session model it would inherit
 * when none is set) and added to a rolling burst counter. If that tier is now
 * over its cap for the window, the dispatch becomes a permission prompt — the
 * user decides, with the count in front of them. It never blocks on its own and
 * never emits "allow".
 *
 * The point: the user picks the models autonomously via the orchestrator; this
 * is the backstop that makes an accidental burst — 16 opus workers, or an
 * unannotated fan-out silently inheriting fable — impossible to launch unseen.
 * A single worker, or a fan-out under the caps, is silent.
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { activeConfig, tierOf } from "./lib/harness-config.mjs";
import { addAndCheck } from "./lib/harness-counter.mjs";

function emit(context, ask) {
  const out = { hookSpecificOutput: { hookEventName: "PreToolUse" } };
  if (context) out.hookSpecificOutput.additionalContext = context;
  if (ask) {
    out.hookSpecificOutput.permissionDecision = "ask";
    out.hookSpecificOutput.permissionDecisionReason = ask;
  }
  process.stdout.write(JSON.stringify(out));
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

  const input = evt.tool_input ?? {};
  const declared = input.model;

  // Resolve which tier this worker actually runs on.
  let key = capKey(declared, cfg);
  let inheritedNote = "";
  if (!declared || tierOf(declared, cfg) === "inherit") {
    const inherited = sessionModel(evt.transcript_path);
    key = capKey(inherited, cfg);
    if (key && cfg.expensiveModels.includes(key)) {
      inheritedNote = ` (no \`model\` set — inheriting the session's ${inherited}; set it explicitly)`;
    }
  }
  if (!key) process.exit(0); // can't attribute a tier — don't guess

  const now = Date.now();
  const { totals, exceeded } = addAndCheck({ [key]: 1 }, cfg, now);
  const hit = exceeded.find((e) => e.tier === key);

  if (hit) {
    emit(
      undefined,
      `harness: this is the ${hit.count}th ${hit.tier} worker in the last ${cfg.capWindowSeconds}s (cap ${hit.cap})${inheritedNote}. ` +
        `Approve to keep going, or deny and re-route the extra work to a cheaper tier / run it in sequence. This is the guardrail against an accidental fan-out.`,
    );
  }

  // Under cap but inheriting expensive: a quiet nudge, never a prompt.
  if (inheritedNote) emit(`[harness] This dispatch has no \`model\` and will inherit the session model. Set it deliberately — cheap tier for execution from a spec.`);
} catch {
  /* never wedge a dispatch on our own bug */
}
process.exit(0);
