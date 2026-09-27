# AGENTS.md

Shared rules for all AI agents working on this project. Read this before doing any
work. Agent-specific config (Claude's CLAUDE.md, Codex's config, etc.) extends these
rules but cannot contradict them.

## Project memory files

Read these files for full project context. All agents may read AND write to them,
but must follow the rules below.

| File | What it holds | When it exists |
|---|---|---|
| `CONTEXT.md` | What the project IS — audience, stack, settled decisions, standing constraints | Always |
| `STATE.md` | Where the build stands and what's next — statuses, next actions, open questions | Always |
| `DESIGN.md` | Visual identity and brand — palette, typography, spacing, references, mood | When the project has a real visual system |
| `PITFALLS.md` | Traps that cost real debugging time — the failure, its tell, the fix | When the same class of bug has bitten twice |

### What goes where

| What you're recording | File | Shape |
|---|---|---|
| A fact about what the project *is* | `CONTEXT.md` | Present tense, no date |
| What remains to do or where things stand | `STATE.md` | A status or next action |
| A visual/brand decision | `DESIGN.md` | The decision and the why |
| A trap that cost real debugging time | `PITFALLS.md` | The trap, its tell, the fix |
| "On [date] we did X" | **Nowhere** | Git has it |

### What does not belong

| File | Not here |
|---|---|
| `CONTEXT.md` | Implementation detail the code already says, paths that can be grepped, anything with a date |
| `STATE.md` | What happened, verdict transcripts, undecided ideas beyond one line each, warnings that are really constraints (CONTEXT) or traps (PITFALLS) |
| `PITFALLS.md` | War stories, one-time mistakes, anything that has not bitten twice |
| `DESIGN.md` | The history of how the look got there, reversed choices |

### Rules for writing to memory files

- **No changelogs.** `STATE.md` tracks where things STAND, not what happened. No dated
  entries, no "Done" logs, no "we added/fixed/changed" lines. A finished thing gets a
  status on its phase, or becomes a fact in `CONTEXT.md`.
- **No silent rules.** Facts, status, and context may be written without asking — that
  is normal work. A RULE or standing constraint needs the user's sign-off first: draft
  the exact wording, show it, get explicit approval. Never generalize a one-off design
  reaction into a rule.
- **One home per fact.** Every value lives in one file. State it once, reference it from
  elsewhere. Two copies will drift and one will be wrong.
- **Settled decisions graduate.** Once decided, move it from `STATE.md` to `CONTEXT.md`
  — it's now part of what the project is, not work in progress.
- **Delete what's stale.** An outdated entry is worse than a missing one because it gets
  trusted. If something is no longer true, remove it.
- **Every wrap-up removes as well as adds.** Guidance sizes: `STATE.md` 400 lines,
  `CONTEXT.md` 300, `PITFALLS.md` 300, `DESIGN.md` 300. Over that, a wrap-up leaves the
  file shorter than it found it, or says why not. Size is never the goal; files worth
  reading are. Session start reports the sizes; the check after wrap-up enforces the habit.
- **Start here is three fields and nothing else.** `Do this first`, `Waiting on you`,
  `Mid-flight`, under 25 lines together. Banners and commands go to `CONTEXT.md`, traps
  to `PITFALLS.md`, tasks into the body.
- **A pitfall is a heading plus Trap, Tell, Fix.** Under 12 lines, no story. If it can't
  be said that briefly, it isn't understood yet.
- **Explicit statuses.** Use `✅ done` / `🔶 in progress` / `⬜ not started` — not bare
  checkboxes. A naked checklist reads as all-to-do and hides what's finished.
- **Separate decided work from ideas.** Mixing them makes the list look longer and less
  trustworthy. Moving an idea into the next-up list is itself the decision.

## Git flow

**Most projects: work directly on `main`.** That is the default and it is fine.

The `dev` flow below applies **only** when the repo already has an `origin/dev` branch —
a deliberate choice a team makes for a **live** project where `main` auto-deploys to real
users. If there is no `dev` branch, there is nothing to adopt here.

**No agent ever creates `dev`.** Not to "have a working branch", not to be safe, not
because this section exists. If a live, auto-deploying project with more than one person
clearly should have `dev` and doesn't, say so and get an explicit go-ahead — never
create it unilaterally.

