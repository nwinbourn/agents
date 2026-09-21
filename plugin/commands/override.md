---
description: One-time bypass of the branch guard for a genuine hotfix straight to main
argument-hint: "[what you're fixing]"
---
The user is authorizing a **one-time, this-project-only** relaxation of the branch guard so a
genuine hotfix can land on `main` while `dev` holds a bigger, unfinished change. This does not
change the workflow — big work still goes through `dev`. Use it only for a small, deliberate fix
that has to reach production now.

What it does: while armed, the guard's hard refusals for THIS repository become ordinary
approve-prompts instead of flat refusals — most importantly "commits go on dev, not main".
Nothing is silenced: switching to `main`, committing and pushing each still prompt you, and you
approve each one. It is scoped to this one repository and expires on its own after a short window.

Do this, in order:

1. Arm it for the current repository (run from inside the repo; it scopes to the git root):

   ```sh
   node "<plugin-root>/hooks/branch-guard-override.mjs" arm
   ```

   Resolve `<plugin-root>` from this command's location — the hooks live at `<plugin-root>/hooks/`.
   Relay the one-line confirmation it prints.

2. Do the hotfix the user asked for: switch to `main`, make the fix, commit, and push. Each of
   these now ASKS for approval instead of being refused — let the user approve each one, do not
   try to suppress the prompts, and pause to confirm before pushing to production `main`.

3. The moment the fix is pushed (or the user calls it off), clear the bypass so the guard is
   fully back on:

   ```sh
   node "<plugin-root>/hooks/branch-guard-override.mjs" clear
   ```

Never use this bypass to force-push, hard-reset, rebase a shared branch, or delete branches
unless the user explicitly asks — those prompts are protocol, not strictness. Anything that
belongs on `dev` still goes on `dev`.

$ARGUMENTS
