# Endings → autosave + presence

**Status: closed.** Shipped in PR #40 (variables editor) and PR #42
(document-editor: logic + frameworks). This file is the status log.

## Context

The endings surface (`/endings/variables`, `/endings/logic`,
`/endings/frameworks`) was the last major editor on the legacy
bulk-save plumbing — a `SaveRevert` button bar, `useUnsavedDialog`
route guards, and a single `saveDocument()` / `updateAllEndingVariables()`
action that walked the whole tree and UPDATEd every record. Every other
editable surface (cities, citizens, nations, days, storylines) had
already moved to per-field autosave + Supabase Realtime presence. The
endings editors are the most collaboration-prone (multiple stakeholders
on one logic doc), so the lack of presence rings + field-level LWW was
the most painful gap.

The migration matched the cities/citizens/nations pattern: per-field
`useInstantField` patches (400 ms debounce + blur-flush), `postgres_changes`
echo as the source of truth for committed state, `<FieldHighlight>`
rings + per-row/tab peer dots driven by `WorkspacePresenceProvider`.

## Pattern

- **Hook**: `useInstantField<T>` (`src/lib/realtime/use-instant-field.ts`)
  — 400 ms debounce, blur flushes via `commitNow`, LWW (drops remote
  updates while local status is `dirty`/`saving`).
- **Server actions**: `patchX(id, partial)` — narrow patches, no
  `revalidatePath` (realtime fans out via `postgres_changes`), throw on
  error.
- **Provider**: `<WorkspacePresenceProvider channelName="…"
  postgresTables={[…]}>` (`src/lib/realtime/presence-context.tsx`);
  editors read `usePresenceContext()` for `setFocus`, `peers`,
  `selfColor`, `setSelection`, `onPostgresChanges`.
- **Visuals**: `<FieldHighlight>` around inputs; per-row / per-tab peer
  dots from `selection.payload`; no per-surface AvatarStack (global
  `AppPresence` covers it).
- **B3 anti-pattern guard**: never mutate the local mirror synchronously
  after `field.set(v)` — `commitNow()` would see no change and silently
  drop the write. Mirror updates flow only from `onPostgresChanges`.

Reference: `src/app/(authed)/cities/cities-editor.tsx`, `cities/actions.ts`.

## What shipped

### PR #40 — variables editor
- `patchEndingVariable` / `patchEndingVariableValue` in
  `variables/actions.ts` (trim + uniqueness, `ilike` wildcards escaped).
- `variables-editor.tsx` rewritten: per-field `useInstantField`, presence
  provider (`endings-variables`), `onPostgresChanges` mirror, peer-focus
  value-list expansion. `SaveRevert` removed.

### PR #42 — document-editor (logic + frameworks)
Server actions in `_shared/document-actions.ts`:
- `patchDocument`, `patchBlock`, `patchRow`, `patchChip`,
  `patchBlockVariable` — narrow patches.
- `reorderTree({document_id, blocks, rows, chips, header_vars})` — bulk
  structural move; validates result-uniqueness against the **merged**
  post-move state (proposed positions + unchanged blocks).

`document-editor.tsx`:
- Framework name + every block leaf (text / summary / result_value)
  flow through `useInstantField` + `patchBlock` / `patchDocument`.
- Chip pickers commit through the `updateChip` wrapper (optimistic
  mirror + `patchChip`); number chips hold a local draft so a cleared
  field never persists an invalid all-null chip.
- Drag-reorder fires `reorderTree` directly (no Save button); the stuck-
  drag watchdog resets on every `dragover` and cancels (never commits).
- `onPostgresChanges` mirror handler for all four ending tables.
- `SaveRevert`, `useUnsavedDialog`, `dirty`/`registerHandle`, the
  `openPickerCount` save-gate, and the `beforeunload` guard all removed.

Presence:
- `frameworks/workspace.tsx` + `logic/logic-editor.tsx` wrapped in
  `WorkspacePresenceProvider` (`endings-frameworks` / `endings-logic`).
- `PresenceSelection` grew `payload?: Record<string, string | null>` so
  surfaces broadcast context without bloating the shared union. Endings
  sets `endingFrameworkId` / `endingTabId`.
- `FrameworkList` shows per-row peer dots; `LogicTabBar` got a
  `renderTrailing` slot for per-tab peer dots.
- Block leaves wrap their card in `<FieldHighlight>` keyed on a
  `field:"drag"` focus so a dragged block rings in the dragger's color.
- Lexical text blocks got a `ValueSyncPlugin` — Lexical owns its state
  post-mount, so peer text edits are pushed back in when the `value`
  prop diverges from the last-emitted text.

Infra:
- Migration `0037_realtime_publication_endings.sql` wired the seven
  ending tables into the `supabase_realtime` publication (without it,
  commits land but peers never see the echo).

Cleanup: `updateAllEndingVariables` deleted; `saveDocument` kept
`@deprecated` for the integration test suite until those tests migrate.

## Follow-ups (open)

- ~~**#43**~~ (closed) — Lexical text block briefly showed the placeholder
  on initial mount. Residual SSR/hydration empty-frame is tracked as
  **#47**.
- ~~**#44**~~ (closed) — `useInstantField` drops a remote update that
  lands during `dirty`/`saving`. Fix shipped; the reducer now stashes the
  remote value in `pendingRemote` and replays on save settle.
- **#77** — `saveDocument` + its integration tests still use the bulk
  path; migrate the tests to the per-field patches, then delete
  `saveDocument`.
- **#78** — Per-field patch coverage: the autosave wiring is only
  reducer-level unit-tested; client wiring tests need presence/Realtime
  mocking.
- **#79** — Chip presence ring can be clipped by the editor section's
  `overflow-hidden` when a chip sits flush to a panel edge (cosmetic).
