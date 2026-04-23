# Inspection Letters Workspace — remaining UX plan

Last updated: 2026-04-23. Branch: `claude/plan-coplanning-website-LVgfQ`.

## Scope
This is the continuation plan for the /inspection/letters workspace. A fresh session should read this doc first, then open the files listed under "Key files" to pick up.

## Recent commits (most → least recent)
1. `5372fcc` — Hide save/revert when clean; swap revert icon to Tabler restore
2. `779208b` — Clickable breadcrumb header and `?group` `?letter` `?report` deep links
3. `711d416` — Uniform save/revert/delete controls, entity icons, hover-only counter steppers, report segment polish
4. `77131d5` — Merge letter group detail into /inspection/letters workspace with 5-panel slide
5. `02ca047` — Slug-based letter group URLs and sliding letter/actions/segment editor

## Applied DB migrations (since last session)
- `0007_updated_by` — adds `updated_by text` to `inspection_letters` and
  `report_segments`, re-creates the two views. Applied on 2026-04-23 to
  project `qleuihyqfpnectqcqagx`.

## Key files

| File | Role |
|------|------|
| `src/app/(authed)/inspection/letters/page.tsx` | Server component; preloads everything; resolves `?group` / `?letter` / `?report`. |
| `src/app/(authed)/inspection/letters/workspace.tsx` | The huge client workspace (`LettersWorkspace`). Owns slide state, URL sync, and all panel components. |
| `src/app/(authed)/inspection/letters/actions.ts` | All server actions for groups/letters/actions/segments; revalidates `/inspection/letters` (no longer `[slug]`). |
| `src/app/(authed)/inspection/letters/[slug]/page.tsx` | Legacy redirect → `/inspection/letters?group=…`. |
| `src/components/confirm-dialog.tsx` | `useConfirm()` hook used for revert prompts. **Not yet** used for the remaining native `confirm(...)` calls. |
| `src/app/(authed)/inspection/storylines/page.tsx` | Storylines list page — "+ Storyline" still submits a form that calls `createStoryline()` with no popup. |
| `src/app/(authed)/inspection/storylines/[id]/page.tsx` | Storyline detail page — letter-groups section already removed. |
| `src/lib/letter-groups.ts` | `groupSlug` / `parseGroupSlug` helpers. |

## Slide model (important)

5 panels: storylines list | group info+letters | letter fields | actions | segment.
- Wrapper width `250%`, each panel `w-1/5`, steps of `-translate-x-[20%]`.
- `view` state: `"groups" | "main" | "actions" | "segment"`.
- Picking a group keeps `view="groups"` (panels 0 + 1 visible); only selecting a letter slides to `"main"` (panels 1 + 2).

## Remaining tasks

### 1) Storyline panel: toggle + split-click rows
In `StorylinesListPanel` (bottom of `workspace.tsx`):

- Add a header control to switch grouping mode: **by storyline** (default) vs **by day** (group letter groups by their `delivery_day_id`, showing Day identifier as the bucket header).
- Split each row's click target:
  - The right-side chevron (or a dedicated 32-px area on the right) toggles expand/collapse.
  - Clicking anywhere else on the row calls a new `onOpenStoryline(storylineId)` instead of toggling.
- Storyline buckets default to uncollapsed (already true).

### 2) Storyline inspector panel (shares slot 1 with the group panel)
In `LettersWorkspace`:

- Add state `selectedStorylineId: string | null` that is mutually exclusive with `selectedGroupId`.
- Slot 1 (currently the group panel) becomes conditional:
  - `selectedStorylineId` → render `<StorylineInspector />`.
  - `selectedGroupId` → render the existing group card + letter list.
  - Neither → "Pick a letter group" empty state.
- `StorylineInspector` should:
  - Edit name / abbreviation / color / icon / description (auto-save via a new `updateStoryline` server action or reuse the existing one in `src/app/(authed)/inspection/storylines/actions.ts`).
  - Show a list of this storyline's letter groups. Clicking one calls `selectGroup(id)` and slides to the group panel (swap what's in slot 1 in place; no slide change needed).
  - "+ Letter group" button at the bottom calls `createLetterGroup` (already exists in `storylines/actions.ts`) and then selects the new group.

### 3) Report segments section on the group panel
Inside the group card (in workspace.tsx, below the Letters list):

