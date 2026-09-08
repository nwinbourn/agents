# Evidence and limitations

Run `node tests/run.mjs` from the repository root with Node 22+ and Git. There is
no package install, network service, credential requirement, or live model call.

The runner copies only `plugin/` into a temporary directory, verifies its manifest,
hook paths and JavaScript syntax, and runs all suites against that isolated copy.
Fixtures and Git remotes are temporary local directories. Core Git tests use an
isolated identity/configuration and do not contact GitHub or modify your projects.

| Area | Automated evidence | What it does not prove |
|---|---|---|
| Startup memory | Ordered sync/load, subfolder and worktree roots, docs fallback, missing/unreadable files, bounded excerpts, offline/dirty behavior and marker consistency | Semantic relevance or correctness of memory; live model behavior |
| Memory | Adoption detection, newer-file reminder, loop prevention, docs/STATE support, ignored build output | Semantic accuracy; deletions alone are not detected by the mtime heuristic |
| Dev workflow | Clean fast-forward, dirty-tree preservation, divergence handling, wrong-branch warning, unpushed work notice, unavailable remote, compaction skip | Blocking arbitrary writes/commits on main; live remote permissions |
| Wrap-up | Skill marker recognition, one-shot checks, lean state, excessive growth/length, expired markers | That an LLM follows the complete prose procedure or resolves conflicts correctly |
| Verifier | Branch, worktree, conflict/operation state, live remote equality/failure, committed shared memory, handoff fields and read-only behavior | Semantic accuracy, intended commit scope or background worker completion |
| Handoff | Scripted memory/code commit and push, followed by the next session's sync | Autonomous execution of the wrap-up skill; the test driver performs the commit/push |
| Harness | Modes, attempt thresholds, inherited/unknown models, concurrent counter updates, failure handling, read-only status | Delegation quality, accurate active-worker counts, or a cost budget |
| Packaging | Only plugin files in the payload; suites run with the repository files absent from that copy | A full Claude installer session; Git marketplace checkouts may include tests |

## Local validation

The 0.12.0 working tree passes 94 checks (18 core workflow, 16 startup memory,
20 wrap-up verifier and 40 harness), plus packaging and syntax checks, locally on
Windows with Node 24.15.0. All suites run against an isolated plugin copy. Hosted
cross-platform CI and live agent evaluation remain separate release checks.

## Continuous integration

`.github/workflows/tests.yml` runs the same command on Windows, macOS and Linux.
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
