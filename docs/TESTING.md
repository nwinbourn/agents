# Evidence and limitations

Run `node tests/run.mjs` from the repository root with Node 22+ and Git. There is
no package install, network service, credential requirement, or live model call.

The runner copies only `plugin/` into a temporary directory, verifies its manifest,
hook paths and JavaScript syntax, and runs all suites against that isolated copy.
Fixtures and Git remotes are temporary local directories. Core Git tests use an
isolated identity/configuration and do not contact GitHub or modify your projects.

| Area | Automated evidence | What it does not prove |
|---|---|---|
| Startup memory | Ordered sync/load, subfolder and worktree roots, docs fallback, missing/unreadable files, bounded excerpts, files already imported by CLAUDE.md not repeated, offline/dirty behavior, marker consistency, the previous-handoff line (clean, dirty or unpushed), the memory-size line and the leftover-branch line | Semantic relevance or correctness of memory; the token figure is bytes divided by four; live model behavior |
| Memory | Adoption detection, newer-file reminder, loop prevention, docs/STATE support, ignored build output | Semantic accuracy; deletions alone are not detected by the mtime heuristic |
| Dev workflow | Clean fast-forward, dirty-tree preservation, divergence handling, wrong-branch warning, unpushed work notice, unavailable remote, compaction skip | Blocking arbitrary writes/commits on main; live remote permissions |
| Wrap-up | Skill marker recognition, one-shot checks, lean state, expired markers, missing or vague Start here block, extra content in the block, an over-guidance file that did not get shorter during wrap-up, PITFALLS entries without the Trap / Tell / Fix shape, dated and "we added" lines, facts duplicated from CONTEXT.md | That an LLM follows the complete prose procedure, trims well rather than just shorter, or resolves conflicts correctly; changelog creep phrased in ways the patterns miss |
| Verifier | Branch, worktree, conflict/operation state, live remote equality/failure, tracking-mode comparison, committed shared memory, handoff fields (including fields that continue on the lines below), vague first step, unrecorded commits on stray branches and worktrees, and read-only behavior | Semantic accuracy, intended commit scope or background worker completion; whether a branch named in STATE.md is described accurately |
| Handoff | Scripted memory/code commit and push, followed by the next session's sync | Autonomous execution of the wrap-up skill; the test driver performs the commit/push |
| Branch guard | Task branches, worktrees and worktree-isolated agents refused in adopted projects; commits kept on dev; release prompts for main; prompts for force-push, rebase, hard reset and branch deletion; force-delete and forced worktree removal prompting in every mode; chained commands, quoted text, heredocs, PowerShell, `cd` and `git -C` targeting; personal settings softening refusals; read-only behavior | Git run outside the Bash/PowerShell tools, aliases, scripts that call git, other agents; the clean-branches walk-through itself is prose the agent follows |
| Branch guard override | `/override` arms a one-shot, project-scoped bypass that downgrades this repo's hard refusals (commit off dev, task-branch and worktree creation) to prompts while leaving existing prompts and silent operations unchanged; scope to one repository; expiry (ignored and deleted); a corrupt file failing safe; arm/status/clear and `--minutes`; read-only behavior | That the model runs arm/clear around a hotfix as instructed; the live permission prompt UI; time-based expiry in a real session |
| Harness | Modes, attempt thresholds, inherited/unknown models, concurrent counter updates, failure handling, read-only status | Delegation quality, accurate active-worker counts, or a cost budget |
| Packaging | Only plugin files in the payload; suites run with the repository files absent from that copy | A full Claude installer session; Git marketplace checkouts may include tests |

## Local validation

The 0.16.0 working tree passes 138 checks (23 core workflow, 21 startup memory,
26 wrap-up verifier, 17 branch guard, 11 branch guard override and 40 harness), plus
packaging and syntax checks, locally on Windows with Node 24.15.0. All suites run against an isolated plugin copy. Hosted
cross-platform CI and live agent evaluation remain separate release checks.

## Continuous integration

`.github/workflows/tests.yml` runs the suite on Windows, macOS and Linux through
`tests/ci.mjs`, which exposes failed assertions in public check annotations.
The workflow also offers an artifact containing only the plugin directory after all
test jobs pass. Hosted CI results exist only after the change is pushed and runs.

## Live evaluation before a release

Use a disposable project with a local or test remote. Record the plugin version,
model/runtime version, expected behavior, actual result and any remaining work.
Do not label these scenarios passed without running them in an agent session.

1. **Cold start:** seed STATE with one active task and one open decision. Start a fresh
   session and ask "what's next?" Check that the agent identifies both without inventing work.
2. **Wrap-up:** complete a small task, leave another unfinished, and introduce a settled
   decision. Invoke wrap-up. Check classification, no activity log, an accurate Start
   here block, scope control and explicit disclosure of incomplete verification.
3. **Shared handoff:** approve the commit/push on dev, start a second person's session,
   and verify it receives both the code and current memory before acting.
4. **Wrong branch:** open main in a project with origin/dev. Verify the warning and
   that the agent follows the project rule before making changes. This is behavioral
   evaluation, not proof of a universal write barrier.
5. **Conflict:** let two sessions change code and memory. Check that wrap-up preserves
   local work, surfaces conflicts, and never reports a completed handoff while work is unshared.
6. **Optional harness:** try a small local edit, independent parallel tasks, and a
   requirement change during execution. Check ownership and main-agent verification.

## Contributing tests

Keep test code in `tests/`, never `plugin/`. Build small fixtures at runtime rather
than committing generated projects, binaries or dependencies. Add a regression for
observable behavior and run the public command before submitting a change.
