# agents (this repo)

@import templates/AGENTS.md

Local `CONTEXT.md` / `STATE.md` are the maintainer's private tracking — untracked and
gitignored, never published. Read them if they exist on this machine.

This repo eats its own dogfood: `templates/AGENTS.md` is both the template we ship AND
the live protocol for working on this repo itself (one home per fact — no separate
copy). **Work on `main`** — this is a plugin repo, not a live auto-deploying site, so
the `dev` flow in that template does not apply here.

Repo-only rules:

- Hooks are plain Node (`.mjs`), zero dependencies, cross-platform (Windows + macOS +
  Linux). Path handling via `node:path` / `homedir()`; nothing shell-specific.
- Every hook must fail SILENT and exit 0 on unexpected errors — a broken hook must
  never break someone's session start.
- Hooks reference their own files via `import.meta.url`, and `hooks/hooks.json` uses
  `${CLAUDE_PLUGIN_ROOT}` — never absolute paths.
- Nothing personal ships here: no names in hook output, no account-specific caps, no
  machine paths. Personal tuning lives in each user's `~/.claude/`.
- Version bump `.claude-plugin/plugin.json` (and marketplace.json) on any change a
  user would receive.
