# Plays: building

## implement-design

Turning a design — a Claude Design canvas, a Figma frame, a mockup image — into working
code. The defining constraint: **the design is in the conversation and the workers aren't.**

1. **The main loop reads the design.** Visual judgment never delegates.
2. **Extract a spec artifact to disk first.** `design-spec.md` (per-artboard layout notes,
   component inventory, states, spacing rules) plus a design-token file. Workers read the
   file, not the canvas. *This step is what makes the whole play cheaper than doing it
   inline* — without it, every worker needs the design re-described in its order.
3. **Partition by component boundary, never by artboard.** Artboards share components; an
   artboard split gives you five implementations of the same button.
4. **Sequence, don't fan out immediately.** Shared primitives and tokens go to *one*
   top-tier worker first. They're shared primitives, so that work gets T2 verification
   automatically. Only when it lands do you fan out screens to `sonnet` workers, each
   owning disjoint files.
5. **The main loop owns** the routing shell, the token file, barrel/index files, and
   `package.json`. Workers that need a change there put it in their return value.
6. **Verification:** workers self-verify with build + typecheck + "renders with sample
   props". **The visual comparison never delegates** — preview panes freeze scroll-driven
   motion, so a delegated inspector is confidently wrong about anything animated.
7. **Exit:** the merged tree builds, every artboard has a route, and the main loop opens
   the preview **once** to compare against the design.

## front-end build

Same shape as implement-design minus the canvas-extraction step, since the spec is usually
written or verbal.

- **Partition by component boundary.** State ownership is the thing that goes wrong — pin
  where state lives *before* dispatching, in the order.
- **The orchestrator writes the shared types/props first.** Workers implementing against
  an unpinned interface will each invent one.
- **Route:** `sonnet` for components from a spec; top tier for the state layer, routing
  architecture, or anything with subtle interaction logic.
- **Exit:** build + typecheck pass, every component renders with sample props.

## back-end build

**Contract-first, always.** The interface is the coordination mechanism.

1. **The main loop writes the contract** — OpenAPI, schema, type definitions — before any
   dispatch. This is the single highest-leverage step; workers implementing against an
   unwritten contract produce services that don't compose.
2. **One worker per bounded service or module**, each owning its own directory.
3. **Integration tests are the done-criterion**, not "the endpoint works". Name the exact
   command in every order.
4. **Route:** top tier for schema design, auth flows, data modeling, transaction
   boundaries, anything touching money or permissions. `sonnet` for handlers, CRUD,
   straightforward business logic against a written contract.
5. **Migrations never run in parallel.** Sequence them, with a rollback point between
   stages.
6. **Exit:** integration suite green against the real contract.

## general software build

For work that isn't cleanly front or back.

- **Slice vertically, not by layer.** A worker that owns "the export feature end to end"
  produces something testable; workers split into "all the models" / "all the controllers"
  produce three halves of a feature that don't meet.
- **Pin every interface the slices share, first, in the main loop.**
- **Build the walking skeleton inline** — the thinnest end-to-end path — then fan out to
  fill it in. Fanning out before the skeleton exists means N workers each guessing at the
  same structure.
- **Route:** the skeleton and shared primitives go top tier; the fill-in goes `sonnet`.
- **Exit:** the build passes and the feature works end to end, exercised by a real command.

## Common failure across all four

**Fanning out before the interface is pinned.** Every one of these plays has the same
first move: the orchestrator decides the shape, writes it down, and only then parallelizes
the filling-in. Skipping that step is what turns a fan-out into a merge disaster, and the
merge costs more than the parallelism saved.
