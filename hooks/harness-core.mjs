#!/usr/bin/env node
/**
 * harness-core — UserPromptSubmit hook.
 *
 * Injects the compact delegation core into every turn while the harness is
 * enabled, with two live values substituted: the measured boot tax for this
 * project, and the reuse candidates the ledger knows about. The full doctrine
 * lives in the `harness` skill and loads on demand — this is a pointer, not a
 * policy, because it costs tokens on EVERY message.
 *
 * Text resolution mirrors comms-style.mjs:
 *   1. ~/.claude/harness-core.md   — the user's tuned copy (wins)
 *   2. <plugin>/templates/harness-core.md
 *   3. a built-in fallback
 *
 * Silent when the harness is disabled or unconfigured. Any failure exits 0
 * without output — a broken hook must never cost the user a turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeConfig, paths } from "./lib/harness-config.mjs";
import { loadLedger, prune, reuseCandidates } from "./lib/harness-ledger.mjs";
import { bootTax, fmt } from "./lib/harness-estimate.mjs";

const PLUGIN_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "harness-core.md");

const FALLBACK = `[harness] ON — workers can't see this conversation; everything they need rides in the work order.
Inline by default; delegate only when the task is bigger than its boot tax and decoupled from the chat.
Reuse an existing worker (SendMessage) before booting a new one. Always set \`model\` explicitly.
Background workers by default and keep talking; foreground anything that needs permissions.
Before a fan-out, multiply: N × (boot + typical run). Every order needs a done-when and a return shape.
Load the \`harness\` skill for the full doctrine.`;

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
  process.exit(0);
}

/** Pull the fenced block out of the template; fall back to the whole file if unfenced. */
function extractCore(src) {
  const fenced = src.match(/```[^\n]*\n([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : src.replace(/<!--[\s\S]*?-->/g, "")).trim();
  return body || null;
}

function loadTemplate() {
  for (const p of [paths().coreOverride, PLUGIN_TEMPLATE]) {
    try {
      const core = extractCore(readFileSync(p, "utf8"));
      if (core) return core;
    } catch {
      /* try the next source */
    }
  }
  return FALLBACK;
}

try {
  const cfg = activeConfig("inject");
  if (!cfg) process.exit(0); // disabled or unconfigured — say nothing

  let data = {};
  try {
    data = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    /* proceed with defaults — a malformed payload shouldn't drop the core */
  }
  const cwd = data.cwd || process.cwd();

  let boot = "40k";
  try {
    boot = fmt(bootTax(cwd, cfg));
  } catch {
    /* keep the placeholder default */
  }

  let fleet = "no workers on the ledger";
  try {
    const now = Date.now();
    const ledger = prune(loadLedger(), cfg, now);
    const candidates = reuseCandidates(ledger, { session: data.session_id, now, cfg });
    if (candidates.length) {
      fleet =
        "the ledger thinks these are resumable — " +
        candidates
          .slice(0, 3)
          .map((c) => {
            const mins = Math.round((now - (c.settledTs ?? c.ts ?? now)) / 60000);
            return `${c.label || c.desc || c.id} (${c.model}, idle ${mins}m)`;
          })
          .join(", ");
    }
  } catch {
    /* fleet stays at the empty default */
  }

  emit(loadTemplate().replace(/\{BOOT\}/g, boot).replace(/\{FLEET\}/g, fleet));
} catch {
  /* never cost the user a turn */
}
process.exit(0);