```text
main   ─────────────────────●─────────────────────●────   live site (auto-deploys)
                           ↑                     ↑
                         merge                 merge      ← rare, deliberate releases
                           │                     │
dev    ──●──●─────●──●─────●──●──●──────●──●─────●────    the working branch
              ╲      ↗           ╲        ↗
         feature/mobile-nav    fix/footer-links           parallel work, each in its own
                                                          folder, merged back at wrap-up
```

**Without `dev`: one working branch, no task branches.** Nobody creates a feature branch
or a worktree for a task — the work goes on `main`. A repo full of half-merged task
branches is the mess this rule exists to prevent. On a `dev` project, parallel work gets
short-lived `feature/` and `fix/` branches instead (below). In Claude Code the plugin's
branch guard enforces both at the command line; other agents follow them by reading
this file.

**Leftovers get resolved, not ignored.** A branch or worktree other than the working
branch — and, on a `dev` project, other than an open `feature/` or `fix/` branch in its
own folder — is unintegrated work: it is named in `STATE.md` under Mid-flight until it is
merged or deleted, and the wrap-up verifier stays incomplete while it is not. Merged
leftovers are clutter. Session start lists them all; "clean up the branches" walks
through them, and nothing is deleted without the user's yes.

### When `origin/dev` exists

- **`main` is the live site.** Nothing lands there except a release the user asks for
  (`dev` → `main`) or a hotfix under `/override`.
- **`dev` is where work happens.** Every session starts on `dev` in the project folder,
  and the project folder never leaves `dev`.
- **Before the first change, ask: "Straight on `dev`, or a branch off `dev`?"** One thing
  at a time goes straight on `dev`. Two or more things at once each get a branch.
- **A branch is `feature/<task>` or `fix/<task>`, made off `dev`, in its own worktree** at
  `.claude/worktrees/<task>`. Name it after the task in plain words (`feature/mobile-nav`).
  Never create one without the user's yes.
- **Every branch merges back into `dev` at wrap-up**, and then its branch and folder are
  deleted. A branch stays open only if the user says so, and then `STATE.md` names it
  under Mid-flight.
- **Opening a branch, step by step.** `git worktree add .claude/worktrees/<task> -b
  feature/<task> dev` (the user approves it), then move the session into that folder
  (in Claude Code: EnterWorktree with that path). In the new folder, install dependencies
  (`npm install` or the project's equivalent), copy the `.env*` files over from the
  project folder (Git does not carry them), and run its dev server on its own port.
  `.claude/worktrees/` must be ignored by Git (`.gitignore` or `.git/info/exclude`).
- **Never report how far `dev` is ahead of `main`.** Work accumulates on `dev` for weeks
  between launches — being far ahead IS the flow, not news and not a prompt to act.
  Don't volunteer the commit distance and don't suggest merging or PR-ing to `main`;
  releases happen when the maintainer says so. Mention `main` only when the user asks,
  when they start a release, or when something is genuinely wrong (e.g. a commit landed
  on `main` directly).
- **Session start: sync first.** Pull `origin/dev` before working — fast-forward only,
  and only when the tree is clean. Behind with uncommitted changes, diverged, or on
  another branch (other than this session's own `feature/` or `fix/` folder) → tell the
  user and ask. Never switch branches, merge, or rebase on your own.
- **Session end: leave `dev` committed and pushed.** Unpushed work is invisible to every
  other person — and to their agents' memory. The wrap-up ritual enforces this.
- **Memory files travel with the branch.** CONTEXT/STATE/PITFALLS updates are committed
  and pushed like code — that is what makes project memory shared across people and
  sessions. A conflict in a memory file is prose: merge both truths and re-read the
  result. A conflict in code the user can't resolve: abort the merge, park the session's
  commits on a `wip/<name>-<topic>` branch, record who needs to finish it in `STATE.md`,
  and say so plainly.
- **Commit as yourself.** Each machine sets `git config user.name` / `user.email` so
  history shows who did what — this works even on a shared GitHub account.
- **Never, without explicit human approval:** force-push, rebase a shared branch,
  hard-reset, or delete branches — except the merged `feature/` or `fix/` branch that
  wrap-up tidies away after merging it back.

## Stack and tooling

<!-- Fill in per project: framework, language, package manager, how to run/test -->

## Conventions

<!-- Fill in per project: commit style, branch naming, PR format, testing expectations -->

## Boundaries

<!-- Fill in per project: sensitive files, areas that break easily, things to be careful with -->
