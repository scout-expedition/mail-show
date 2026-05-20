# Smart Variables — nested-folder left rail

## Context

The Smart Variables page (`/endings/smart-variables`) renders the picker as a **flat** list pill column at `lg:w-72`. Users want the picker to look like the Variables page (`/endings/variables`) tree — nested folders, indent-by-depth, expand/collapse, inline rename, drag-to-move — but at the current narrow width.

User decisions (confirmed):
- **Separate folder hierarchies per page.** Folders created on Smart Variables are invisible on Variables and vice versa. Same schema, partitioned by a `scope` column.
- **Full parity with Variables.** Create/rename/delete folders; drag smart-vars between folders; drag-reorder folders; rename + delete smart vars from the rail.
- **Always show every smart-variable folder**, even when empty.

Width target: keep `lg:w-72` (288 px). This is the "narrow version" the user asked for.

## Approach (recommended)

Two pillars: (1) partition the existing `ending_variable_folders` table with a `scope` column; (2) extract the tree subcomponents from `variables-editor.tsx` into a shared module that both pages render.

### 1. Schema — partition folders by scope

New migration: `supabase/migrations/<timestamp>_ending_variable_folder_scope.sql` (use `supabase migration new`).

```sql
alter table public.ending_variable_folders
  add column if not exists scope text not null default 'variable'
  check (scope in ('variable', 'smart_variable'));
create index if not exists ending_variable_folders_scope_idx
  on public.ending_variable_folders(scope);

-- Reject parenting across scopes (a 'variable' folder cannot live inside
-- a 'smart_variable' parent, and vice versa).
create or replace function public.evf_check_scope_alignment()
  returns trigger as $$
declare parent_scope text;
begin
  if new.parent_folder_id is null then return new; end if;
  select scope into parent_scope
    from public.ending_variable_folders where id = new.parent_folder_id;
  if parent_scope is distinct from new.scope then
    raise exception
      'ending_variable_folders: parent scope % does not match child scope %',
      parent_scope, new.scope;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists evf_scope_alignment on public.ending_variable_folders;
create trigger evf_scope_alignment
  before insert or update of parent_folder_id, scope
  on public.ending_variable_folders
  for each row execute function public.evf_check_scope_alignment();

-- Reject ending_variables.folder_id pointing at a wrong-scope folder.
-- A row with kind='smart_ref' must live in a 'smart_variable' folder
-- (or root); everything else must live in a 'variable' folder (or root).
create or replace function public.ending_variables_check_folder_scope()
  returns trigger as $$
declare f_scope text; expected text;
begin
  if new.folder_id is null then return new; end if;
  select scope into f_scope
    from public.ending_variable_folders where id = new.folder_id;
  expected := case when new.kind = 'smart_ref'
    then 'smart_variable' else 'variable' end;
  if f_scope is distinct from expected then
    raise exception
      'ending_variables: kind % requires folder scope %, got %',
      new.kind, expected, f_scope;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists ending_variables_folder_scope
  on public.ending_variables;
create trigger ending_variables_folder_scope
  before insert or update of folder_id, kind
  on public.ending_variables
  for each row execute function
  public.ending_variables_check_folder_scope();
```

Apply with **`scripts/apply-migration-file.ts`** (single-file applier — safe against the populated dev/prod DB) or the Supabase MCP `mcp__supabase__apply_migration`. **Do not** use `pnpm db:migrate` — `scripts/apply-migration.ts` re-runs every prior migration and breaks on the populated DB. Either approach must apply this one idempotent migration only.

Also extend the row type:

- `src/lib/db/types.ts` — add `scope: 'variable' | 'smart_variable'` to `EndingVariableFolder`.

### 2. Extract the tree to a shared module

The tree subcomponents live inline in `variables-editor.tsx` (lines 113 — `DragCtx`, 1337 — `AllListView`, 1485 — `FolderBranch`, 1618 — `FolderRow`, 1685 — `VariableRow`, 1747 — `RowShell`) and are tightly bound to the page's drag/select/rename hooks.

Extract into a new module:

