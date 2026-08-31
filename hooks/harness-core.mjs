#!/usr/bin/env node
/**
 * harness-core — UserPromptSubmit hook.
 *
 * Injects a short routing reminder every turn: reuse an existing worker before
 * booting a new one, and set `model` deliberately. In `agents` mode it injects
 * the orchestrator posture instead — background dispatch, end the turn, keep
 * talking to the user.
 *
 * It is deliberately small. This costs tokens on EVERY message including the
 * many where nothing is delegated, so it carries only the two rules that
 * actually save tokens; the rest lives in the skill and loads on demand.
 *
 * Text resolution mirrors comms-style.mjs:
 *   1. ~/.claude/harness-core.md   — the user's tuned copy (wins)
 *   2. <plugin>/templates/harness-core.md
 *   3. a built-in fallback
 *
 * Silent when disabled or unconfigured. Any failure exits 0 without output — a
 * broken hook must never cost the user a turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeConfig, paths } from "./lib/harness-config.mjs";

const PLUGIN_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "harness-core.md");

const FALLBACK = `[harness] Reuse before booting: ListAgents shows existing workers, SendMessage continues one with its context intact and skips the boot cost. Always set \`model\` — omitting it inherits the session model. Top tier for refactors, architecture and security; cheap tier for execution from a spec; Explore for read-only search.`;

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
  process.exit(0);
}

/**
 * Pull the fenced block for `mode` out of the template. The template holds one
 * `## <name>` section per posture. An older single-block template (no sections)
 * still works — its first fence is used.
 */
function extractCore(src, mode) {
  const sections = {};
  for (const part of src.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const fenced = part.slice(nl + 1).match(/```[^\n]*\n([\s\S]*?)```/);
    if (fenced) sections[part.slice(0, nl).trim()] = fenced[1].trim();
  }
  if (sections[mode]) return sections[mode];
  if (sections.standard) return sections.standard;

  const fenced = src.match(/```[^\n]*\n([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : src.replace(/<!--[\s\S]*?-->/g, "")).trim();
  return body || null;
}

/** The active posture, set by `/harness agents`. Absent or junk → "standard". */
function activeMode() {
  try {
    const m = readFileSync(paths().mode, "utf8").trim().toLowerCase();
    return /^[a-z-]{1,32}$/.test(m) ? m : "standard";
  } catch {
    return "standard";
  }
}

function loadTemplate(mode) {
  for (const p of [paths().coreOverride, PLUGIN_TEMPLATE]) {
    try {
      const core = extractCore(readFileSync(p, "utf8"), mode);
      if (core) return core;
    } catch {
      /* try the next source */
    }
  }
  return FALLBACK;
}

try {
  if (!activeConfig()) process.exit(0); // disabled or unconfigured — say nothing
  emit(loadTemplate(activeMode()));
} catch {
  /* never cost the user a turn */
}
process.exit(0);
