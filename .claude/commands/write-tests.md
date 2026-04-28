---
description: Write tests for a specific file or module. Loads the testing protocol + matching knowledge-base guide, then generates tests that follow repo conventions.
argument-hint: <path-to-source-file> [--coverage=full|smoke]
---

You are writing tests for: $ARGUMENTS

Follow this protocol exactly. Do not skip steps.

## Step 1 — Load the rules

Read in this order:

1. `docs/testing-protocol.md`
2. `knowledge-base/testing/core.md`
3. The topic-specific guide based on the target path:
   - `src/lib/**` → `knowledge-base/testing/units.md`
   - `src/app/**/actions.ts` → `knowledge-base/testing/server-actions.md`
   - View / RLS work → `knowledge-base/testing/views.md`
   - `tests/e2e/**` → `knowledge-base/testing/e2e.md` (and confirm with the user before adding a new spec — the E2E budget is two)

## Step 2 — Understand the target

Read the source file and any imports it depends on. Identify the public surface. List the behaviours that need coverage. If the relevant guide has a "Coverage checklist" for this file, use it as your spine.

## Step 3 — Plan

Before writing, output a short plan:

- File to create (colocated next to source, `.test.ts(x)`).
- Builders you'll use from `tests/fixtures/builders.ts` (or a new one to add).
- Behaviours you'll cover, in `describe` form.
- Anything you're deliberately NOT covering, with one-line reasons.

Wait for the user to OK the plan if `--coverage=full`. With `--coverage=smoke` or no flag, proceed.

## Step 4 — Write

- BDD naming: `describe("<unit>") > describe("when <state>") > it("should <behaviour>")`.
- Reuse builders. Don't inline literal fixture rows.
- For matrices, use `it.each`.
- For server actions, mock `next/cache` and `next/navigation` per `server-actions.md`.
- No snapshot tests of markup. No class-name assertions. No mocking our own modules.

## Step 5 — Verify

Run:

```sh
pnpm typecheck
pnpm test   # or pnpm test:int for integration
```

Fix anything that breaks. If a test can't be made deterministic, delete it and explain why in your report.

## Step 6 — Report

Report back:

- File created.
- Which checklist items from the guide you covered.
- What you skipped and why.
- Any new builder you added.
- Output of the test run.

Do not modify `docs/testing-protocol.md` or `knowledge-base/testing/**`. Those are policy documents — flag suggested changes to the user instead.