- New card titled "Report segments (N)" listing every segment in this letter group (from `segments` array — already scoped).
- Each row: the lowercase roman `report_id` pill, any truncated content summary, clickable.
- Clicking opens the existing `LetterSegmentCard` in slot 4 (segment slot). Slide to `view="segment"`.
- This needs `view="segment"` to be reachable without first opening a letter/actions. Either:
  - From `"groups"` jump straight to `"segment"` (translate `-translate-x-[60%]`) and accept that panels 3+4 (actions + segment) become visible; the actions panel would show whatever's in it, which may be nothing.
  - OR introduce a new transient state where slot 3 is empty/collapsed; not recommended.
- Simpler: when opening a segment from the group panel, set `selectedId = null` and `view = "segment"`. Slot 3 shows the "no letter selected" empty state; slot 4 shows the segment. Good enough.

### 4) Triggers subsection on `LetterSegmentCard`
- Add a computed list of actions whose `report_segment_id` matches this segment.
- Actions are in `allActions` (already loaded in page.tsx). Join against `inspection_letters` (in `letters` prop) to get the containing letter's `content_id`.
- Render a small section at the bottom of the segment card: "Triggers" header + each trigger as e.g. `U2/a · Send` (letter content_id + action name). Items should be clickable to jump to that action (set `selectedId` to letter, `view="actions"`, and optionally highlight the action).

### 5) `+ Storyline` as a popup
- On `/inspection/storylines/page.tsx`, replace the form-submit "+ Storyline" button with a client component that opens a modal similar to `CitizenDialog` (name, abbreviation 1-char, color, icon picker, description).
- New server action `createStorylineWithFields` (or extend `createStoryline` to accept fields).

### 6) Migrate all remaining `confirm(...)` to `ConfirmDialog`
Call sites (grep `confirm(` in `src/`):
- `workspace.tsx` — `selectGroup`, `selectLetter`, `closeActionsPanel`, `handleAddLetters`, `handleAddPiece`, `handleDeleteLetter`, `handleDeleteGroup`, `handleAddAction`, `handleDeleteAction`, `handleSaveGroup (alsoSaveLetter)`, `closeSegmentPanel`.
- `storylines-editor.tsx`, `citizens-editor.tsx`, `cities-editor.tsx`, `sorting-letters-editor.tsx`, `physical/physical-letters-editor.tsx`, `sorting/rules/rules-list.tsx`, `inspection/actions/editor.tsx`.
- Hook: `const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();` then `if (!(await confirmDialog({...}))) return;`. Mount `{confirmDialogEl}` once at the root of each component.
- Each handler becomes `async` and early-returns if the user cancels.

### 7) Markdown toolbar fix
In `MarkdownTextarea` (in `workspace.tsx`):
- Toolbar currently animates max-height 0 → 8. Make it non-animating / inline when focused, and match the textarea's width exactly (the toolbar already spans the wrapper but the parent sometimes is wider than the textarea because of surrounding layout).
- Option: render the toolbar INSIDE the textarea wrapper container with shared `w-full` so it's exactly aligned, and swap to `instant` appearance when focused (no max-height animation), just toggle display based on focus.

### 8) Toggle-on state for the letter panel's `Actions →` button
Minor: pass `active={view === "actions"}` to highlight the button border. Not strictly visible because the letter panel is off-screen left when view=actions, but harmless and consistent.

## Gotchas / constraints
- The group-default-day-for-segments logic is already `groupDay.number + 1` (computed inline at the `LetterSegmentCard` call site — keep that in mind when refactoring).
- `LetterSegmentCard` manages its own local `state`/`dirty` — the revert prompt and delete prompt go through an injected `onConfirmDialog` because the card owns its state.
- Breadcrumb `goToBreadcrumb` already confirms when `groupDirty || letterDirty`. When adding storyline inspector, extend the dirty check to include `storylineDirty` (new).
- Do NOT break the slide math. Every panel is `w-1/5 shrink-0`; the slide container has `style={{ width: "250%" }}`.
- `BackLink` inside the group card is now `() => selectGroup(null)` which sets `view="groups"`. Don't change that without updating the breadcrumb behavior too.
- Dev server: already running in background; output at `/private/tmp/claude-501/-Users-corey-Documents-code-mail-show/b91cd552-54ff-4f6a-8e0c-abb8d8e437b5/tasks/bfvjawli6.output` — `tail` to watch compile results.

## How to continue in a fresh session
1. Read this file: `docs/inspection-letters-plan.md`.
2. `git log --oneline -5` to orient.
3. Pick a task from the list above; each is independent enough to land in its own commit.
4. Run `npm run typecheck` after each substantive change.
5. Commit frequently with short messages; no need to bundle.
