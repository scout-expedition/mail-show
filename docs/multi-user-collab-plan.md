# Multi-user collaborative editing — phased plan

## Context

Today every editor in mail-show is single-player: plain `useState` + dirty flags + `useTransition` + Server Actions + `revalidatePath()`, with a `useUnsavedDialog` modal blocking navigation. Two users on the same letter clobber each other silently and have no idea the other is there. The goal is Google-Docs-style live editing — instant per-field save, presence avatars, and focused-field "Alice is editing" indicators — converted surface-by-surface starting with the highest-traffic editor.

### Locked-in decisions

- First surface = **LettersWorkspace** (`src/app/(authed)/inspection/letters/workspace.tsx`). Endings docs come later (Phase 4b).
- Conflict model = **last-write-wins, debounced per-field saves**. `updated_at` columns already exist on every editable table (`supabase/migrations/0001_init.sql:13-19,194`) for future explicit-conflict refresh.
- Presence depth = **focused-field indicators** (= avatars + per-record dots + per-field labels, bundled).
- Realtime stack = **Supabase Realtime** (`@supabase/supabase-js` channels — broadcast + presence + postgres_changes). No yjs/liveblocks/partykit.
- Rollout = **per-surface rip-and-replace**. Other surfaces keep current save flow until their turn.
- Attribution during a live session = **hidden**. Show "last updated by X" only when no peer has the record focused.
- Remote delete/move while local has unflushed edits = **silent drop + toast** ("Alice deleted this letter group").
- LWW merge rule for incoming `postgres_changes`: apply remote update **except for the field currently focused with unsaved local input** — other columns on the same row update freely.
- `revalidatePath` policy: **stripped from per-field `patch*` actions** (realtime handles fan-out). Kept on structural mutations (create/delete/reorder).

## Phase 0 — Realtime primitives

Shared layer + sandboxed presence smoke test on `/settings`. No user-facing editor changes yet.

### Files

- `supabase/migrations/0031_realtime_publication.sql` *(new)* — `alter publication supabase_realtime add table public.inspection_letters, public.letter_groups, public.actions, public.report_segments, public.storylines;` plus `alter table … replica identity full;` on each so `postgres_changes` payloads carry the prior row (needed for column-level diff).
- `src/lib/realtime/channel.ts` *(new)* — `useRealtimeChannel(name, { onBroadcast, onPostgres })`. Wraps `createSupabaseBrowserClient().channel(name, { config: { presence: { key: userId } } })`. Channel naming: **one channel per top-level surface** (`letters-workspace`, `graph`, etc.); payloads carry `{ table, recordId, field }` so consumers filter.
- `src/lib/realtime/presence.ts` *(new)* — `usePresence(channel)` → `{ peers: PresencePeer[] }` where peer = `{ userId, email, color, focus: { table, recordId, field } | null }`. Color derived deterministically from `userId` hash.
- `src/lib/realtime/use-instant-field.ts` *(new)* — `useInstantField<T>({ value, onCommit, debounceMs=400, focusKey, channel })`. Tracks `localValue` + `status: idle|dirty|saving|error`. On change: set local, broadcast `field-focus` (throttled ~150ms), schedule debounced commit. On commit error: revert + status=error (inline glyph, no toast). Implements the LWW merge rule above.
- `src/lib/realtime/field-presence.tsx` *(new)*, `record-presence.tsx` *(new)*, `avatar-stack.tsx` *(new)* — UI atoms.
- `src/lib/realtime/__tests__/use-instant-field.test.tsx`, `presence.test.ts`, `channel.test.ts` *(new)* — unit tests.

### Work order — serial vs parallel

```
serial:  migration → channel.ts
parallel after channel.ts:
  ├─ presence.ts                ─┐
  └─ use-instant-field.ts        │
                                 ▼
parallel after presence.ts + use-instant-field.ts:
  ├─ field-presence.tsx
  ├─ record-presence.tsx
  ├─ avatar-stack.tsx
  └─ unit tests (all three above)
serial last: /settings smoke check
```

### Tests

- **Unit** (`vitest`):
  - `use-instant-field.test.tsx` — debounce timing, status transitions (`idle→dirty→saving→idle`), error path reverts `localValue`, merge rule (remote update applied when `idle`, dropped only for the focused field when `dirty`, accepted for other columns on the same row).
  - `presence.test.ts` — peers join/leave, focus updates, color hash determinism.
  - `channel.test.ts` — `removeChannel` fires on unmount, idempotent re-subscribe.
