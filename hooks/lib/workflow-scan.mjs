// workflow-scan — static analysis of Workflow scripts: find every agent() call
// site and read its `model:` option, without being fooled by strings or comments.
//
// Lifted verbatim from a hardened predecessor (workflow-model-guard). The logic
// survived two adversarial reviews; change NOTHING here without re-running the
// scanner regression tests (model-in-a-prompt-string, quoted object keys, spread
// opts, 15k-site performance).
//
// THE ASYMMETRY THAT GOVERNS EVERY VERDICT. A false negative costs tokens. A
// false POSITIVE wedges valid tooling, which is worse. So "missing" is returned
// only when provable (a literal opts object with no model key, or no opts at
// all); anything unreadable — opts by reference, spread, helper-built — is
// "unknown", and the caller must treat unknown as allowed-with-a-note.
//
// Pure functions, no I/O. The hook decides; this file only reads.

/**
 * One pass over the source, tracking string / template / comment state.
 *
 * Returns both the `agent(` call offsets and a MASK of the same length in which
 * every character inside a string, template (interpolation included) or comment
 * is a space. Everything downstream reads the mask, never the raw text — that
 * is what stops the word `model:` inside a prompt from satisfying the check.
 */
export function scan(src) {
  const sites = [];
  const mask = new Array(src.length);
  let i = 0;
  const stack = [];
  const top = () => stack[stack.length - 1];

  // Where each open quote started, so a closed string can be reconsidered.
  const quoteStart = [];
  const openQuote = (c, at) => { stack.push(c); quoteStart.push(at); };

  /**
   * A QUOTED OBJECT KEY IS CODE, NOT PROSE. `{ "model": "sonnet" }` is a
   * perfectly ordinary way to write the option; masking the key wholesale would
   * misread it as missing. When a string closes, if its content is a bare
   * identifier AND the next non-space is a colon, it was a key: put it back.
   * The identifier test keeps this narrow — a prompt like `'model: sonnet'`
   * before a ternary colon is not identifier-shaped and stays masked.
   */
  const unmaskIfKey = (start, end) => {
    const content = src.slice(start + 1, end);
    if (!/^[A-Za-z_$][\w$]*$/.test(content)) return;
    let j = end + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== ":") return;
    for (let k = start; k <= end; k++) mask[k] = src[k];
  };

  // Inside any state at all — including a `${}` interpolation — is masked.
  const put = (from, to) => {
    for (let k = from; k < to; k++) mask[k] = src[k] === "\n" ? "\n" : " ";
  };
  const keep = (from, to) => {
    for (let k = from; k < to; k++) mask[k] = src[k];
  };

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const state = top();

    if (state) {
      // Masked region: still need to find where it ends.
      if (state === "'" || state === '"') {
        if (c === "\\") { put(i, i + 2); i += 2; continue; }
        put(i, i + 1);
        if (c === state) {
          stack.pop();
          unmaskIfKey(quoteStart.pop(), i);
        }
        i++;
        continue;
      }
      if (state === "`") {
        if (c === "\\") { put(i, i + 2); i += 2; continue; }
        if (c === "$" && n === "{") { put(i, i + 2); stack.push("${"); i += 2; continue; }
        put(i, i + 1);
        if (c === "`") { stack.pop(); quoteStart.pop(); }
        i++;
        continue;
      }
      if (state === "${") {
        // Nested code, but masked wholesale so a comma in here can never look
        // like an argument separator.
        if (c === "'" || c === '"' || c === "`") { put(i, i + 1); openQuote(c, i); i++; continue; }
        if (c === "{") { put(i, i + 1); stack.push("{"); i++; continue; }
        put(i, i + 1);
        if (c === "}") stack.pop();
        i++;
        continue;
      }
      if (state === "{") {
        if (c === "'" || c === '"' || c === "`") { put(i, i + 1); openQuote(c, i); i++; continue; }
        if (c === "{") { put(i, i + 1); stack.push("{"); i++; continue; }
        put(i, i + 1);
        if (c === "}") stack.pop();
        i++;
        continue;
      }
      if (state === "//") {
        put(i, i + 1);
        if (c === "\n") stack.pop();
        i++;
        continue;
      }
      if (state === "/*") {
        if (c === "*" && n === "/") { put(i, i + 2); stack.pop(); i += 2; continue; }
        put(i, i + 1);
        i++;
        continue;
      }
    }

    // Ordinary code.
    if (c === "'" || c === '"' || c === "`") { put(i, i + 1); openQuote(c, i); i++; continue; }
    if (c === "/" && n === "/") { put(i, i + 2); stack.push("//"); i += 2; continue; }
    if (c === "/" && n === "*") { put(i, i + 2); stack.push("/*"); i += 2; continue; }

    if (src.startsWith("agent(", i)) {
      const prev = i > 0 ? src[i - 1] : " ";
      // Not `.agent(`, not `subagent(`, not `myagent(`.
      if (!/[A-Za-z0-9_$.]/.test(prev)) sites.push(i);
      keep(i, i + 6);
      i += 6;
      continue;
    }
    keep(i, i + 1);
    i++;
  }
  return { sites, mask: mask.join("") };
}

