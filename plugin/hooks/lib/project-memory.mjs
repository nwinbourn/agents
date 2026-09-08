import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
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

export function loadProjectMemory(cwd) {
  const project = inspectProject(cwd);
  if (!project.adopted) return '';
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
