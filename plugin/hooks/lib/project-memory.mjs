import { openSync, readSync, closeSync, fstatSync, readFileSync, existsSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inspectProject } from './project-inspection.mjs';

export const FILE_LIMIT_BYTES = 12 * 1024;
export const TOTAL_LIMIT_BYTES = 32 * 1024;

function readBounded(path, limit) {
  let fd;
  try {
    fd = openSync(path, 'r');
    if (!fstatSync(fd).isFile()) throw Error('Not a file');
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    const used = Math.min(bytes, limit);
    return { text: new StringDecoder('utf8').write(buffer.subarray(0, used)), bytes: used, truncated: bytes > limit };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Files the project's CLAUDE.md already pulls into context through `@path` imports,
 * followed up to five hops deep (Claude Code's own limit). Loading them again here
 * would cost the same tokens twice.
 */
export function importedByLoader(root) {
  const imported = new Set();
  const seen = new Set();
  const visit = (file, depth) => {
    if (depth > 5 || seen.has(file)) return;
    seen.add(file);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { return; }
    let fence = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      for (const match of line.matchAll(/(?:^|\s)@([^\s@`'"()<>[\]]+)/g)) {
        const target = match[1].startsWith('~/') ? resolve(join(homedir(), match[1].slice(2))) : resolve(dirname(file), match[1]);
        imported.add(target);
        if (/\.md$/i.test(target) && existsSync(target)) visit(target, depth + 1);
      }
    }
  };
  for (const name of ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')]) {
    const file = join(root, name);
    if (existsSync(file)) visit(file, 0);
  }
  return imported;
}

export function loadProjectMemory(cwd) {
  const project = inspectProject(cwd);
  if (!project.adopted) return '';
  const imported = importedByLoader(project.root);
  const lines = [
    `[project-memory] Project root: ${project.root}`,
    `Workflow: ${project.workflow}. These are current files from this checkout, read after the startup sync attempt.`,
    'Use this project context for the next task. Missing or excerpted content is not a complete memory record; read the indicated files when needed.',
  ];
  let remaining = TOTAL_LIMIT_BYTES;
  for (const name of ['STATE', 'CONTEXT', 'PITFALLS', 'DESIGN']) {
    const path = project.memory[name];
    if (!path) {
      if (name === 'STATE' || name === 'CONTEXT') lines.push(`Missing required memory: ${name}.md (checked the project root and docs/). Do not invent its contents.`);
      continue;
    }
    lines.push(`\n--- ${name}.md | ${path} ---`);
    if (imported.has(resolve(path))) { lines.push('Already in context through a CLAUDE.md import; not repeated here.'); continue; }
    if (!remaining) { lines.push('Not loaded: startup memory budget reached. Read this file before relying on it.'); continue; }
    try {
      const part = readBounded(path, Math.min(remaining, FILE_LIMIT_BYTES));
      remaining -= part.bytes;
      lines.push(part.text.trim() ? part.text : 'This memory file is empty.');
      if (part.truncated) lines.push('\n[Excerpt only: file exceeds the startup budget. Read the full file before relying on omitted sections.]');
    } catch { lines.push('Unreadable memory file. Inspect this path before relying on its contents.'); }
  }
  return lines.join('\n');
}
