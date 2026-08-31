#!/usr/bin/env node
/**
 * harness-core — UserPromptSubmit hook.
 *
 * While the harness is on, injects its standing orders every turn: reuse an
 * existing worker before booting a new one, route each task to a model by
 * difficulty (never asking the user), and run delegated work in the background.
 * In `agents` mode it injects the orchestration posture instead — dispatch,
 * end the turn, keep the conversation moving.
 *
 * It is deliberately small: this costs tokens on EVERY message, including the
 * many where nothing is delegated. The full doctrine lives in the skill and
 * loads on demand.
 *
 * Text resolution mirrors comms-style.mjs:
 *   1. ~/.claude/harness-core.md   — the user's tuned copy (wins)
 *   2. <plugin>/templates/harness-core.md
 *   3. a built-in fallback
 *
 * Silent when the harness is off. Any failure exits 0 without output — a
 * broken hook must never cost the user a turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeConfig, paths } from "./lib/harness-config.mjs";

const PLUGIN_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "harness-core.md");

const FALLBACK = `[harness] ON — reuse before booting: ListAgents shows existing workers; SendMessage continues one with its context intact. Route models yourself — cheap for mechanical work, sonnet for normal work (fan-outs default to sonnet), top tier only for genuinely hard work; never ask the user to pick a model. Run delegated work in the background and fold results in as they land.`;

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
 * `## <name>` section per mode ("on", "agents"); a template with no sections
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
  if (sections.on) return sections.on;

  const fenced = src.match(/```[^\n]*\n([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : src.replace(/<!--[\s\S]*?-->/g, "")).trim();
  return body || null;
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
  const cfg = activeConfig();
  if (!cfg) process.exit(0); // off — say nothing, cost nothing
  emit(loadTemplate(cfg.mode));
} catch {
  /* never cost the user a turn */
}
process.exit(0);