- **Manual smoke**: mount a throwaway `<FieldPresence />` on `/settings`; two browser profiles + two test accounts; confirm presence + focus broadcast end-to-end.

## Phase 1 — Convert LettersWorkspace

### Files

- `src/app/(authed)/inspection/letters/workspace.tsx` *(edit)* — delete `useUnsavedDialog`, `groupDirty`/`letterDirty`/`actionsDirty`/`storylineDirty`, `dirtyKind`, `saveAllRef`, `onDirtyChange`, `saveAllNow`, `askUnsaved`. Each field becomes `useInstantField` bound to a narrow `patch*` action. Wrap inputs in `<FieldPresence />`. Subscribe once to the `letters-workspace` channel; pipe `postgres_changes` through reducers that update `groupState` / `letterState` / `actions` by id + column. Implement "remote delete → silent drop + toast" path. Hide "last updated by" footer when any peer's `focus.recordId` matches.
- `src/app/(authed)/inspection/letters/actions.ts` *(edit)* — add **narrow** patch actions: `patchInspectionLetter(id, patch)`, `patchLetterGroup(id, patch)`, `patchAction(id, patch)`, `patchReportSegment(id, patch)`. These do **not** call `revalidatePath`. Existing coarse actions (`saveLetter`, `updateAction`, `updateLetterGroup` at lines 119–408) kept for compat — other surfaces still call them. Structural mutations (`moveLetterGroupToDay`, `moveLetterToGroup`, etc.) keep their dual `revalidatePath` for `/inspection/letters` + `/graph`.
- `src/app/(authed)/graph/graph-surface.tsx` *(edit)* — drop `saveAllRef`, `inspectorDirtyKind`, and the unsaved-prompt-on-drag logic (lines ~164–222 per Phase 1 exploration). Inspector is now always clean.
- `tests/e2e/realtime-letters.spec.ts` *(new)* — two-context Playwright spec (see Tests below).

### Untouched (still in use by other surfaces; deleted in Phase 4 cleanup)

- `src/components/auto-save-form.tsx`
- `src/components/unsaved-dialog.tsx`
- `src/components/panel.tsx` duplicate of `useUnsavedDialog`

### Work order — serial vs parallel

```
parallel with Phase 0 (no dependency on primitives):
  └─ Track A: add narrow patch* actions to actions.ts
                  (ships green; no callers yet)

after Phase 0 + Track A:
  ├─ Track B: convert workspace.tsx
  │   ├─ replace fields with useInstantField
  │   ├─ wire FieldPresence / RecordPresence
  │   ├─ postgres_changes reducer (per id + column)
  │   └─ delete-while-editing toast path
  └─ Track C (in parallel with B): scaffold realtime-letters.spec.ts
                  (finalize selectors once B lands)

serial last:
  └─ Track D: graph-surface.tsx cleanup
              (depends on workspace.tsx no longer exposing
               saveAllRef / onDirtyChange)
```

### Tests

- **Unit** (`vitest`):
  - Workspace reducer: applying remote `INSERT/UPDATE/DELETE` postgres_changes to local `groupState`/`letterState`/`actions` by id+column; preserve focused-field local value during remote update; close panel + emit toast on DELETE of currently-selected row.
  - Contract test: `patch*` actions don't import `revalidatePath` (regression guard via a grep-style assertion in the test).
- **E2E** (`tests/e2e/realtime-letters.spec.ts`, two contexts via `browser.newContext({ storageState })` per `project_e2e_followup` memory):
  1. Type letter content in context A → context B sees text within debounce window (≤600ms after last keystroke).
  2. Focus a field in A → B sees "Alice is editing" indicator + colored avatar at the field; blur in A → indicator clears.
  3. Delete a letter group in A → B's selected panel closes, toast surfaces "Alice deleted this letter group".
  4. Two users edit *different* fields on the same letter simultaneously → both saves persist; no clobber.
- **Manual smoke**: full 5-panel slide with two profiles; verify caret stability when peer types in a different field on the same letter.

## Phase 2 — App-wide presence affordances

Make collaborators visible outside the workspace.

### Files

- `src/components/app-shell.tsx` *(edit)* — mount `<AvatarStack />` in the header, subscribed to a global `app-presence` channel.
- `src/app/(authed)/inspection/letters/workspace.tsx` *(edit)* — add `<RecordPresence />` dots on storyline / group / letter list rows.

