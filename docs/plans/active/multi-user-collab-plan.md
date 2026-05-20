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
- Status log lives in `docs/plans/active/multi-user-collab-plan.md` (this file) — append a `## Status` section as phases land, same shape as `docs/plans/archive/inspection-letters-plan.md` / `docs/plans/active/narrative-graph-plan.md`.

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

**B5 lesson #1 (locked in):** `router.refresh()` called from inside a non-React callback (postgres event handler) **must** be wrapped in `startTransition`. Without the wrap, Next 16's scheduler coalesces it away before the route invalidates — peer B sees no new rows until they manually refresh or navigate. Diagnosed via console logs: the call fired but no RSC refetch followed. With `startTransition`, the refresh lands as concurrent work and the route re-fetches as expected.

**B5 lesson #2 (locked in):** When a create-action server response selects only the new row's id, the brief window between `setSelectedGroupId(newId)` and the RSC refetch arriving leaves the panel deriving `group = allGroups.find(g => g.id === newId)` as `null` → slot 1 + slot 2 render null = visually blank panels. Fix: have the create action `select("*").single()` and return the full row; the caller seeds the mirror via `setAllGroups((prev) => [...prev, created])` **before** calling `selectGroup(created.id)`. The subsequent `revalidatePath` / `router.refresh` reseed idempotently. Applied to `createLetterGroupInStoryline`; other create paths (`createInspectionLettersInGroup`, `addActionFromTemplate`, `createReportSegmentForGroup`, `createLetterInNextGroup`) did NOT exhibit the same gap in testing — their selection paths happen to keep enough surrounding state stable that the missing row isn't visible. Apply the same pattern proactively only when a specific surface complains.
- **Flush-on-unmount in `useInstantField`** — the cleanup `useEffect` now calls `commitNow()` when status is `dirty` before clearing the timer. The captured `onCommit` closure still references the unmounting row's id, so a typed-then-quick-switch edit lands on the right row instead of being dropped. Closes the gap noted in B2/B3/B4.
- New in-tree `useToast()` hook + `Toaster` at `src/components/toast.tsx` — matches the `useConfirm` pattern (returns `{ toast, toaster }`), stacks ≤5 entries top-right, auto-dismiss after 4s, dark control-room aesthetic. No new dependency.
- `pnpm typecheck` clean; `pnpm lint` net-improved (173 problems vs. 178 pre-B5; no new errors introduced).

