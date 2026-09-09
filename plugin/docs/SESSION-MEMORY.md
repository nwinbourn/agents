# Session-start memory

On startup, resume and clear, one hook runs the existing Git sync and then reads
project memory from the resulting checkout. A separate parallel hook is not used,
so a clean dev fast-forward finishes before the memory is loaded.

The loader supplies context to the agent; it does not print the files as a chat reply.
It loads STATE, CONTEXT, and any existing PITFALLS or DESIGN file. Missing STATE or
CONTEXT is explicit once the project has adopted memory or the shared dev workflow.
Missing optional files do not produce a warning.

## Shared discovery rules

The startup loader, Git sync, state reminder, wrap-up marker/check and verifier use
`hooks/lib/project-inspection.mjs`:

- Git projects resolve to the working-tree root, including from subfolders or linked
  worktrees. Memory inside an arbitrary nested folder does not replace root memory.
- Outside Git, the requested directory is the root; discovery does not walk upward
  into unrelated parent memory. Start at the project directory in this case.
- Each memory file is found at the root first, then `docs/`. Only one copy is loaded.
- STATE or CONTEXT adopts memory. A recorded `origin/dev` also enables the loader so
  it can report missing required memory. Unadopted projects stay silent.
- The shared dev workflow is detected from the existing tracking reference. Discovery
  itself does not fetch, change branches, create memory or create dev.

The reminder scans the resolved root, and the wrap-up marker uses that same root as
its key. Starting the skill in `src/` and stopping at the repository root no longer
produces two different memory locations or markers.

## Freshness and limits

If syncing is refused because of dirty or diverged work, the agent receives the sync
warning alongside the current local files. It must not treat those files as verified
up to date with the remote. Offline sessions likewise retain the stale-sync notice.

The loader reads at most 12 KiB per file and 32 KiB total, prioritizing STATE, CONTEXT,
PITFALLS, then DESIGN. Excerpts, empty/unreadable files and budget omissions are marked
with the source path. The agent must read omitted sections when relevant. These are
byte limits, not token limits or semantic summaries.

Compaction does not run this hook. Startup/resume/clear always reread disk rather
than using a cached memory copy. The project's CLAUDE.md loader remains a portable
fallback; the startup context reflects files after this sync attempt.

## The previous handoff

Startup also checks what the last session left behind, mechanically, with the
wrap-up verifier run against the checkout after the sync attempt: working branch,
clean checkout, no unfinished Git operation, a usable Start here block (three fields,
first step naming a file, route or command) and, on shared projects, whether `dev`
matches `origin/dev` as of that fetch. The result is one `[handoff]` line that the
agent must relay to the user before starting work. It comes from git, not from the
prose in STATE.md, so a confident Start here block cannot hide uncommitted or
unpushed work.

Memory selection and injection do not prove that the agent understands the files,
that they are accurate, or that no concurrent writer changes them afterward. The
wrap-up verifier and live evaluation scenarios cover the other end of the workflow.