- **New**: `src/app/(authed)/endings/_shared/folder-tree-view.tsx`
  - Exports: `FolderTreeView`, `DragCtx`, `useDragCtx`, plus row subcomponents as needed.
  - Surface (props): `folders`, `childFoldersByParent`, `sortedVariablesByFolder`, `isCollapsed`, `onToggleCollapsed`, `selectedIds`, `onSelect`, `pinnedId`, `onRenameVariable`, `onRenameFolder`, `onDropCommit`, plus drag context value.
  - **Visual config** (new props): `density?: 'comfortable' | 'compact'` and `showVariableInspectorIcons?: boolean`. Smart-variables passes `density='compact'` so the rail fits at 288 px (smaller chevron column, tighter padding, smaller font).
  - Keeps current behavior identical for the Variables page (pass `density='comfortable'` as default).

- **Move** (shared, both pages): the pure helpers in `src/app/(authed)/endings/variables/folder-tree.ts` (`buildChildFoldersByParent`, `buildFolderOptions`) — keep at current path; both pages import. No move needed.

- **Refactor** `variables-editor.tsx` to import the extracted module rather than defining the tree inline. Goal: no observable behavior change on `/endings/variables`. The drag-context value, selection state, URL sync, and optimistic-create handlers stay owned by `variables-editor.tsx` — the extracted tree treats `DragCtx` as a **required injected contract** (Codex flagged this — drag context is non-optional in `RowShell`, so the page must keep providing it). Smoke-test by exercising drag/rename/multi-select on Variables after extraction.

### 3. Wire both pages to their scope

- `src/app/(authed)/endings/smart-variables/page.tsx`
  - Filter `folderData` to `scope = 'smart_variable'` (server-side `.eq('scope', 'smart_variable')`).
  - Filter `varData` to smart-refs only when passing to the rail (regular vars still pass through for chip pickers / `DocumentEditor.variables`).

- `src/app/(authed)/endings/variables/page.tsx` — **must also gain** `.eq('scope', 'variable')` on its `ending_variable_folders` fetch. Without this, smart-variable folders show up in the Variables tree the moment the migration lands. (Caught in Codex review.)

- `src/app/(authed)/endings/smart-variables/smart-variables-editor.tsx`
  - Replace the `<ul>` flat list (lines 432–497) with `<FolderTreeView ... density="compact" />`.
  - Lift state currently inline: `selectedIds`, `pinnedId`, `collapsedIds` (localStorage key `smart-variables.collapsedIds`), drag state (mirror what `variables-editor.tsx` does, hooks at lines 263–283 + the drag handlers around line 580+).
  - Selection → URL: on single-select of a smart-variable row, call existing `navigateToDoc(docId)` using the `variable.smart_variable_doc_id` to resolve the doc. On folder-only selection, no doc navigation (keeps the right pane on its prior doc or the empty state).
  - Replace the "+ New" button with the same `ControlBar` create-variable / create-folder pair from variables-editor (or extract a minimal `<TreeControlBar>` into `_shared/`).

### 4. Server actions for the Smart Variables rail

Add to `src/app/(authed)/endings/smart-variables/actions.ts`:

- `createSmartVariableFolder({ parentFolderId, name? })` — inserts `ending_variable_folders` with `scope='smart_variable'`. Cycle/scope alignment enforced by triggers.
- `renameSmartVariableFolder({ id, name })`
- `deleteSmartVariableFolder({ id })` — DB `ON DELETE RESTRICT` already prevents non-empty deletes; surface a clean error.
- `moveSmartVariableFolder({ id, parentFolderId })` — parent must be smart scope; trigger rejects mismatches.
- `moveSmartVariableToFolder({ variableId, folderId })` — like `moveVariableToFolder` but locked to smart-refs; folder must be smart scope.
- `createSmartVariable({ name?, folderId? })` — extend existing action to accept an optional `folderId` so creation inside a folder works on first commit.

Codex review noted the variables folder actions are large (sibling sort lookup, move renumbering, cycle checks, delete reparenting) — duplication will likely exceed ~30 lines. **Plan: extract scope-aware shared primitives** into `_shared/folder-actions.ts` for move-into-folder, folder reparenting, and sort renumbering. Keep lifecycle creation (which differs between smart-var doc/var pairing and plain variables) on each page. Each action calls the existing `revalidateEndings()` helper.

Each action calls the existing `revalidateEndings()` helper.

### 5. Visual tuning for narrow rail

The Variables tree assumes `flex-1` width inside a wider grid. At 288 px we need to:

