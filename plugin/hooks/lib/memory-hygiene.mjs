// Memory hygiene: the guidance sizes, line counting, the PITFALLS entry shape and the
// session-start size line. Text functions plus one reader; no git, no writes.
import { readFileSync } from 'node:fs';

// Lines. Guidance, not caps: a file over guidance must leave every wrap-up shorter than
// it entered, or the agent says why not. The numbers come from the wrap-up skill.
export const GUIDANCE = { STATE: 400, CONTEXT: 300, PITFALLS: 300, DESIGN: 300 };
export const START_HERE_LINES = 25;
export const PITFALL_ENTRY_LINES = 12;
export const MEMORY_FILES = ['STATE', 'CONTEXT', 'PITFALLS', 'DESIGN'];

/** Lines the way an editor counts them: a trailing newline does not add one. */
export function countLines(text) {
  const parts = String(text).split(/\r?\n/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

/** Line and byte counts of the memory files that exist, keyed by name; unreadable files are skipped. */
export function memorySizes(memory) {
  const sizes = {};
  for (const name of MEMORY_FILES) {
    if (!memory?.[name]) continue;
    try {
      const text = readFileSync(memory[name], 'utf8');
      sizes[name] = { lines: countLines(text), bytes: Buffer.byteLength(text) };
    } catch { /* skipped: the loader reports unreadable files itself */ }
  }
  return sizes;
}

/** One line for session start: sizes, a rough token cost, and which files are over guidance. */
export function describeMemorySize(sizes) {
  const names = MEMORY_FILES.filter(name => sizes[name]);
  if (!names.length) return '';
  const bytes = names.reduce((sum, name) => sum + sizes[name].bytes, 0);
  const tokens = Math.round(bytes / 4);
  const over = names.filter(name => sizes[name].lines > GUIDANCE[name]);
  const cost = `${Math.max(1, Math.round(bytes / 1024))} KB, ${tokens < 1000 ? 'under 1K' : `roughly ${Math.round(tokens / 1000)}K`} tokens when all of it loads`;
  return `[memory-size] ${names.map(name => `${name}.md ${sizes[name].lines} line${sizes[name].lines === 1 ? '' : 's'}`).join(', ')}: ${cost}. ` +
    (over.length
      ? `Over guidance: ${over.map(name => `${name}.md ${sizes[name].lines}/${GUIDANCE[name]}`).join(', ')}. Wrap-up trims; mention this only if asked.`
      : 'All within guidance.');
}

/**
 * PITFALLS entries: every heading with no sub-headings under it, plus its body. An entry
 * is in shape when it carries Trap, Tell and Fix labels and stays under the line cap.
 * Returns the entry count and the entries that are off.
 */
export function pitfallShape(text) {
  const lines = String(text).replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
  const headings = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) headings.push({ level: m[1].length, title: m[2], index });
  });
  const entries = [];
  headings.forEach((heading, i) => {
    const next = headings[i + 1];
    if (heading.level === 1) return;                 // the file title
    if (next && next.level > heading.level) return;  // a group with entries under it
    const body = lines.slice(heading.index + 1, next ? next.index : lines.length);
    const count = body.filter(line => line.trim()).length;
    if (!count) return;
    const joined = body.join('\n');
    const has = re => re.test(joined);
    entries.push({
      heading: heading.title,
      lines: count,
      labeled: has(/\*\*(?:the )?trap:?\*\*/i) && has(/\*\*(?:the )?tell:?\*\*/i) && has(/\*\*(?:(?:the )?fix|instead):?\*\*/i),
    });
  });
  return { entries: entries.length, off: entries.filter(e => !e.labeled || e.lines > PITFALL_ENTRY_LINES) };
}