### ✅ Phase 1 Track B6 — Rip dirty-state machinery
- Removed from `workspace.tsx`: `groupDirty` / `letterDirty` / `actionsDirty` / `storylineDirty` / `dirtyKind` / `anyLetterDirty`, plus their `useTransition` partners (`groupPending` / `letterPending` / `actionsPending`). Only `rowPending` survives.
- Deleted handlers: `handleSaveGroup`, `handleSaveLetterFields`, `handleSaveActions`, `revertGroup`, `revertLetter`, `revertActions`, `saveLetterNow`, `saveAllNow`, `confirmDiscardDirty`, `onConfirmDiscard`, plus `letterFieldsPatch` / `letterActionsPatches` helpers.
- Dropped props from `LettersWorkspaceProps`: `onDirtyChange`, `saveAllRef`. The graph embed no longer threads them.
- Removed `useUnsavedDialog` + `unsavedDialogEl` + `askUnsaved` everywhere — instant-save means there's nothing to prompt about.
- `LetterFieldsCard` + `LetterActionsCard` lost `dirty` / `pending` / `onSave` / `onRevert` props.
- `StorylineInspector` now tracks its own dirty state locally — parent no longer mirrors it. (Phase 4 long-tail will convert it to instant-save and drop the flag entirely.)
- `graph-surface.tsx` cleanup (the Track D workspace-coupled half): dropped `inspectorDirtyKind`, `saveAllRef`, `useUnsavedDialog`, `resolveUnsavedDirty`, the beforeunload guard, and the link-click navigation interceptor. All inspector edits auto-save, so navigation no longer needs a gate. (Track D's remaining piece — threading `currentUserId` / `currentEmail` into the embed — stays open.)
- Dropped coarse server actions from `actions.ts`: `saveGroup`, `saveLetterFields`, `saveLetterActionsOnly`, `saveLetterWithActions`, `saveReportSegment`, plus their `LetterPatch` / `ActionPatch` types. The `saveGroup` test cases in `actions.test.ts` deleted too.
- Deleted `/settings/realtime-smoke.tsx` + its mount in `settings/page.tsx` (Phase 0 throwaway).
- `pnpm typecheck` clean. `pnpm test` clean (297 tests). `pnpm lint` net-improved (158 problems vs. 173 pre-B6).

### ✅ Phase 1 Track D — Graph presence threading
- `/graph`'s page server-fetches `auth.getUser()` and threads `currentUserId` + `currentEmail` through `GraphSurface` into the embedded `<LettersWorkspace>`. The workspace's `WorkspacePresenceProvider` activates instead of falling through to the no-op fallback, so realtime + presence work identically in the graph inspector.

### ⬜ Remaining tracks

- **C — E2E spec** (`tests/e2e/realtime-letters.spec.ts`): two-context Playwright covering type→appear, focus→indicator, remote-delete toast, two-users-different-fields-no-clobber. Scaffold in parallel with B; finalize once B5 lands.

### Open follow-ups noted along the way

- ~~**Typed-then-quick-switch edit loss.**~~ Closed in B5: `useInstantField`'s unmount cleanup now flushes via `commitNow()` when status is `dirty`, so the captured `onCommit` closure lands the edit on the unmounting row's id.
- **Action-level focus broadcast on impact tile clicks.** Tile clicks are buttons; `onFocus`/`onBlur` on the action wrapper handles entry/exit, but tile clicks themselves don't currently set focus on the tile. Acceptable since the wrapper already broadcasts. Revisit if peers want per-tile granularity.
- **Realtime publication on `inspection_action_ending_assignments`.** Not in the publication; `patchActionEndingAssignments` writes succeed but won't fan out to other clients via postgres_changes. Lower priority (ending assignments change less often than impacts/content). Followup needs a migration to add the table to `supabase_realtime` + a workspace handler that re-derives the action's `endingAssignments` from the child rows. Deferred to its own small PR after B6.
- ~~**Postgres INSERT events.**~~ Closed in B5 follow-up: INSERT triggers a debounced `router.refresh()` (100 ms coalesce window). Adds one RSC refetch per burst of inserts but keeps view-mapped columns correct without duplicating SQL view logic in JS.
- **Storylines mirror is partial.** B5 mirrors the `storylines` array for UPDATE/DELETE on `letters-workspace`, but storyline edits actually happen on `/inspection/storylines`. Once that surface converts (Phase 4 long-tail #1), revisit whether the workspace mirror still adds value.

### ✅ Presence-indicator polish (post-B6) — 2026-05-12

All five follow-ups shipped on `multi-user-collab-instant-save`. Foundation
came first: a separate `peer-selection` broadcast event (parallel to
`presence-focus`) plus a lightweight `presence-activity` heartbeat. Peer
state now carries `selection` + `lastActiveAt` alongside `focus`. Both
broadcasts are also re-emitted on `onPresenceSync` so late joiners get
synced without waiting for the local user to re-select / re-focus.

- **Hover popup with peer's location.** `AvatarStack` accepts a
  `peerLocations: Map<userId, string>` built in the workspace from the live
  data mirrors. Lookup rule: peer's `focus.recordId` resolved against the
  matching mirror (e.g. `inspection_letters` → `Letter ${content_id}`,
  `letter_groups` → `Group ${storyline.abbreviation}${sequence}`), falling
  back to the deepest non-null entity in `peer.selection`. No match →
  "Idle".
- **Click avatar → jump.** Workspace passes `onAvatarClick={jumpToPeer}` —
  applies the peer's selection chain via the same `applyingPanelSnapshot`
  guard used by mouse-back/forward, so the bubble-up effect doesn't loop.
- **Mute peers not on same panel.** `sharesPanel(self, peer, narrow)`
  intersects the four ids `{storyline, group, letter, segment}` across
  both chains; empty intersection → `opacity-50` only (no grayscale,
  deliberately distinct from inactive mute). In narrow mode (slide-one-
  panel-at-a-time layout) the full intersection is misleading — a peer
  could have a group + letter loaded but only the letter is on screen,
  so we collapse to `visibleRecordId(selection.view)` and compare just
  that. Workspace threads `narrow` into `AvatarStack`.
- **Mute inactive peers.** 120s hardcoded threshold. `lastActiveAt` is
  bucketed to 5s in `usePresence` to bound state churn during sustained
  typing — combined with a 5s `setInterval` inside `AvatarStack` that
  re-renders the mute boundary, the inactive flip is precise to ~5s
  without re-renders mid-bucket. Inactive style = `opacity-50 grayscale`.
- **Field-edit highlight border.** New `<FieldHighlight>` wrapper renders
  an outset `box-shadow: 0 0 0 2px ${peer.color}` ring around the wrapped
  input when any peer's focus matches its `focusKey`. Replaces every
  `<FieldPresence>` dot site (group / letter / segment / action sub-fields
  for next letter + report segment). The dot component is deleted; header
  avatars carry identity now.

#### Locked-in lessons

**Lesson #1 — Separate broadcast events, not a single fattened focus
payload.** Focus changes on every keystroke-burst boundary; selection
changes when the user picks a panel; activity heartbeats fire 1Hz during
sustained typing. Folding them into one event would have either dropped
late-coalesced selections or churned the focus path. Mirror the existing
`presence-focus` pattern (broadcast on change, re-broadcast on sync, drop
on peer leave) once per signal.

**Lesson #2 — Bucket `lastActiveAt` to bound state churn.** A
state-stored `lastActiveAt` updated on every received broadcast would
churn `peers` array identity at 1Hz during sustained typing, forcing
all consumers (including the 6000-line workspace) to re-render. Bucketing
to 5s collapses that to one identity change per peer per 5s. The 5s
AvatarStack interval covers the mute-boundary flip independently.

**Lesson #3 — `data-focus-field` on `FieldHighlight` doubles as a
sub-field marker.** The action editor still uses a single bubbled
`onFocus` on the wrapper (avoids threading explicit handlers through
PillSelect, ImpactTile, etc.), but resolves *which* sub-field via
`target.closest("[data-focus-field]")`. The data attribute is stamped by
`FieldHighlight` automatically from its `focusKey`, so consumers don't
need to remember it. Sub-fields without a marker fall through to the
generic `"editing"` field key, which is harmless.

**Lesson #4 — Refs assigned via `useEffect` are fine for async-only
read sites.** `selfSelectionRef` is read only inside the realtime
channel's `onPresenceSync` callback, which is async — so the effect-
settled value is always current. Avoids the `react-hooks/refs` lint
violation that the older direct-assignment pattern (`selfFocusRef.current
= self.focus`) trips. Pre-existing direct assignments left untouched
(not my code to fix).

**Lesson #6 — Bundle stable identity (incl. profile) into `track()`,
not a separate broadcast.** When forward-compatting the display
name / avatar icon / avatar color from `user_metadata` post-merge,
the cleanest place to put the `PresenceProfile` payload was right next
to userId/email in `channel.track()`. Both are session-stable; both
need to reach every late-joining peer without an explicit re-broadcast
(presence sync handles that for free). A separate `presence-profile`
event would have meant either (a) re-broadcasting on every sync, doubling
the work the existing presence layer already does, or (b) introducing
a window where a peer is visible but un-avatared. Phoenix Presence's
"last metas entry per key" semantics make `track()` updates idempotent,
so bundling is also safe across re-tracks.

**Lesson #5 — Realtime needs auth attached BEFORE
`channel.subscribe()`.** Postgres_changes are RLS-gated server-side, so
the channel needs the user's JWT on the `phx_join`. Without it, the
channel joins fine for broadcasts but the server silently denies the
postgres_changes subscription. The user-visible signature is a
distinctive "focus rings work but content updates don't propagate until
refresh." Two preconditions: (a) `createSupabaseBrowserClient()` must be
a **singleton** — creating a fresh client per channel mount resets the
embedded realtime client's `accessToken`; (b) `useRealtimeChannel` must
`await supabase.auth.getSession()` and call
`supabase.realtime.setAuth(token)` **before** `ch.subscribe()`, since
the auth session restores from cookies asynchronously and the channel
can otherwise race ahead of it. Both fixes ship together; either alone
is insufficient. (`localStorage.debug_presence = "1"` enables console
logs at the channel + workspace layers to verify.)

#### Open follow-ups

- **StorylineInspector + Phase 4 long-tail conversions.** The storyline
  inspector embedded in the LettersWorkspace's slot 1 still uses the
  pre-instant-save dirty-state machinery (it tracks its own dirty flag
  locally — parent doesn't mirror). Same for the `/inspection/storylines`
  editor and the other Phase 4 surfaces (`actions`, `sorting`, `cities`,
  `citizens`, `nations`, `playthroughs`, `physical`, `days`, ending
  variables, endings documents). Each ships as its own PR.

### ✅ Phase 2 — App-wide presence affordances (2026-05-13)

The original plan had two bullets; the polish round before Phase 2 collapsed
them to one. `<RecordPresence>` dots on list rows are obsolete (the dot
component was deleted in the polish round — `<FieldHighlight>` + header
avatars carry that signal now). What remained: the global avatar stack.

- New `src/components/app-presence.tsx` — client component that subscribes
  to a dedicated `app-presence` channel, separate from the per-surface
  channels (`letters-workspace`, `graph`). Tracks
  `{ userId, email, profile, surface: pathname }` and re-tracks on every
  pathname change. No focus / selection / activity broadcasts — surface
  presence alone is the signal "this peer is online", which keeps the
  global channel light.
- `src/components/app-shell.tsx` — header now renders whenever the local
  user is authed (was: only when an active playthrough exists). Right
  side gains the AppPresence avatar stack alongside the (still-conditional)
  VariableHud. AppShell is async-server; it builds the `presenceUser`
  payload from `auth.getUser()` + `profileFromMetadata` and passes it
  to the client component.
- Cross-surface jump: clicking a peer's avatar runs
  `router.push(peer.surface)`. No-op when the peer is on the same surface.
  Hover popup uses a small `surfaceLabel(pathname)` map — duplicated from
  `NAV_ITEMS` rather than imported to avoid a client-bundle coupling on a
  "use client" module-scoped const. Update both when adding new routes.
- Self avatar always shown (matches the per-surface stack convention).
  `lastActiveAt: 0` for `self` because `AvatarStack` doesn't apply the
  inactive-mute path to the self slot — using `Date.now()` here would
  trip the `react-hooks/purity` lint.
- Coexists with the per-surface stacks on `/inspection/letters` and
  `/graph`. The two convey different information: app-shell shows
  "everyone online anywhere"; per-surface shows "who's editing what
  HERE" with field-level focus rings. Some redundancy on those two
  routes is acceptable; if it gets noisy we can hide the per-surface
  stack when the app-shell stack is present.
- `pnpm typecheck` clean. `pnpm lint` net-neutral (158 problems pre/post).
  `pnpm test` clean (310 tests).

#### Open follow-ups (Phase 2 → Phase 3 / cleanup)

- **Phase 3 — Graph node-dot overlay.** Per-node presence dots on each
  xyflow node whose `recordId` matches a peer's `focus.recordId`.
  Untouched by Phase 2.
- **`surfaceLabel` drift.** The route → label map in `app-presence.tsx`
  duplicates `NAV_ITEMS`. Tolerable for now; revisit if routes start
  changing more often (e.g. hoist `NAV_ITEMS` into a shared
  non-client module).

### ✅ Phase 4 Storylines (2026-05-13)

Three deliverables shipped in one PR.

#### 1. StorylineInspector (workspace.tsx slot 1)

- Removed `dirty` / `pending` / `startSave` / `saveNow` / `revert` / `onConfirmDialog`-for-revert from `StorylineInspector`.
- Removed `SaveRevert` from the panel header (and deleted the now-unused `SaveRevert` component entirely since it had no other callers; `IconRestore` import cleaned up too).
- Replaced `update("name", …)` / `update("abbreviation", …)` / `update("description", …)` with `useInstantField` hooks bound to `patchStoryline` — 3 text hooks + 1 compound `iconColorField` (icon type, icon value, color hex patched together since the picker emits all three simultaneously).
- Local `state` object kept for display so the icon picker can update all three fields before the hook sees them; `nameField.value`, `abbrField.value`, `descriptionField.value` drive their inputs instead of `state.X` (B3 lesson: must use server-row, not parent mirror). State also syncs via a `useEffect` on `storyline.id` for cross-selection resets.
- Each input wrapped in `<FieldHighlight>`. The icon picker button wrapped in `<div onFocus onBlur>` for event bubbling (same as DaySelect pattern in B2).
- `usePresenceContext()` called inside `StorylineInspector`; the parent `WorkspacePresenceProvider` is already wired so nothing extra needed at the outer layer.

#### 2. patchStoryline server action

- Added `patchStoryline(id, patch)` to `src/app/(authed)/inspection/storylines/actions.ts`. Does NOT call `revalidatePath` — realtime fans out. The `StorylinePatchFields` type covers all user-editable columns (`name`, `abbreviation`, `description`, `icon_type`, `icon_value`, `color_hex`).
- Added `reorderStorylines(ids)` to write `sort_order` for drag-reorder (structural mutation, keeps `revalidatePath`).
- The old `updateStorylineFields` and `updateAllStorylines` are kept for compat; they'll be removed in the final Phase 4 cleanup PR once every caller is converted.

#### 3. Standalone storylines editor

- `src/app/(authed)/inspection/storylines/storylines-editor.tsx` rewritten:
  - `StorylinesEditor` (outer shell) mounts `WorkspacePresenceProvider` on channel `storylines-editor`, subscribed to the `storylines` postgres table.
  - `StorylinesEditorInner` mirrors rows via "adjust state during render", subscribes to `onPostgresChanges` for UPDATE/DELETE fan-out without page reload.
  - `StorylineRow` sub-component owns its own `useInstantField` hooks per field (name, abbreviation, description, icon+color). `key={row.id}` at the call site ensures hooks remount + debounce timers reset when a row takes a new slot after reorder.
  - Drag-reorder is a structural mutation: `reorderStorylines(ids)` writes `sort_order`; "Save order" / "Cancel" buttons appear only when `orderDirty`.
  - `<AvatarStack>` rendered in the header (right side), showing all peers on the `storylines-editor` channel.
  - `<FieldHighlight>` wraps every field in every row.
- `src/app/(authed)/inspection/storylines/page.tsx` updated to fetch `auth.getUser()` + `profileFromMetadata` and pass `currentUserId` / `currentEmail` / `currentProfile` down to `StorylinesEditor`.

**Codex review fix:** added INSERT branch with debounced startTransition refresh, matching the workspace.tsx pattern. The empty INSERT handler in `StorylinesEditorInner` was replaced with a `scheduleRefresh()` call backed by a 100 ms debounce timer (cleared on unmount) and `startTransition(() => router.refresh())` — without the `startTransition` wrap Next 16 coalesces the refresh away before it can invalidate the route.

#### Spot-check: `src/app/(authed)/inspection/actions/editor.tsx`

This is `ActionTemplatesEditor` — a bulk drag-reorder editor for *action template* rows (name, icon, color, paired template), saving all rows at once via `updateAllActionTemplates`. It is NOT the per-letter `patchAction` surface from Phase 1. It has no connection to `patchAction` and its dirty+Save pattern is appropriate for bulk drag-reorder (same rationale as the storylines reorder). **No conversion needed.**

#### Metrics

- `pnpm typecheck` — clean
- `pnpm lint` — 40 problems (19 errors, 21 warnings) vs. 42 baseline (net improved by 2)
- `pnpm test` — 309/309 pass (unchanged)

#### Locked-in lessons

**Lesson — Compound fields (icon + color) need a compound instant-save hook.** The `IconPicker` emits `icon_type`, `icon_value`, and `color_hex` together in a single `onChange`. Splitting them into three separate `useInstantField` hooks would require the parent to merge them before committing, and each keystroke on the color input would fire three separate patches. The cleaner model: one hook with a compound value type + a custom `equals` predicate, and a single `patchStoryline` call that carries all three. Downstream: the compound field's `value=` must still be the canonical server-row (three separate `row.X` properties) rather than the local `iconState` mirror, per the B3 rule.

**Lesson — `StorylineRow` sub-component is the right hook scope boundary.** Putting `useInstantField` hooks at the list level (in `StorylinesEditorInner`) would require either one hook per row × per field (unbounded array of hooks, violates rules of hooks for dynamic lists), or coalescing patches in a Map (the `scheduleActionPatch` pattern from B3 LetterActionsCard). Extracting `StorylineRow` as a component solves this cleanly: hooks are per-row, `key={row.id}` handles remount/timer-reset on reorder.

#### Open follow-ups

- **Remaining Phase 4 surfaces.** Sorting letters/rules, cities, citizens, nations, playthroughs, physical, days, ending variables. Each ships as its own PR.
- **Phase 4b — Endings documents.** Pending design pass (`docs/endings-collab-plan.md`).
- **Final cleanup PR.** Delete `updateAllStorylines`, `updateStorylineFields` once every caller is converted; delete `auto-save-form.tsx`, `unsaved-dialog.tsx` once all surfaces are converted.

### ✅ Phase 4 Sorting (2026-05-13)

Converted `/sorting/letters` and `/sorting/rules` to instant-save + multi-user
presence following the Phase 1 pattern exactly.

#### Files changed

- `supabase/migrations/0034_realtime_publication_sorting.sql` *(new)* —
  Adds `sorting_letters`, `sorting_rules`, `sorting_rule_conditions` to
  `supabase_realtime` with `replica identity full`. Idempotent (same guard
  as 0031/0032).
- `src/app/(authed)/sorting/letters/actions.ts` *(edit)* — Added
  `patchSortingLetter(id, patch)`. Does NOT call `revalidatePath`.
  Existing coarse actions (`createSortingLetter`, `updateSortingLetter`,
  `updateAllSortingLetters`, `deleteSortingLetter`) kept for compat.
- `src/app/(authed)/sorting/letters/page.tsx` *(edit)* — Now fetches
  `auth.getUser()`, builds `presenceProfile`, passes `currentUserId` /
  `currentEmail` / `currentProfile` to `SortingLettersEditor`.
- `src/app/(authed)/sorting/letters/sorting-letters-editor.tsx` *(rewrite)* —
  Split into `SortingLettersEditor` (outer, mounts `WorkspacePresenceProvider`
  on channel `sorting-letters`) + `SortingLettersEditorInner` (reads context).
  Per-row `SortingLetterRow` component uses `useInstantField` for `day_id`,
  `recipient_name`, `sender_name`, `is_counterfeit`, `storage_location`.
  `<FieldHighlight>` wraps every editable cell. `<AvatarStack>` in the filter
  bar header. `postgres_changes` reducer: UPDATE column-merges the mirror;
  DELETE drops the row + emits a destructive toast; INSERT debounce-refreshes
  via `router.refresh()` in `startTransition`. Removed: `dirty` flag,
  `useTransition` for save, `Save` button, bulk `updateAllSortingLetters` call
  on explicit save, the `<form>` wrapper, hidden form inputs.
- `src/app/(authed)/sorting/rules/actions.ts` *(edit)* — Added
  `patchSortingRule(id, patch)`. Does NOT call `revalidatePath`. Kept
  `saveRuleAll` (dead code, same compat-hold pattern as Phase 1). `saveConditions`
  kept as the structural condition replacement path (still calls `revalidatePath`
  because conditions are delete+re-insert — not a field-level patch).
- `src/app/(authed)/sorting/rules/page.tsx` *(edit)* — Same auth/profile pattern.
- `src/app/(authed)/sorting/rules/rules-list.tsx` *(rewrite)* — Split into
  `RulesList` (outer, `WorkspacePresenceProvider` on channel `sorting-rules`) +
  `RulesListInner` (mirrors `rules` + `conditionsByRule`; `postgres_changes`
  handler; `<AvatarStack>`) + `RuleRow` (instant-save for `letter`,
  `destination_slot`, `day_implemented_id`, `storage_location`, `summary` via
  `patchSortingRule`; conditions still use explicit `saveConditions` + dirty
  button). `<FieldHighlight>` on every scalar field. `<div onFocus onBlur>`
  around the `Select` for `day_implemented_id` (doesn't forward focus props).

#### Design decisions

- **Conditions kept on manual save.** `sorting_rule_conditions` is a
  position-ordered set always replaced wholesale (delete+insert). Instant-save
  is not meaningful here — the user builds the full condition set before
  committing. The "Save conditions" button remains; only the scalar rule fields
  (`letter`, `slot`, `day`, `storage`, `summary`) are instant-save.
- **One channel per surface, not a combined channel.** `/sorting/letters` and
  `/sorting/rules` are distinct pages; they get separate channels
  (`sorting-letters`, `sorting-rules`) to avoid cross-surface noise.
- **`SortingLetterRow` as a separate component.** Each row needs its own
  `useInstantField` instances (5 per row), so the row must be its own React
  component. This matches the `ActionEditor` per-action pattern in
  `LettersWorkspaceInner`.

#### Follow-ups

- **User must apply migration 0034** via Supabase MCP (`apply_migration`) or
  the Supabase SQL editor before realtime fan-out works on sorting tables.
- **`updateAllSortingLetters` is now unreachable** from the list editor (the
  bulk form + Save button are gone). The action is kept for compat; remove in
  the final Phase 4 cleanup PR alongside `auto-save-form.tsx` etc.
- **`/sorting/letters/[id]` detail page** still uses a plain server-action
  form (`updateSortingLetter`). Not converted — it's a low-traffic detail
  view. Convert in a later cleanup pass if desired.
- **`saveRuleAll`** is now dead code in `rules/actions.ts`; remove in the
  final cleanup PR.

#### Locked-in lessons

- **Lesson from sorting** — Row-level components are the right boundary for
  `useInstantField` when the editor renders a variable-length list. Hoisting
  all hooks into the parent (one set per row × N rows) is not safe with
  React's rules-of-hooks. Extract a `<RowComponent key={row.id} row={row} />`
  and put the hooks there — the `key` prop ensures unmount-cleanup (flush) on
  row removal.

**Codex review fixes:**

- **`matchMode` stale-clobber on peer-only `match_mode` change.** `RuleRow`
  was syncing `matchMode` only when `condServerKey` (a hash of condition
  identity/order) changed. If a peer updated `match_mode` without touching
  conditions, the hash was unchanged, so the local state stayed at the old
  value and the next "Save conditions" from this user would write the stale
  mode back. Fixed with an additional "adjust state during render" pair
  `[lastSeenMatchMode, setLastSeenMatchMode]` that compares to `rule.match_mode`
  each render. Resync fires when the server value changes AND `condsDirty` is
  false — the `!condsDirty` guard ensures we don't clobber a user's
  in-progress edit: when `condsDirty=true` the user has already touched the
  condition block (which sets `matchMode` locally) and the resync is
  correctly suppressed. This is the right semantic because `matchMode` is part
  of the conditions block and its dirtiness is tracked by `condsDirty`.

- **Delete-toast attribution always "Someone".** The DELETE toast in both
  `sorting-letters-editor.tsx` and `rules-list.tsx` tried to read
  `oldRow.updated_by`, but `sorting_letters` and `sorting_rules` have no
  `updated_by` column (unlike `inspection_letters`). The lookup always fell
  back to `"Someone"`. Fixed by removing the dead lookup and hardcoding
  `"Someone deleted a sorting letter"` / `"Someone deleted a sorting rule"`.
  Adding an `updated_by` column would require a migration + trigger and is
  out of scope; the bare attribution is consistent with what the toast was
  always showing in practice.

### ✅ Phase 4 Reference data — cities / citizens / nations (2026-05-13)

Converted three reference-data editors to instant-save + multi-user collab
on branch `collab-reference-data-instant-save`.

#### What shipped

- **Migration** `supabase/migrations/0035_realtime_publication_reference_data.sql`
  — adds `cities`, `citizens`, `nations` to `supabase_realtime` with
  `replica identity full`. Matches 0031 style (idempotent via
  `pg_publication_tables` guard). User must apply to remote Supabase project
  (see follow-ups below). *(Renumbered from 0032 → 0035 to avoid collision with
  `0032_realtime_ending_assignments.sql` and `0033_ending_assignment_nullable_value.sql`
  on main, and `0034` reserved by the sibling sorting branch.)*

- **`src/app/(authed)/cities/`**
  - `patchCity(id, patch)` narrow server action (no `revalidatePath`).
  - `page.tsx` fetches `auth.getUser()` + `profileFromMetadata` and passes
    `currentUserId` / `currentEmail` / `currentProfile` to the editor.
  - `cities-editor.tsx` rewritten: `WorkspacePresenceProvider` (channel
    `cities-editor`), `AvatarStack` in toolbar, each `CityRow` owns
    `useInstantField` instances for `name` / `code` / `nation_id` with
    `FieldHighlight`. `postgres_changes` handler: UPDATE merges columns,
    DELETE removes row + toast, INSERT appends + `router.refresh()`. Save
    button and dirty-flag machinery removed.

- **`src/app/(authed)/citizens/`**
  - `patchCitizen(id, patch)` narrow server action (no `revalidatePath`).
  - Page wiring identical to cities pattern.
  - `citizens-editor.tsx` rewritten: 5 `useInstantField` hooks per row
    (`name` / `type` / `citizen_id` / `city_id` / `nation_id`). City→nation
    FK auto-fill preserved: when `city_id` changes the `city.nation_id` is
    propagated via `nationIdField.set()`; when `nation_id` changes incompatible
    cities are cleared via `cityIdField.set("")`. Both fields debounce
    independently and realtime echoes confirm the final values. The
    `availableCities` filter reads `nationIdField.value` (the hook's in-progress
    local value) so the dropdown options update instantly without waiting for a
    realtime echo. `TypePill` simplified to `CitizenType` only (DB never holds
    empty string); the dead "Unset" type filter removed. Full validation display
    (missing/duplicate/format rings) retained in read-only view.

- **`src/app/(authed)/nations/`**
  - `patchNation(id, patch)` narrow server action (no `revalidatePath`).
  - Page wiring identical to cities pattern.
  - `nations-editor.tsx` rewritten: 5 `useInstantField` hooks per row
    (`name` / `abbreviation` / `color_hex` / `icon_type` / `icon_value`).
    Drag-to-reorder remains **structural** (calls `updateAllNations` with
    `revalidatePath`) — fires on `onDragEnd` after the local array is
    reordered in place, so the server catches up. `DeleteX` now uses
    `useConfirm()` instead of the bare `confirm()` call (consistency fix).

#### Verification

- `pnpm typecheck` clean.
- `pnpm lint` net-neutral (42 problems pre/post).
- `pnpm test` clean (309 tests).

#### Locked-in lessons

**Lesson — `Citizen.type` is always `CitizenType` at the DB layer.** The old
editor used a `RowState` local type with `type: CitizenType | ""` to represent
"unset" in the form. The DB never holds an empty string for this column — the
`createCitizen` action inserts `type: "npc"`. Instant-save binds directly to
the `Citizen` row, so the `""` special case disappears: `TypePill` accepts
`CitizenType` only and the type-unset filter (`typeFilter === "unset"`) becomes
dead UI (kept for forward-compat if a future migration allows null). Callers
who previously needed `CitizenType | ""` should just treat the DB value as
always valid.

**Lesson — FK-coupled fields: use the hook's `value` return for derived reads,
not a parent mirror.** When `city_id` changes and `nation_id` must follow,
calling `nationIdField.set(newNationId)` is all that's needed. The
`useInstantField` hook's `value` return IS its in-progress local value, so
consumers can read it directly (e.g. `nationIdField.value` in an `availableCities`
useMemo) to get instant UI feedback without touching the shared rows mirror.
The parent mirror updates via postgres_changes, not via synchronous `onRowUpdate`
calls. Do NOT call `onRowUpdate` after `field.set()` — that triggers B3 (see
below in Codex review fixes).

**Lesson — Drag-to-reorder is a structural mutation, not a field patch.** The
nations list has drag-to-reorder. The `sort_order` column exists on every row
but updating it requires a multi-row write (all rows get new indices). This
cannot be done as a single-field `patchNation` call. The `updateAllNations`
coarse action (which calls `revalidatePath`) is the right vehicle — it fires on
`onDragEnd` after the local array is re-spliced. This is consistent with the
plan: "structural mutations keep `revalidatePath`."

**Codex review fixes:** Three B3 violations and one nit were caught during
Codex review and fixed before merge:

- **B3 fix — citizens `onRowUpdate` removed.** The original code called
  `field.set(value)` followed immediately by `onRowUpdate({ field: value })` for
  `type`, `city_id`, and `nation_id`. Because `useInstantField`'s `commitNow`
  compares `localValue` to `valueRef.current` (the server value), and both were
  set to the user's typed value in the same render cycle, the equality check
  short-circuited and the patch action never fired. Fix: removed all
  `onRowUpdate` calls from field change handlers; the rows mirror now updates
  exclusively via the postgres_changes handler. The `availableCities` filter
  was updated to read `nationIdField.value` (the hook's local in-progress value)
  instead of `row.nation_id` so city options update instantly when nation
  changes — this is the canonical pattern for FK-coupled display without
  touching the parent mirror.

- **B3 fix — nations `onRowUpdate` removed.** The `IconPicker.onChange` and
  `onColorChange` callbacks both called `field.set(...)` + `onRowUpdate({...})`
  for `icon_type`, `icon_value`, and `color_hex`. Same silent-no-op failure
  mode. Fixed by removing `onRowUpdate` from both callbacks; `NationRow`'s
  `onRowUpdate` prop was deleted entirely.

- **Migration renumber (0032 → 0035).** The original migration was numbered
  `0032_realtime_publication_reference_data.sql`, which collided with
  `0032_realtime_ending_assignments.sql` already on main. Renumbered to 0035
  (0034 reserved for the sibling sorting branch). No internal content
  references its own number.

- **Nit — "Unset" type filter removed.** `CitizenType` is `"hero" | "npc"`
  only; the DB never stores null/empty. The "Unset" `<option>` and its
  `typeFilter === "unset"` branch were dead code. Removed from the filter
  select and the `TypeFilter` union type.

#### Follow-ups

- **User must apply migration 0035** to remote Supabase via the MCP
  `apply_migration` tool or the SQL editor.
- **Duplicate city-code guard is per-row only.** The old editor tracked
  duplicate codes across all rows in a `codeCounts` map and blocked save.
  Instant-save cannot block cross-row — the server's `updateAllCities` used to
  enforce uniqueness, but `patchCity` patches one row at a time and cannot see
  sibling rows. A server-side unique constraint on `cities.code` would be the
  correct enforcement layer; add one in a follow-up migration.
- **Phase 4 long-tail** surfaces still remaining: `storylines`, `actions`
  editor, `sorting`, `playthroughs`, `physical`, `days`, ending variables,
  endings documents.