- Shrink row font from `text-sm` to `text-[12px]` (match the current flat-list font).
- Reduce horizontal padding inside `RowShell` by ~4 px.
- Truncate folder names earlier (`min-w-0 truncate` already in place; verify nothing past it forces overflow).
- Hide the "(N items)" child counter if it pushes width — show on hover only.

Gate these via the new `density='compact'` prop so the Variables page is untouched.

### 6. Realtime + presence

`smart-variables-editor.tsx` already subscribes to `ending_variables` via `WorkspacePresenceProvider.postgresTables`. **Add `ending_variable_folders`** to that list so concurrent folder edits surface.

## Critical files to modify

- `supabase/migrations/<timestamp>_ending_variable_folder_scope.sql` (new)
- `src/lib/db/types.ts` — add `scope` to `EndingVariableFolder`
- `src/app/(authed)/endings/_shared/folder-tree-view.tsx` (new — extracted from `variables-editor.tsx`)
- `src/app/(authed)/endings/_shared/folder-actions.ts` (new — scope-aware move/reparent/renumber primitives shared by both pages)
- `src/app/(authed)/endings/variables/page.tsx` — add `.eq('scope', 'variable')` to the folder fetch
- `src/app/(authed)/endings/variables/variables-editor.tsx` — import shared tree, drop inline copies
- `src/app/(authed)/endings/smart-variables/page.tsx` — `scope='smart_variable'` filter on folders
- `src/app/(authed)/endings/smart-variables/smart-variables-editor.tsx` — replace flat list with `<FolderTreeView density="compact" />`, lift drag/selection/collapse state
- `src/app/(authed)/endings/smart-variables/actions.ts` — add folder CRUD + variable-move actions

## Existing utilities/components to reuse (no rewrite)

- `buildChildFoldersByParent`, `buildFolderOptions` — `src/app/(authed)/endings/variables/folder-tree.ts`
- `colorIndexFor`, `paletteColor` — `src/lib/endings/color-palette.ts`
- `useConfirm` — `src/components/confirm-dialog.tsx`
- `WorkspacePresenceProvider`, `usePresenceContext` — `src/lib/realtime/presence-context.ts`
- `revalidateEndings` — already at the top of `smart-variables/actions.ts`

## Verification

After implementing, with `pnpm dev` running:

1. **Schema migration applies cleanly** via Supabase MCP. Inspect `ending_variable_folders` — confirm `scope` column exists, existing rows are `'variable'`.
2. **Variables page (`/endings/variables`) is unchanged**: tree renders identically, drag/rename/multi-select still work. After creating a folder on `/endings/smart-variables`, revisit `/endings/variables` and confirm it does **not** appear in the tree (verifies the `scope='variable'` filter on `variables/page.tsx`).
3. **Smart Variables page (`/endings/smart-variables`)**:
   - Left rail renders nested-folder tree at `w-72`.
   - "New folder" creates a folder visible here but **not** on `/endings/variables`.
   - "New smart variable" creates a smart variable under the currently-selected folder (or root).
   - Dragging a smart variable to another smart-folder commits via `moveSmartVariableToFolder`.
   - Dragging a smart variable to a regular-variable folder is structurally impossible (folders are filtered out server-side; trigger backs this up).
   - Clicking a smart variable in the tree navigates `?doc=<id>` and renders the `DocumentEditor` on the right.
   - Renaming a smart variable updates the chip label everywhere (presence + revalidate).
   - Deleting a non-empty smart folder shows a clean error (DB `ON DELETE RESTRICT`).
4. **Type/lint clean**: `pnpm typecheck && pnpm lint`.
5. **Tests**: run `pnpm test`. If folder-CRUD test coverage exists for variables, extend with smart-variable equivalents (per `docs/testing-protocol.md`).

## Out of scope (separate change)

- Drag a smart variable into a regular folder or vice versa (rejected by design).
- Re-shaping the right-side `DocumentEditor` (no changes there).
- "Move to folder via picker" UX in the right-pane DocumentEditor menu (the rail covers this).
- Migrating any pre-existing smart-ref `folder_id` values — there are none today (no UI assigned them).

## Plan-file destination

This plan currently lives at `~/.claude/plans/for-smart-variables-page-partitioned-sky.md` because plan-mode put it there. On implementation kickoff, move it to `docs/plans/active/smart-variables-tree-plan.md` (project memory: plan files belong in `docs/plans/active/`).