/** End offset (exclusive) of the `agent(...)` call starting at `start`. */
export function callEnd(mask, start) {
  let i = start + "agent(".length;
  let depth = 1;
  while (i < mask.length) {
    const c = mask[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** Index of the first comma at bracket depth zero, or -1. */
export function topLevelComma(masked) {
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Verdicts: "missing" (provably no model), "unknown" (cannot be read — the
 * caller must allow it, at most with a note), "present" (value is the literal
 * model string lowercased, or null when set non-literally, e.g. shorthand).
 */
export function analyzeCall(raw, masked) {
  const open = masked.indexOf("(");
  const close = masked.lastIndexOf(")");
  if (open === -1 || close <= open) return { verdict: "unknown", why: "unparseable call" };

  const argsMask = masked.slice(open + 1, close);
  const argsRaw = raw.slice(open + 1, close);

  const comma = topLevelComma(argsMask);
  if (comma === -1) {
    // Genuinely one argument: `agent('prompt')`. Nothing can be setting a model.
    return argsRaw.trim() ? { verdict: "missing", why: "no opts argument" }
                          : { verdict: "unknown", why: "empty call" };
  }

  const optsMask = argsMask.slice(comma + 1);
  const optsRaw = argsRaw.slice(comma + 1);
  const trimmed = optsMask.trim();

  // Opts passed by reference or built by a helper — cannot be read, so it is
  // not ours to police.
  if (!trimmed.startsWith("{")) {
    return { verdict: "unknown", why: "opts passed as an expression rather than a literal" };
  }
  if (trimmed.includes("...")) {
    return { verdict: "unknown", why: "opts object spreads another value" };
  }

  // `model:`, `"model":` and `'model':` all count.
  const keyed = optsMask.match(/(^|[{,\s])(?:model|['"]model['"])\s*:/);
  if (keyed) {
    const after = optsRaw.slice(keyed.index + keyed[0].length);
    const literal = after.match(/^\s*(['"])([^'"]*)\1/);
    return { verdict: "present", value: literal ? literal[2].trim().toLowerCase() : null };
  }

  // Shorthand `{ model }`.
  if (/(^|[{,\s])model\s*(?=[,}])/.test(optsMask)) {
    return { verdict: "present", value: null };
  }

  return { verdict: "missing", why: "opts object has no model key" };
}

/**
 * Convenience entry point: scan a whole script and return one record per
 * readable agent() site: { line, verdict, value?, why? }. Line numbers are
 * computed in one linear pass + binary search — a per-site rescan was O(n·m)
 * and timed out at ~15k sites, which produced NO stdout at all: the one way a
 * fail-open hook can fail closed. Throws only on scan() itself failing; the
 * caller wraps in try/catch and allows.
 */
export function analyzeScript(src) {
  const { sites, mask } = scan(src);

  const newlines = [];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") newlines.push(i);
  const lineOf = (index) => {
    let lo = 0, hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  const results = [];
  for (const start of sites) {
    const end = callEnd(mask, start);
    if (end === -1) continue; // unbalanced — skip this call, fail open
    results.push({ line: lineOf(start), ...analyzeCall(src.slice(start, end), mask.slice(start, end)) });
  }
  return results;
}