### Work order — serial vs parallel

```
fully parallel:
  ├─ avatar-stack mount in app-shell.tsx
  └─ record-presence dots in workspace lists
```

### Tests

- **Unit**: `AvatarStack` renders deterministic colors from `userId` hash (matches `presence.test.ts` palette).
- **E2E** (extend `realtime-letters.spec.ts`): second user signs in → avatar appears in context A's header within 2s. Open same storyline in both → list-row dot renders on the open record.
- **Manual**: avatars in `<AppShell>` across all routes (not just letters); dots in storyline/group lists.

## Phase 3 — Graph surface

### Files

- `src/app/(authed)/graph/graph-surface.tsx` *(edit)* — subscribe to a `graph` channel; render small presence dots on each xyflow node whose `recordId` matches a peer's `focus.recordId`. Optionally broadcast selected-node id on click.
- Structural drag-drop actions stay as-is (already revalidate both routes correctly).

### Work order — serial vs parallel

```
serial inside a single PR:
  channel subscription wiring
    → node-dot overlay rendering
```

### Tests

- **E2E** (new `tests/e2e/realtime-graph.spec.ts` or extend `realtime-letters.spec.ts`): select a letter in context A's graph view → dot appears on the matching node in context B.
- **Manual**: drag-drop in A; B's view re-renders without losing presence dots or scroll position.

## Phase 4 — Long-tail editors

Apply the Phase 1 pattern surface-by-surface. Each surface ships its own PR including save-button removal.

### Work order — serial vs parallel

Sequenced by editing frequency, not by dependency — these surfaces are independent of each other and can be reordered or parallelized across hands:

