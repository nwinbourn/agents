#!/usr/bin/env node
/**
 * harness-dispatch — PreToolUse hook on Task|Agent.
 *
 * The single-dispatch companion to harness-workflow's fleet check. Deliberately
 * tiny: one ask, one note, silence otherwise — a prompt that fires often stops
 * being read.
 *
 *   ASK  — a worker dispatched on `fable`. That's the main loop's model and the
 *          verifier of last resort; as a worker model it's the purest form of
 *          "expensive agent used unnecessarily", so the USER decides, with the
 *          reason in front of them. (Deny → the work re-routes down a tier.)
 *
 *   NOTE — no `model` set while the session runs an expensive model: the worker
 *          silently inherits it. Legitimate often enough that interrupting every
 *          time would be nagging, so it's context, not a prompt.
 *
 * A deliberate opus worker is silent — routing judgment-heavy work to opus is
 * exactly what the doctrine says to do. Never denies; never emits "allow".
 *
 * Fail-open: any error exits 0 with no output.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { activeConfig, tierOf } from "./lib/harness-config.mjs";

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

try {
  const cfg = activeConfig();
  if (!cfg) process.exit(0);

  const evt = JSON.parse(readFileSync(0, "utf8"));
  if (!/^(Task|Agent)$/.test(String(evt.tool_name ?? ""))) process.exit(0);

  const input = evt.tool_input ?? {};
  const declared = input.model;

  if (declared && String(declared).toLowerCase().includes("fable")) {
    emit(
      undefined,
      `harness: this dispatches a worker on fable — the main loop's model and the verifier of last resort, not a worker model. ` +
        `Deny it and the task re-routes (opus if the judgment genuinely needs it, sonnet if it's execution). ` +
        `Approve only if fable is deliberate — a last-resort verification of critical work.`,
    );
  }

  if (!declared || tierOf(declared, cfg) === "inherit") {
    const inherited = sessionModel(evt.transcript_path);
    if (inherited && tierOf(inherited, cfg) === "expensive") {
      emit(
        `[harness] This dispatch names no \`model\`, so it inherits the session's ${inherited}. If this is execution from a clear spec, set \`model: "sonnet"\`.`,
      );
    }
  }
} catch {
  /* never wedge a dispatch on our own bug */
}
process.exit(0);
