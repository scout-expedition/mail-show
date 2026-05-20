# Next-letter linking cutover (#47)

## Context

An action can point to a "next letter" — the narrative continuation. Today that
link is stored as `actions.next_letter_variant char(1)`: a bare variant char
('a'/'b'/'c'). The *target letter* is resolved implicitly as "that variant in
the next letter group by storyline `sequence`." Two problems:

1. You can only ever link to the immediately-following group — never to a letter
   further along, and a bare variant can't name a letter when a day holds more
   than one group.
2. The variant model is fragile: deleting/moving letters or re-slotting variants
   silently invalidates the char, so the codebase carries a pile of defensive
   "orphan sweep" logic to null stale refs.

Migration `0037` (already applied; ships in PR #53) added `actions.next_letter_id
uuid` — a direct FK to `inspection_letters(id)` with `ON DELETE SET NULL` — and
backfilled it from `next_letter_variant`. This task is the **code cutover** to
the FK model, plus the feature it unlocks: the inspector's next-letter dropdown
should offer **the next day's letters in this storyline** instead of one fixed
group's variants.

This is **code-only** — no new migration. `next_letter_variant` stays in the DB
(dropping it would break `main`, which still reads it until this merges); a
follow-up migration drops the column after this PR ships.

## The rule (new next-letter model)

- **Stored value**: `actions.next_letter_id` — a direct FK to one
  `inspection_letters` row. The DB allows any letter; `ON DELETE SET NULL`
  self-heals deletions.
- **Validity (server + graph drag — one shared rule)**: a next letter is valid
  iff the **source and target letters both have an effective day**, they share a
  **storyline**, and `target.effective_day.number > source.effective_day.number`.
  This replaces the rigid `sequence + 1` adjacency — the "any letter" the task
  asks for — while still preventing backward links, self-links, cross-storyline
  links, and cycles. **`effective_day_id` can be `null`** (a group with no day,
  or an offset that resolves nowhere — see `inspection_letters_view`); a letter
  with a null effective day is never a valid source *or* target. The client
  dropdown, the graph drag mirror, and the server action must all apply this
  exact predicate so they never diverge on a null-day letter.
- **Inspector dropdown**: lists letters from **the next day** — the soonest day
  (by `days.number`) strictly after the source letter's effective day that has
  letters in this storyline. Multi-piece letters collapse to one row per
  `(group, variant)`, lowest piece. If the current `next_letter_id` points at a
  letter *not* on that day (older link / further-out graph drag), it's still
  shown as an extra highlighted row so the active selection is always visible.
- **Graph**: edge drawing resolves `next_letter_id` directly to a node — no
  rule, draws wherever it points. Drag-to-connect mirrors the server rule.

## Implementation

This lands as **a sequence of individually-compiling commits**, not a flag-day
swap. The trick: `ActionRow` carries *both* columns during the cutover (the DB
has both, so `select("*")` is accurately typed). Each consumer migrates in its
own commit with a green build; `next_letter_variant` is removed from the type in
the final commit, once nothing reads it. It still ships as one PR.

### 1. `src/lib/db/types.ts`
- `ActionRow`: **add** `next_letter_id: string | null` alongside the existing
  `next_letter_variant` for now. **Final commit**: remove `next_letter_variant`
  once every consumer below is migrated.

### 2. `src/app/(authed)/inspection/letters/actions.ts`
- **`setActionNextLetterByLetterId(actionId, letterId | null)`** — rewrite the
  body: on non-null, validate target letter is same-storyline + later effective
  day than the source letter, then `update({ next_letter_id: letterId })`. On
  null, `update({ next_letter_id: null })`. Drop the variant resolution and the
  `ensureLetterVariant` call.
- **Delete the next-letter orphan-sweep code** — the FK + `ON DELETE SET NULL`
  makes all of it dead:
  - the `next_letter_variant` branch of `sweepOrphanActionRefs` (keep the report
    branch untouched);
  - the `next_letter_variant`-clearing block in `moveLetterToGroup` (moving a
    letter now *preserves* the id-based link — strictly more correct);
  - the clearing block in `deleteGroup`;
  - the orphan block in `deleteInspectionLetter`.
- **`ActionPatchFields`** (used by `patchAction`): `next_letter_variant` →
  `next_letter_id`.
- **`createLetterInNextGroup` / `createNextLetterGroupAndLetter`**: already
  return `{ letterId, ... }`; callers will use `letterId`. Drop `variant` from
  the return shape if it becomes unused.
- **`ensureLetterVariant`**: if it's only reachable from next-letter code after
  the above, delete it (the `variant` *column* stays — it still drives
  `content_id` display — only the promote-on-link helper goes).

### 3. `src/app/(authed)/inspection/letters/workspace.tsx`
- `ActionState` + `toLetterState`: `next_letter_variant` → `next_letter_id`.
- Replace the `nextGroup` / `nextGroupLetters` memos (~lines 500–531) with a
  **`nextDayLetters`** memo: from the current letter's effective day, find the
  soonest later day with same-storyline letters; collect those letters
  (dedup per `(group, variant)`, lowest piece). Keep a small `nextSequenceGroup`
  derivation purely to choose between the "+ Letter" and "+ Letter Group +
  Letter" create rows.
- Thread `nextDayLetters` (+ the create-button flag) down through
  `LetterActionsCard` → `ActionEditor` in place of `nextGroup`/`nextGroupLetters`.
- Next-letter dropdown (~lines 4717–4846): list `nextDayLetters` (∪ the
  current target if off-list); `onPick` → `onChange({ next_letter_id: l.id })`
  directly — no variant promotion. Pill resolves `next_letter_id` against
  `allLetters`. Create rows call the create actions and store the returned
  `letterId`.
- `openLetterForAction` (~1341): find target by `next_letter_id` in `allLetters`.
- `letterOpen` prop (~3059): collapses to `a.next_letter_id === openLetterId`.
- Presence focus field (~4625): `field: "next_letter_variant"` → `"next_letter_id"`.

### 4. `src/app/(authed)/graph/graph-view.tsx`
- `optimisticNextByAction`: same `Record<string, string | null>` shape, value is
  now a **letter id** (was a variant char).
- Cleanup `useEffect` (~677): compare overlay value to `action.next_letter_id`.
- `dispatchNextLetter`: drop the separate `optimisticVariant` arg — overlay
  stores the `letterId` itself; signature becomes `(actionId, letterId | null)`.
- Edge resolution (~1519): `effectiveNextLetterId = optimistic ?? a.next_letter_id`;
  resolve it to a node via a new `letterById` map → `(group, variant, effective
  day)` → `makeLetterNodeId`. Remove the variant→letter machinery
  (`variantsInGroup`, `letterByGroupVariant`, and `groupByStorySeq` if unused
  elsewhere).
- Connector-source rendering (~1982): `effectiveNextForA` also falls back to
  `a.next_letter_variant` to derive `hasNext` / connector kind — switch it to
  `a.next_letter_id` (the `!!` truthiness check is otherwise unchanged).
- `resolveCurrentNextLetterId` collapses to `action.next_letter_id ?? null`.
- `onReconnect` / `onConnect`: swap the `sequence + 1` mirror check for
  same-storyline + later-effective-day; call `dispatchNextLetter(actionId,
  tgtLetter.id)`.
- `onReconnectEnd` / edge context-menu disconnect: `dispatchNextLetter(actionId,
  null)`.
- Update the `sn`/`ln` edge-kind comments to say `next_letter_id`.

### 5. `src/app/(authed)/graph/graph-surface.tsx`
- Undo `setNextLetter` case already stores/passes a letter id — verify, no
  change expected.

### 6. `src/app/(authed)/inspection/storylines/[id]/groups/[groupId]/actions.ts`
- Legacy form `updateAction` reads `next_letter_variant` from `formData`. Update
  it to `next_letter_id`; if the legacy form's `<select>` can't cleanly become
  id-based, drop the next-letter field from that legacy form (the modern
  workspace fully covers next-letter editing).

### 7. Tests
- `src/app/(authed)/inspection/letters/actions.test.ts`: the "clear dangling
  refs on move" test asserts the *old* behavior — rewrite it. New coverage:
  `setActionNextLetterByLetterId` stores the id + rejects an invalid target;
  moving a letter **preserves** the id link; deleting the target letter nulls
  `next_letter_id` (`ON DELETE SET NULL`).
- `tests/fixtures/builders.ts`: `makeAction` default `next_letter_variant: null`
  → `next_letter_id: null`.

## Kept / out of scope
- `next_letter_variant` **column stays** in the DB this PR (dropping it breaks
  `main`). Follow-up migration `0038` drops it once this is merged + deployed.
- `inspection_letters.variant` column is untouched — still drives `content_id`.
- The report-segment orphan sweep in `sweepOrphanActionRefs` is left alone.
- Create-new-letter affordances keep their current behavior (create in the
  next-sequence group / a new group); only the stored value changes to the id.

## Branch & rollout
- Branch `corey/next-letter-cutover` off the current HEAD of
  `corey/relative-delivery-dates` (it depends on this branch's rewritten
  `graph-view.tsx` / `workspace.tsx` / `actions.ts`). Open its PR against
  `corey/relative-delivery-dates` (stacked on #53); retarget to `main` once #53
  merges.
- **Dual-write gap**: until this PR ships, every live writer on `main`
  (`setActionNextLetterByLetterId`, `patchAction`, the legacy `updateAction`)
  still persists only `next_letter_variant`, so `next_letter_id` drifts stale
  for any next-letter edit made meanwhile. Mitigation: re-run the `0037` backfill
  `UPDATE` (idempotent) via Supabase MCP **immediately before merging**. Residual
  exposure is only edits made in the minutes between that resync and the merge —
  accepted for a small team. (If next-letter editing is heavy in the interim,
  the more robust fix is a tiny dual-write PR to `main` first — call it if so.)
- Save this plan to `docs/plans/active/next-letter-cutover-plan.md` on execution.

## Verification
- `pnpm typecheck` clean; `pnpm lint` no worse than the 46-problem baseline.
- `pnpm test` — `actions.test.ts` next-letter cases pass (real DB, per repo
  testing protocol).
- Dev server (`pnpm dev`, http://localhost:3000):
  - Inspector: next-letter dropdown lists the next day's storyline letters;
    picking one saves; the pill shows it; "open next letter" navigates there.
  - An action linked to a further-out letter still shows its pill + an
    extra dropdown row.
  - Graph (edit mode): drag-reconnect a next-letter edge to a valid letter;
    drop on empty space clears it; context-menu "Disconnect Next Letter";
    invalid drop (earlier day / other storyline) snaps back with no flash.
  - Graph edges draw correctly for `ln` (letter→next) and `sn` (report→next),
    including links that span more than one day.
  - Undo after a reconnect restores the prior target.
  - Realtime: change a next-letter link in one tab, confirm the other reflects
    it (presence focus + `postgres_changes`).
- Move a letter between groups — its inbound next-letter link is preserved
  (the key behavior change from the variant model).