1. `src/app/(authed)/inspection/storylines/storylines-editor.tsx`
2. `src/app/(authed)/inspection/actions/editor.tsx` (likely subsumed by Phase 1's `patchAction`; spot-check)
3. `src/app/(authed)/sorting/letters/sorting-letters-editor.tsx` + `src/app/(authed)/sorting/rules/...`
4. `src/app/(authed)/cities/cities-editor.tsx`, `citizens-editor.tsx`, `nations`, `playthroughs`, `physical`, `days`
5. `src/app/(authed)/endings/variables/variables-editor.tsx`

### Phase 4b — Endings document editors

`src/app/(authed)/endings/_shared/document-editor.tsx` (used by frameworks + logic) is a structurally nested ordered-block document. Likely tractable with LWW per-block + structural ops via narrow actions, but warrants a fresh design pass before starting. **Action:** open a follow-up plan `docs/endings-collab-plan.md` once Phase 1 lands and we know what we learned.

### Final cleanup PR

After every surface is converted: delete `src/components/auto-save-form.tsx`, the `useUnsavedDialog` hook in `src/components/unsaved-dialog.tsx`, and the duplicated copy in `src/components/panel.tsx`. Add a guard test (or grep in CI) that asserts these symbols have no remaining imports.

### Tests (per surface)

- Keep that surface's existing unit/integration tests green.
- Add **one regression spec per surface**: open with two contexts, edit one field, verify reflection in the other (lightweight — uses the realtime layer that's already proven).

## Critical files

- `supabase/migrations/0031_realtime_publication.sql` *(new, Phase 0)*
- `src/lib/realtime/*` *(new, Phase 0)*
- `src/app/(authed)/inspection/letters/workspace.tsx` *(Phase 1 rewrite; row types from `src/lib/db/types.ts`)*
- `src/app/(authed)/inspection/letters/actions.ts` *(Phase 1: add `patch*`; existing coarse actions remain — see lines 119–408)*
- `src/app/(authed)/graph/graph-surface.tsx` *(Phase 1 cleanup + Phase 3 presence)*
- `src/components/app-shell.tsx` *(Phase 2 avatar stack)*
- `src/lib/supabase/client.ts` *(unchanged — browser client used as-is for channels)*

## Reused primitives

- Supabase browser client at `src/lib/supabase/client.ts` (channels live here).
- `updated_at` triggers already present on every editable table (`supabase/migrations/0001_init.sql:13-19,194`) — kept for future explicit-conflict path; no schema change needed.
- Existing display-id views (`inspection_letters_view`, `report_segments_view`, etc.) — not touched; realtime fires on the base tables and the workspace re-derives display IDs as today.
- `revalidatePath` left in place for structural actions only.

## Cross-phase verification

- `pnpm typecheck` and `pnpm lint` clean at end of every phase.
- `pnpm test` clean (each phase's new unit tests above).
- `pnpm test:e2e` clean (Phase 1 onwards adds `realtime-letters.spec.ts`; Phase 3 may add `realtime-graph.spec.ts`).
- Manual two-profile smoke (Chrome + Chrome Incognito with two accounts) at end of every phase covering the phase's smoke-check scenario.
- Status log lives in `docs/multi-user-collab-plan.md` (this file) — append a `## Status` section as phases land, same shape as `docs/inspection-letters-plan.md` / `docs/narrative-graph-plan.md`.

## Open risks to revisit during implementation

- `replica identity full` on `inspection_letters` (long markdown columns) bloats WAL. Acceptable at team size; flag if Supabase usage spikes.
- Realtime presence over broadcast uses the anon key and exposes peer emails. Already team-trusted — explicit nod, not a blocker.
- Action-row reorder/add/delete during another user's edit needs strict id-keyed reducers (covered by Phase 1's reducer unit tests).
- Phase 0's `replica identity full` is applied via the migration; if production DB rejects (e.g., no superuser), fall back to default identity + accept that delete payloads will lack column values (toast wording still works since we know the id).

## Status (2026-05-12)

### ✅ Phase 0 — Realtime primitives
- Migration `supabase/migrations/0031_realtime_publication.sql` applied to remote Supabase project (`qleuihyqfpnectqcqagx`) via the MCP `apply_migration`. Tables `inspection_letters`, `letter_groups`, `actions`, `report_segments`, `storylines` are in `supabase_realtime` with `replica identity full`.
- `src/lib/realtime/channel.ts` — `useRealtimeChannel`. Returns `{ channel, subscribed }`. `subscribed` flips true once the channel reaches `SUBSCRIBED`; needed because Supabase silently drops pre-subscribe `track()` updates.
- `src/lib/realtime/presence.ts` — `usePresence`. **Identity** (userId + email) goes through `channel.track()`; **focus** goes through a `presence-focus` broadcast event since Phoenix Presence accumulates `metas` arrays on each track-update and stops fanning out repeat payloads. Re-broadcasts focus on every presence sync so late-joining peers see existing focus state.
- `src/lib/realtime/use-instant-field.ts` — `useInstantField({ value, onCommit, debounceMs=400, equals?, onFocusChange? })`. Pure `instantFieldReducer` exported. LWW merge rule: drops remote when status is `dirty|saving`, applies on `idle|error`. Blur flushes pending debounce immediately.
- `src/lib/realtime/{field-presence,record-presence,avatar-stack}.tsx` — UI atoms.
- `src/lib/realtime/presence-context.tsx` — `WorkspacePresenceProvider` + `usePresenceContext()`. No-op fallback when `userId`/`email` are absent (used by the graph embed pre-Track-D).
- 26 vitest unit tests pass across `use-instant-field.test.ts` and `presence.test.ts`.
- Smoke harness at `src/app/(authed)/settings/realtime-smoke.tsx` confirmed identity + focus + dirty/saving status across two browser profiles. (Marked for deletion in the final Phase 1 cleanup task.)

### ✅ Phase 1 Track A — Narrow patch actions
- `src/app/(authed)/inspection/letters/actions.ts` gained `patchInspectionLetter`, `patchLetterGroup`, `patchAction`, `patchReportSegment`, and `patchActionEndingAssignments`. None call `revalidatePath` — realtime fans out. Coarse `saveLetterWithActions` / `saveLetterFields` / `saveLetterActionsOnly` / `saveGroup` / `saveReportSegment` kept for compat; will be removed in B6 once unreachable.

### ✅ Phase 1 Track B1 — Workspace presence wiring
- `LettersWorkspace` is now a thin wrapper that mounts `WorkspacePresenceProvider` (channel name `letters-workspace`). Existing body renamed to `LettersWorkspaceInner`.
- `src/app/(authed)/inspection/letters/page.tsx` fetches `auth.getUser()` and passes `currentUserId` / `currentEmail` to the workspace. Graph embed callsite still unset — picked up in Track D.
- `<AvatarStack>` mounted at the right edge of the breadcrumb in uncontrolled mode; floats top-right when `forceNarrow`/controlled (graph) mode.

### ✅ Phase 1 Track B2 — Letter-group panel
- 3 `useInstantField` hooks at top of `LettersWorkspaceInner` for `name`, `delivery_day_id`, `notes`. Each commits via `patchLetterGroup`. `value` props use server-row `group?.X` (not local `groupState.X` — see Track B3 lesson below).
- Each input's `onChange` calls both legacy `updateGroup` (for OTHER readers of `groupState`, e.g. nested panels) AND `field.set` (auto-save).
- `<FieldPresence>` next to each label. `DaySelect` wrapped in `<div onFocus onBlur>` for focus event bubbling (the component doesn't accept focus props).
- `setGroupDirty(true)` removed from `updateGroup`. `<SaveRevert>` removed from the group panel header. (Inner letter-reorder SaveRevert kept — drag-reorder is a structural mutation, stays on the manual save path.)

### ✅ Phase 1 Track B3 — Letter + action panels
- **LetterFieldsCard:** 6 `useInstantField` hooks (`delivery_day_override_id`, `summary`, `sender_citizen_id`, `receiver_citizen_id`, `content`, `notes`) committing via `patchInspectionLetter`. Card receives `key={letterState.id}` so it remounts on letter switch (pending debounce timers reset). `<SaveRevert>` removed. `LastUpdatedFooter` hidden when any peer has the record focused.
- **LetterActionsCard:** parent-level `scheduleActionPatch(actionId, patch)` accumulates per-action patches in a `Map<actionId, partial>` + per-action timers; flushes after 400 ms. Narrow column fields go through `patchAction`, `ending_assignments` go through `patchActionEndingAssignments`. `<SaveRevert>` removed from the card header — all action fields auto-save uniformly.
- **ActionEditor:** wrapped in `onFocus`/`onBlur` using `wrapper.contains(e.relatedTarget)` to detect "focus left the action", broadcasting action-level focus. `<FieldPresence>` next to each action's name.
- `updateLetter` no longer sets `letterDirty(true)`; `updateAction` no longer special-cases `ending_assignments`.

**Track B3 lesson (locked in):** `useInstantField`'s `value` prop MUST be the canonical server value (row from props), NOT a parent-managed local-edit state. If the parent's `state.X` is updated synchronously on each keystroke and passed as `value`, the hook's `commitNow` equality check (`localValue === valueRef.current`) short-circuits the patch because both are the user's typed value. First broken in B3, found via "letter fields not saving" smoke; fixed by switching to `letterView.X`. Group panel was already correct because it used `group?.X` (the row from `allGroups.find()`).

### ✅ Phase 1 Track B4 — Report-segment panel
- `LetterSegmentCard` has 4 `useInstantField` hooks for `variant`, `delivery_day_override_id`, `summary`, `content`, each committing via `patchReportSegment`. `value` props use `segment?.X` (server row) — matches the B3 lesson. `<FieldPresence>` next to each label. `DaySelect` + `MarkdownTextarea` wrapped in `<div onFocus onBlur>` for focus event bubbling.
- Card no longer owns `useState`/`useEffect`/`useTransition`/dirty/saveNow — input values come straight from `field.value`. `<SaveRevert>` removed from header. `LastUpdatedFooter` hidden when any peer focuses the segment.
- Both callsites use `key={selectedSegmentId}` for clean unmount on segment switch (was `key={`group-${selectedSegmentId}`}` in slot 3; slot 5 was already correct).
- `closeSegmentPanel()` and `jumpToTrigger(letterId)` simplified to drop the `(dirty, onSave)` args and the now-unreachable `askUnsaved` branch. Card prop types narrowed to `onBack: () => void` and `onJumpToTrigger: (letterId: string) => void`.
- `saveReportSegment` import removed from `workspace.tsx` (server action kept in `actions.ts` for B6 sweep). `pnpm typecheck` clean. `pnpm lint` unchanged net-of-pre-existing-errors (workspace.tsx lint counts dropped by 1 warning).

### ✅ Phase 1 Track B5 — Postgres_changes reducer + remote-delete toast
- `WorkspacePresenceProvider` gained a `postgresTables` prop and exposes `onPostgresChanges(handler)` via `usePresenceContext()`. Handlers register into a Set on the active provider; the inactive (no-user) fallback returns a no-op register. One shared `letters-workspace` channel still hosts presence + focus + postgres_changes.
- `LettersWorkspaceInner` mirrors `storylines` / `allGroups` / `allLetters` / `allActions` / `allSegments` via `useState` seeded from props, using the "adjust state during render" pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes) so structural revalidates resync the mirrors back to canonical truth without a cascading-render eslint hit.
- Single postgres handler registered in a useEffect. UPDATE → column-merge `{ ...prevRow, ...payload.new }` by id, preserving view-derived columns (`content_id`, `effective_day_id`, etc.) that aren't in the base-table payload. DELETE → drop the row from the mirror and, if it matches the currently-selected group/letter/segment, close that panel + emit a destructive toast attributing the action to `payload.old.updated_by`. INSERT → debounced `router.refresh()` (100 ms) so the RSC layer re-derives view-mapped columns; debounce coalesces burst inserts (e.g. a create-action that inserts a group + letter + actions in one transaction).
- **Flush-on-unmount in `useInstantField`** — the cleanup `useEffect` now calls `commitNow()` when status is `dirty` before clearing the timer. The captured `onCommit` closure still references the unmounting row's id, so a typed-then-quick-switch edit lands on the right row instead of being dropped. Closes the gap noted in B2/B3/B4.
- New in-tree `useToast()` hook + `Toaster` at `src/components/toast.tsx` — matches the `useConfirm` pattern (returns `{ toast, toaster }`), stacks ≤5 entries top-right, auto-dismiss after 4s, dark control-room aesthetic. No new dependency.
- `pnpm typecheck` clean; `pnpm lint` net-improved (173 problems vs. 178 pre-B5; no new errors introduced).

### ⬜ Remaining tracks

- **B6 — Rip dirty-state machinery:** delete `groupDirty`, `letterDirty`, `actionsDirty`, `storylineDirty`, `dirtyKind`, `saveAllRef`, `onDirtyChange`, `askUnsaved`/`useUnsavedDialog`, and now-dead handlers (`handleSaveGroup`, `handleSaveLetterFields`, `handleSaveActions`, `revertGroup`, `revertLetter`, `saveAllNow`). Drop the coarse `saveGroup`/`saveLetterFields`/`saveLetterActionsOnly`/`saveLetterWithActions` imports + server actions if no callers remain. **Note:** storyline inspector still uses its own internal dirty state; treat as a separate later conversion (Phase 4 long-tail) unless ripping it here is cheap.
- **D — Graph-surface cleanup:** drop `saveAllRef`/`inspectorDirtyKind`/unsaved-prompt-on-drag from `src/app/(authed)/graph/graph-surface.tsx`. Thread `currentUserId` + `currentEmail` through `<LettersWorkspace>` so presence works inside the graph too.
- **C — E2E spec** (`tests/e2e/realtime-letters.spec.ts`): two-context Playwright covering type→appear, focus→indicator, remote-delete toast, two-users-different-fields-no-clobber. Scaffold in parallel with B; finalize once B5 lands.
- **Cleanup — `/settings` smoke harness:** delete `realtime-smoke.tsx` + its mount in `settings/page.tsx`.

### Open follow-ups noted along the way

- ~~**Typed-then-quick-switch edit loss.**~~ Closed in B5: `useInstantField`'s unmount cleanup now flushes via `commitNow()` when status is `dirty`, so the captured `onCommit` closure lands the edit on the unmounting row's id.
- **Action-level focus broadcast on impact tile clicks.** Tile clicks are buttons; `onFocus`/`onBlur` on the action wrapper handles entry/exit, but tile clicks themselves don't currently set focus on the tile. Acceptable since the wrapper already broadcasts. Revisit if peers want per-tile granularity.
- **Realtime publication on `inspection_action_ending_assignments`.** Not in the publication; `patchActionEndingAssignments` writes succeed but won't fan out to other clients via postgres_changes. Lower priority (ending assignments change less often than impacts/content). Followup needs a migration to add the table to `supabase_realtime` + a workspace handler that re-derives the action's `endingAssignments` from the child rows. Deferred to its own small PR after B6.
- ~~**Postgres INSERT events.**~~ Closed in B5 follow-up: INSERT triggers a debounced `router.refresh()` (100 ms coalesce window). Adds one RSC refetch per burst of inserts but keeps view-mapped columns correct without duplicating SQL view logic in JS.
- **Storylines mirror is partial.** B5 mirrors the `storylines` array for UPDATE/DELETE on `letters-workspace`, but storyline edits actually happen on `/inspection/storylines`. Once that surface converts (Phase 4 long-tail #1), revisit whether the workspace mirror still adds value.
