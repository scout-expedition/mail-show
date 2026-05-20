# Fix issues #36, #43, #44

## Context

GitHub issues #36, #43, #44 are three independent bugs in the **endings** surface, all
surfaced during Codex reviews of recent PRs (#35, #42):

- **#36** — `duplicateBlock` / `duplicateRow` aren't transactional. A constraint error
  mid-clone leaves shifted sibling `sort_order`s and a partial subtree behind, with no
  failed-clone root to cascade-delete.
- **#43** — the Lexical text-block editor flashes its placeholder (`Paragraph text…`)
  for ~1 frame on initial mount before the saved text renders.
- **#44** — `useInstantField` silently drops a remote (`postgres_changes`) update that
  arrives while the field is `dirty`/`saving`, with no replay — the field can stay stale.

The branch was fast-forwarded to `origin/main` before this work began (the fixes touch
code that only existed on `origin/main`).

---

## Issue #36 — transactional duplicate via Postgres RPC

**Decision:** move the clone into PL/pgSQL functions called via `supabase.rpc(...)`. The
whole function body runs in one implicit transaction, so any mid-clone failure rolls back
everything — partial clones become structurally impossible. This is the issue's
recommended "right shape". The repo currently has **no** `.rpc()` usage, so this also
establishes the pattern.

### New migration — `supabase/migrations/0038_endings_duplicate_rpc.sql`

Contains two pieces:

**(a) Make the two `ending_blocks` self/parent FKs deferrable** so the function can
bulk-insert blocks + rows in any order without a topological loop:
```sql
alter table public.ending_blocks
  alter constraint ending_blocks_parent_row_fk deferrable initially immediate;
alter table public.ending_blocks
  alter constraint ending_blocks_parent_block_id_fkey deferrable initially immediate;
```
`initially immediate` means **no behaviour change** for any existing code — the
constraints are still checked per-statement unless a transaction explicitly defers them.
`alter constraint` is idempotent, so re-running the migration is safe.

**(b) `create or replace function`** (idempotent) for two functions, `SECURITY INVOKER`
(default — RLS still applies exactly as today's cookie-aware server-client writes do; no
`SECURITY DEFINER`, no policy changes):

`duplicate_ending_block(p_block_id uuid) returns uuid`:
1. Load the original block; `raise exception` (matching the current JS messages) if it's
   `fallback` or `result`, or not found.
2. `set constraints ending_blocks_parent_row_fk, ending_blocks_parent_block_id_fkey
   deferred;`
3. Recursive CTE collects the subtree as **ids only**, alternating two recursive
   branches: condition rows where `condition_block_id ∈` collected blocks, and blocks
   where `parent_row_id ∈` collected rows. Do **not** join chips / rows / block-variables
   inside the recursive term — that multiplies rows. Then fetch the full block, row,
   chip, and block-variable records in separate set-based `… where … in (<collected
   ids>)` queries. Build `_block_map(old_id, new_id)` / `_row_map(old_id, new_id)` with
   `gen_random_uuid()`.
4. Shift later siblings' `sort_order` by `+1` to open the insertion slot. No `(parent,
   sort_order)` unique index exists on `ending_blocks` / `ending_condition_rows`, so a
   single plain `update … set sort_order = sort_order + 1` suffices.
5. Bulk-insert cloned blocks (final mapped parents) and rows in any order — FKs deferred,
   checked at function commit. Root clone keeps the original's parent + `sort_order+1`.
6. Insert cloned `ending_condition_row_chips` and `ending_condition_block_variables`
   (their FKs target blocks/rows already inserted — no deferral needed).
7. `return` the new root block id.

`duplicate_ending_row(p_row_id uuid) returns uuid`: analogous — shift later rows in the
same condition block, insert the new row, clone its chips, collect + remap the descendant
block/row subtree, deferred bulk-insert, return the new row id.

The algorithm is a 1:1 port of the proven JS in `document-actions.ts` — only the
execution context changes (one SQL transaction instead of N independent round-trips).

### TypeScript — `src/app/(authed)/endings/_shared/document-actions.ts`

Replace the bodies of `duplicateBlock` / `duplicateRow` with thin `supabase.rpc(...)`
wrappers; keep `revalidateEndings()`; delete the now-dead BFS/id-map/shift helper code
unique to these two functions (`fetchSiblings` is shared with `addBlock` — keep it).

### Deploying the migration

`pnpm db:migrate` is reported broken against the cloud DB (issue #19). Check the SQL into
`supabase/migrations/0038_*.sql` **and** apply it to the cloud DB via the Supabase MCP
(`apply_migration`). The migration is idempotent (`create or replace`, idempotent `alter
constraint`).

---

## Issue #43 — synchronous editorState hydration

**Decision:** the placeholder flash comes from `LexicalComposer` receiving its
`editorState` as an **update function** (`buildInitialEditorState` returns `() => {…}`),
applied via a deferred `editor.update(...)` — the editor is empty for the first paint.
Passing `editorState` as a **serialized JSON string** makes Lexical hydrate synchronously
so content is present on the first paint and the placeholder never shows for a non-empty
block.

- `serialize.ts` — add `buildInitialEditorStateJSON(text)`: builds the state once via a
  headless `createEditor({ nodes: [MentionNode] })` + `editor.update(fn, {discrete:true})`
  + `JSON.stringify(getEditorState().toJSON())`. `MentionNode` already implements
  `exportJSON`/`importJSON`.
- `text-block-editor.tsx` — the first-mount `useMemo` builds the JSON string and passes
  it as `initialConfig.editorState`. `ValueSyncPlugin` is unchanged.
- `serialize.test.ts` — round-trip test for the new builder.

If a flash somehow remains, fall back to gating the placeholder behind a one-shot
`mounted` flag.

---

## Issue #44 — `useInstantField` pending-remote slot

**Decision:** add a pending-remote slot to the reducer state. A `remote` action arriving
while `dirty`/`saving` is **stashed** instead of dropped; when `saveSuccess` transitions
the field to `idle`, a stashed remote that differs from the just-committed value is
applied. Keeps the LWW guarantee (local typing wins *during* the edit) while ensuring the
last remote value isn't lost.

`src/lib/realtime/use-instant-field.ts` — `InstantFieldState<T>` gains
`pendingRemote: { value: T } | null`. Reducer changes:
- `set` → clears `pendingRemote` (fresh keystroke is newest local intent).
- `remote` while `dirty`/`saving` → stash in `pendingRemote` (don't drop); while
  `idle`/`error` → apply + clear.
- `saveStart` → carries `pendingRemote` through.
- `saveSuccess` (`saving`→`idle` branch) → apply a differing `pendingRemote`, clear slot.
  The "user kept typing" branch keeps it stashed for the next `saveSuccess`.
- `saveError` → `localValue` becomes the stashed remote if present (else `serverValue`),
  clear slot — never silently drop a peer write that landed in the save window.

`useInstantField`'s `useState` initializer adds `pendingRemote: null`. No consumer
changes. Tests added in `use-instant-field.test.ts`.

---

## Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` — all clean/pass.
2. **#36** — apply `0038` via Supabase MCP; duplicate a nested condition block → full
   deep clone; force a mid-clone failure → nothing persists.
3. **#43** — `pnpm dev`, hard-refresh `/endings/frameworks` → no placeholder flash on a
   non-empty text block; empty blocks still show the placeholder; mentions still render.
4. **#44** — covered by reducer unit tests.

The three fixes are independent — separate commits in one PR.
