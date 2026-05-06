# Endings Frameworks — Tiebreak Logic + Logic-tab rebuild

Master plan: `docs/endings-frameworks-plan.md`.
Predecessors:
- Phase 4 (`phase4`) — aggregate kinds, shipped (PR #4). Left tiebreakers TBD.
- Phase 5 (`phase5`) — static warnings, shipped (PR #5). Models tie as a distinct outcome with a note that this plan rewrites that truth-table.
- Phase 6 (`phase6`) — header-declared variables, shipped (PR #9 + #10).

This plan covers two things at once because they collapse to the same primitive:

1. **Tiebreaker resolution for aggregate chips.** Today `top=` / `bottom=` chips return `false` on a tie (Phase 4 evaluator) and the static analysis flags the tie state as uncovered (Phase 5). Authoring usually wants ties to resolve deterministically.
2. **Logic-tab migration to chip-row primitive.** The current `ending_logic_rules` table is a flat ordered list of `[var=value, …] → framework`. The master plan §Followups names the migration to chip-row as a separate effort. It's a separate effort no longer — the tiebreak UI naturally wants the chip-row primitive, and a unified model means we don't ship two parallel block trees.

## Status snapshot (as of 2026-05-05)

Branch: `endings-logic-v2`. Migrations 0022 / 0023 / 0024 / 0025 applied to local Supabase + the hosted dev project. `pnpm typecheck` clean; 238 unit tests + 109 integration tests green.

### Shipped on this branch

Schema + primitives:
- 0022 unified `ending_documents` + `ending_blocks` (block_type widened to text/condition/result), seeded 5 logic-kind singletons.
- 0023 added `fallback` block_type + partial unique singleton index; backfilled fallback for `framework_selection`.
- 0024 dropped redundant `class_affinity_bottom` doc (only 2 options; bottom is implicit).
- 0025 backfilled fallback for `class_affinity_top`.

Editor UX:
- Frameworks workspace switched to the unified shape. Logic page rebuilt with three sub-tabs (Ending / Class Affinity / Nation Affinity).
- Adders + drag-drop both enforce result-block uniqueness in a sibling group; drop highlight hides on invalid targets.
- Auto-seed default leaf when adding a condition row (text for frameworks, kind-default result for logic).
- Per-doc fallback panel (Ending Framework + Class Affinity), with arrow-aligned styling matching root-level result blocks.
- Result picker offers per-kind `Random` (Class: single Random; Nation: tied vs all; Ending Framework: any framework). Sentinel values: `__random__` (legacy alias for tied), `__random_tied__`, `__random_all__`.
- Friendly impact labels (Working Class / Upper Class / nation names) in result + fallback pickers.
- Tab "Ending Framework" → "Ending"; panel title "Framework Logic". Removed "(declare variables on the block header)" placeholder.

Evaluator + analysis:
- `evaluateFramework` generalised to `evaluateDocument`, supports `text` + `result` leaves and the `fallback` block.
- `resolveAggregates(Detailed)` runs once per evaluation pass before chip eval. Pre-resolved winners flow through `selections.resolved_aggregates` so all chips on the same `(ref, side)` see the same value (eliminates per-chip random-rolling drift).
- Tiebreak resolution covers all three random sentinels + class-affinity invert; cycle guard via `evaluatingDocs` set.
- Static analyzer threads a per-kind `tiebreakDocsSummary` (`{ isEmpty }`) so non-empty tiebreak docs drop the tie state from aggregate uncovered enumeration. Wired in both `frameworks/page.tsx` and `logic-editor.tsx`.

Preview:
- Generic logic-doc preview (`/endings/logic` tabs) showing variable inputs + "Resolves to" line; framework UUIDs map to names.
- Framework preview surfaces a tie-indicator panel above the paragraphs: each tied `(ref, side)` shows the tied options + the resolved winner. When the resolution came from a random sentinel, a `Dice5` button between the arrow and the value rerolls **just that key** (per-key cache keyed by aggregateKey, snapshot-validated against the current pool).
- Variable inputs use the actions-page tile UI (shared `src/components/impact-tile.tsx`) — class affinity, nations, world status / demerits each in their own grouped box. Custom number_ref columns + text variables keep the previous label + input layout.
- Preview eye toggle keeps the same icon on both states; only the active background swaps.
- Custom-subset random for `framework_selection` result blocks: `__random_subset__:[…]` sentinel + JSON id list, parse/format helpers in `enums.ts`, server-action validation against `kind='framework'` rows, multi-select checkbox picker on the result block, and preview line listing the candidate framework names.
- Nation tiebreak set narrowing: `__remove__:<nation>` + `__random_remaining__` result sentinels; new `set_includes` / `set_excludes` chip operators on the seeded Nation Affinity aggregate_ref variable (migration 0027); evaluator-side mutable working set, full row walk in condition blocks (not first-match-wins) when narrowing, auto-resolve at size 1, fall-through to fallback at size 0; framework chip's tiebreak path passes the tied columns as the initial set; result-block UI offers per-nation Remove + Random (between remaining); chip picker filters set ops to nation_affinity ref; logic preview pills toggle the hypothetical tied set and feed it into the evaluator.

Tests + tooling:
- `tests/integration/endings_logic_v2_constraints.test.ts` covers all CHECKs + partial unique indexes + seeded singletons.
- Existing actions / e2e tests that referenced dropped tables are `describe.skip` / `test.skip` with comments pointing at the step that resurrects them.

### Not shipped — see "Out of scope (followups)" below for the active list.

## Context

The user's design (from chat):

> On the Logic page, sub-tabs for: **Ending Framework**, **Class Affinity**, **Nation Affinity**.
> Similar to how the Frameworks tab is set up, but instead of text blocks, the other type of block is a **result block**. The Ending Framework logic evaluates conditions and returns an ending framework. For the affinity tabs, sections for **top** and **bottom** to define what to return on a tie.

Six documents total — one per framework plus five seeded logic docs:

| Kind | Plurality | Leaf result type | When evaluated |
| --- | --- | --- | --- |
| `framework` | many (user-created) | `text` paragraph | Rendered when chosen by `framework_selection`. |
| `framework_selection` | exactly one | framework `document_id` | At ending time, picks which framework renders. |
| `class_affinity_top` | exactly one | class option (`proletariat` \| `gentry`) | When a `class_affinity` `top*` chip evaluates and the underlying scores tie. |
| `class_affinity_bottom` | exactly one | class option | When a `class_affinity` `bottom*` chip ties. |
| `nation_affinity_top` | exactly one | nation option | When a `nation_affinity` `top*` chip ties. |
| `nation_affinity_bottom` | exactly one | nation option | When a `nation_affinity` `bottom*` chip ties. |

All six share the same tree shape: condition blocks with header-declared variables, rows with chips, AND across chips, first-match-wins across rows. The only difference is the leaf — `framework` docs end in `text` blocks; logic docs end in `result` blocks carrying one of the doc's allowed result values.

## Design intent

1. **One shared primitive.** Frameworks and logic docs use the same block tables. The block_type widens from `('text','condition')` to `('text','condition','result')`. Leaf-type validity per document kind lives in the server actions, not in a CHECK (CHECK can't cross-table; trigger is overkill).
2. **`ending_frameworks` folds into `ending_documents`.** A framework is a document with `kind='framework'` carrying the user-facing `name`. Logic docs are documents with no name; their identity is the kind. Five logic-doc kinds are singletons (unique partial index on `kind` for `kind <> 'framework'`).
3. **Drop-and-rebuild.** This rewrites both the framework block tables and the old logic tables. No data preservation — same pattern as 0010 v2 and 0014 v3.
4. **Tiebreak resolution flows through the evaluator.** When an aggregate chip evaluates and the underlying scores tie, the evaluator runs the matching tiebreak doc with the current `selections`. If the doc returns one of the tied options, that becomes the resolved winner and the chip's `=` / `≠` evaluates against it. If the doc returns nothing or returns a non-tied option, fall back to today's "tie → false" behaviour.
5. **Ending Framework selection replaces the current rules table.** `ending_logic_rules` and `ending_logic_rule_conditions` go away. The new `framework_selection` doc is a chip-row tree whose `result` leaves return a framework document_id. A row whose chips are all wildcards is the catch-all (Phase 6's wildcard slot model).
6. **Top/Bottom sections are sibling docs, not one tab-shaped doc.** Class Affinity tab shows two sections — `Top` and `Bottom` — each its own document (`class_affinity_top`, `class_affinity_bottom`). The "two sections under one tab" stays a UI detail.
7. **Static analysis loses the tie outcome when the doc is non-empty.** Once tiebreak docs exist, Phase 5's outcome enumeration drops the `tie` state for any aggregate chip whose tiebreak doc has at least one row. The lower-bound semantic ("we list assignments we *can prove* are uncovered") is preserved: empty tiebreak doc → ties stay in the uncovered enumeration.

## Schema

New migration `supabase/migrations/0022_endings_logic_v2.sql`. Drops the framework block tables, the old logic tables, and `ending_frameworks`; rebuilds with the unified shape.

```sql
-- 1) Drop. Order matters — children first.
drop table if exists public.ending_logic_rule_conditions cascade;
drop table if exists public.ending_logic_rules cascade;
drop table if exists public.ending_condition_block_variables cascade;
drop table if exists public.ending_condition_row_chips cascade;
drop table if exists public.ending_condition_rows cascade;
drop table if exists public.ending_framework_blocks cascade;
drop table if exists public.ending_frameworks cascade;

-- 2) Documents.
create type ending_document_kind as enum (
  'framework',
  'framework_selection',
  'class_affinity_top',
  'class_affinity_bottom',
  'nation_affinity_top',
  'nation_affinity_bottom'
);

create table public.ending_documents (
  id uuid primary key default uuid_generate_v4(),
  kind ending_document_kind not null,
  name text,                                   -- only when kind='framework'
  sort_order int not null default 0,           -- only meaningful for kind='framework'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'framework' and name is not null)
    or (kind <> 'framework' and name is null)
  )
);
create trigger ending_documents_set_updated_at before update
  on public.ending_documents for each row execute function set_updated_at();

-- Singleton enforcement for logic kinds.
create unique index ending_documents_singleton_kinds
  on public.ending_documents (kind)
  where kind <> 'framework';

-- Deterministic UUIDs so future migrations + tests can reference them.
insert into public.ending_documents (id, kind) values
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000','framework_selection'),    'framework_selection'),
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000','class_affinity_top'),     'class_affinity_top'),
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000','class_affinity_bottom'),  'class_affinity_bottom'),
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000','nation_affinity_top'),    'nation_affinity_top'),
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000','nation_affinity_bottom'), 'nation_affinity_bottom');

-- 3) Blocks (was ending_framework_blocks). The widened block_type accepts
--    'result' and the table grows a result_value column.
create table public.ending_blocks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.ending_documents(id) on delete cascade,
  parent_block_id uuid references public.ending_blocks(id) on delete cascade,
  parent_row_id   uuid,                        -- FK added after ending_condition_rows below
  sort_order int not null default 0,
  block_type text not null check (block_type in ('text','condition','result')),
  text text,
  result_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (block_type='text'      and text is not null         and result_value is null)
    or (block_type='result' and result_value is not null and text is null)
    or (block_type='condition' and text is null          and result_value is null)
  ),
  check (
    (parent_block_id is null and parent_row_id is null)
    or (parent_block_id is not null and parent_row_id is not null)
  )
);

-- 4) Rows + chips + header variables. Names retain "condition_" because the
--    parent of a row IS a condition block — even though blocks now broaden,
--    rows still hang only off condition-kind blocks.
create table public.ending_condition_rows (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null references public.ending_blocks(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ending_blocks
  add constraint ending_blocks_parent_row_fk
  foreign key (parent_row_id)
  references public.ending_condition_rows(id) on delete cascade;

create table public.ending_condition_row_chips ( …same shape as 0014/0020/0021… );
create table public.ending_condition_block_variables ( …same shape as 0021… );

-- 5) RLS — same authenticated-only policies as the v3 framework tables.
```

**Result-value validation.** `result_value` is free text; allowed values depend on the parent doc's kind. Validation lives in server actions:

- `kind='framework_selection'` → must be the UUID of an `ending_documents` row with `kind='framework'`.
- `kind='class_affinity_*'` → must be in `AGGREGATE_OPTIONS_BY_REF.class_affinity` (`proletariat` | `gentry`).
- `kind='nation_affinity_*'` → must be in `AGGREGATE_OPTIONS_BY_REF.nation_affinity` (`folos` | `emberlyn` | `spokgrad` | `pelico` | `epicenter`).
- `kind='framework'` → no result blocks (the framework's leaves are `text`). Server action rejects.

## Type + enum updates

- `src/lib/db/enums.ts`:
  - `ENDING_DOCUMENT_KINDS = ['framework','framework_selection','class_affinity_top','class_affinity_bottom','nation_affinity_top','nation_affinity_bottom'] as const`
  - `ENDING_LOGIC_KINDS` — the five non-`framework` kinds, as a derived const for tab + section UI.
  - `ENDING_DOCUMENT_KIND_LABELS` for tab + section headers.
  - `ENDING_LOGIC_RESULT_OPTIONS_BY_KIND`:
    - `framework_selection` — resolved at runtime from `ending_documents` where `kind='framework'`.
    - `class_affinity_top` / `class_affinity_bottom` — `AGGREGATE_OPTIONS_BY_REF.class_affinity`.
    - `nation_affinity_top` / `nation_affinity_bottom` — `AGGREGATE_OPTIONS_BY_REF.nation_affinity`.
  - `ENDING_BLOCK_TYPES = ['text','condition','result'] as const`.
- `src/lib/db/types.ts`:
  - `EndingDocument` (replaces `EndingFramework`).
  - `EndingBlock` (replaces `EndingFrameworkBlock`; gains `result_value`, `document_id`).
  - `EndingConditionRow` / `EndingConditionRowChip` / `EndingConditionBlockVariable` keep their shapes; only the FK target name changes (`ending_blocks` instead of `ending_framework_blocks`) — invisible to TS.
  - Drop `EndingLogicRule` + `EndingLogicRuleCondition`.
- `src/lib/endings/block-state.ts`:
  - `BlockState` adds `document_id`, `result_value`. Indexers parameterize on document_id.

## Server actions

One unified set in `src/app/(authed)/endings/_shared/document-actions.ts` (new) — both Frameworks and Logic surfaces call into it:

- `createFrameworkDocument({ name })` — only kind allowed via this entrypoint.
- `renameDocument(formData)` — frameworks only (logic docs reject).
- `deleteFrameworkDocument(formData)` — frameworks only; logic docs are seed-immortal.
- `addBlock({ document_id, parent_block_id, parent_row_id, block_type, payload })` — payload carries `text` or `result_value` per type. Validates result_value against the doc's kind.
- `addRow({ block_id })`
- `addChip({ row_id, variable_id, … })` (unchanged shape from 0021)
- `addBlockVariable` / `removeBlockVariable` (unchanged shape from 0021)
- `deleteBlock` / `deleteRow` / `deleteChip`
- `saveDocument({ document_id, blocks, rows, chips, header_vars })` — UPDATE-only. Same invariant as today's `saveFramework`.

`revalidatePath('/endings/frameworks')`, `'/endings/logic'`, `'/inspection/letters'`.

The frameworks-tab `actions.ts` and logic-tab `actions.ts` become thin wrappers (or get deleted entirely) that re-export the shared actions with whatever surface-specific shape the page needs.

## UI

### Block components are now first-class shared

Move from `src/app/(authed)/endings/frameworks/blocks/` to `src/app/(authed)/endings/_blocks/`:

- `block-list.tsx` — accepts a `LeafComponents` prop: `{ text?: TextBlockComponent, result?: ResultBlockComponent }`. Frameworks pass `text`; logic docs pass `result`.
- `condition-block.tsx`, `chip.tsx`, `condition-row.tsx`, `condition-header.tsx` — already pure over in-memory state, just need their imports updated.
- `text-block.tsx` — stays in `_blocks/` since both surfaces use the same component (frameworks for text leaves; logic docs use `result-block.tsx` instead).
- New `result-block.tsx` — single-control component (a `Select` over `ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[doc.kind]`, or the framework list for `framework_selection`).

### Frameworks tab

`src/app/(authed)/endings/frameworks/workspace.tsx` keeps its 5-panel slide. Internals switch to:

- Reading from `ending_documents` filtered to `kind='framework'`.
- Calling the shared document actions.
- Passing the shared blocks via `_blocks/`.

The user-visible surface is unchanged.

### Logic page

`src/app/(authed)/endings/logic/page.tsx` — fetch all six documents (one query: `ending_documents` plus all blocks/rows/chips/header-vars in flat queries; client-side index by `document_id`). Pass into the tab shell.

`src/app/(authed)/endings/logic/logic-editor.tsx` — rewrite. Replaces the flat-rule list with a tab strip (URL `?tab=`):

- **Ending Framework** tab → renders `DocumentEditor` for the `framework_selection` doc.
- **Class Affinity** tab → two stacked `DocumentEditor`s for `class_affinity_top` and `class_affinity_bottom`, each in its own panel with header "Top" / "Bottom".
- **Nation Affinity** tab → same stacked shape for `nation_affinity_top` / `nation_affinity_bottom`.

`src/app/(authed)/endings/_shared/document-editor.tsx` (new, generalized from `frameworks/framework-editor.tsx`):

- PanelHeader + SaveRevert + dirty plumbing + drag context + analysis memo.
- Recursive block tree using `_blocks/block-list.tsx` with the appropriate `LeafComponents` for the doc's kind.
- Header-declared variables and chip pickers reused unchanged.

`src/app/(authed)/endings/logic/blocks/result-block.tsx` (new):

- Drag rail + grip on the left (matches `text-block.tsx` styling).
- One `Select`. Options come from `ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[doc.kind]`. For `framework_selection`, the options are the framework documents passed as a prop.
- Empty state when `result_value` is null/empty: highlighted "pick a result" placeholder.

### Sub-tab navigation pattern

URL `?tab=` + a thin `TabBar` component in `endings/logic/_components/tab-bar.tsx`. The inspection workspace's panel-slide isn't the right shape for this surface.

## Evaluator

`src/lib/endings/evaluator.ts`:

1. **Generalize `evaluateFramework` to `evaluateDocument(input, selections): string[] | string | null`.** The shape stays the same — walk blocks; condition blocks first-match-win across rows; recurse children. The leaf semantics differ:
   - `text` leaf → push to paragraph array.
   - `result` leaf → return its `result_value` and stop walking.
   - For doc kind `framework`, the return is `string[]` (paragraphs).
   - For doc kind logic, the return is `string | null` (first encountered result value, or null if no row matches).
2. **`evaluateAggregateChip` gains tiebreak resolution.** When `tiedCount > 1`:
   - Look up the matching tiebreak doc in `selections.tiebreak_docs` (new field; map from `EndingDocumentKind` → `EvalInputs` for that doc).
   - Run `evaluateDocument` on that doc.
   - If the result is one of the currently-tied column names, treat that column as the resolved winner. Otherwise keep `false`.
3. **`PreviewSelections` gains `tiebreak_docs`.** Map `EndingDocumentKind → EvalInputs`. Optional, so tests + selections that don't touch aggregates keep working.
4. **New top-level `evaluateEnding(allDocs, selections): string[]`.** Runs `evaluateDocument` on the `framework_selection` doc to pick a framework document_id. If null → returns `[]` (caller surfaces "no ending matched"). Otherwise calls `evaluateDocument` on the chosen framework. Replaces today's `ending_logic_rules` flow.

The runtime callers (preview pane + playthrough) switch to `evaluateEnding`.

### Termination + cycles

A logic doc could in principle contain an aggregate chip whose tiebreak doc is the same doc — infinite recursion. Guard:

- Track `evaluatingDocs: Set<EndingDocumentKind>` through the recursion. If an aggregate chip on a tied score would call into a doc already on the stack, return `false` for that chip (matches the "tie unresolved" fallback).

## Static analysis

`src/lib/endings/static-analysis.ts`:

- `staticShadowedRows` / `uncoveredAssignmentsByBlock` gain an optional `tiebreakDocs` parameter (map from `EndingDocumentKind` to "non-empty?"). Callers in `document-editor.tsx` pass the live state.
- Aggregate truth-table change: when an aggregate chip's `aggregate_ref` has a non-empty tiebreak doc for the relevant side (top / bottom), drop the `tie` state from that chip's outcome enumeration. Authors who want to model "tie still uncovered" leave the corresponding tiebreak doc empty.
- The "doc is non-empty" check is intentionally coarse — we're not statically evaluating the tiebreak doc against every assignment to determine if it's *total*. That's a much bigger analysis and not justified for v1.

The Phase 5 tests for tie-uncovered get split: existing cases get `tiebreakDocs: empty` and continue to assert ties uncovered; new cases pass `tiebreakDocs: { class_affinity_top: nonEmpty }` and assert ties drop out.

## Files to add / change

### Schema

- `supabase/migrations/0022_endings_logic_v2.sql` — **new**

### Types + enums

- `src/lib/db/enums.ts` — `ENDING_DOCUMENT_KINDS`, derived `ENDING_LOGIC_KINDS`, labels, `ENDING_LOGIC_RESULT_OPTIONS_BY_KIND`, `ENDING_BLOCK_TYPES`
- `src/lib/db/types.ts` — `EndingDocument`, `EndingBlock` (with `document_id` + `result_value`); drop `EndingFramework`, `EndingFrameworkBlock`, `EndingLogicRule`, `EndingLogicRuleCondition`

### Shared

- `src/app/(authed)/endings/_shared/document-actions.ts` — **new** (unified server actions)
- `src/app/(authed)/endings/_shared/document-editor.tsx` — **new** (generalized editor)
- `src/app/(authed)/endings/_blocks/` — **moved** from `frameworks/blocks/`. `block-list.tsx`, `condition-block.tsx`, `condition-header.tsx`, `condition-row.tsx`, `chip.tsx`, `text-block.tsx` all relocate. Imports updated everywhere.

### Frameworks tab

- `src/app/(authed)/endings/frameworks/page.tsx` — read from `ending_documents` filtered to `kind='framework'`
- `src/app/(authed)/endings/frameworks/workspace.tsx` — call shared actions; pass shared `_blocks/`
- `src/app/(authed)/endings/frameworks/framework-editor.tsx` — thin wrapper around `_shared/document-editor.tsx`, or deleted entirely if the wrapper buys nothing
- `src/app/(authed)/endings/frameworks/framework-list.tsx` — list `kind='framework'` docs
- `src/app/(authed)/endings/frameworks/actions.ts` — re-export shared actions or delete
- `src/app/(authed)/endings/frameworks/preview-view.tsx` — call `evaluateDocument` (for the framework) and optionally `evaluateEnding` for the full top-level preview
- `src/app/(authed)/endings/frameworks/lib/analysis.ts` — pass `tiebreakDocs` through

### Logic tab

- `src/app/(authed)/endings/logic/page.tsx` — fetch all docs + blocks/rows/chips/header-vars
- `src/app/(authed)/endings/logic/logic-editor.tsx` — rewrite with tab shell
- `src/app/(authed)/endings/logic/blocks/result-block.tsx` — **new**
- `src/app/(authed)/endings/logic/_components/tab-bar.tsx` — **new** (or reuse if a shared one exists)
- `src/app/(authed)/endings/logic/actions.ts` — replace with re-exports of shared actions, or delete

### Evaluator + analysis

- `src/lib/endings/evaluator.ts` — `evaluateDocument`, `evaluateEnding`, tiebreak branch in `evaluateAggregateChip`, cycle guard
- `src/lib/endings/evaluator.test.ts` — extend with tiebreak resolution matrix
- `src/lib/endings/static-analysis.ts` — `tiebreakDocs` parameter, aggregate truth-table conditional on doc non-emptiness
- `src/lib/endings/static-analysis.test.ts` — extend

### Tests

- `src/app/(authed)/endings/_shared/document-actions.test.ts` — **new** (replaces `frameworks/actions.test.ts`)
- `tests/integration/endings_logic_v2_constraints.test.ts` — **new**
- `tests/integration/rls.test.ts` — extend with `ending_documents` + renamed block tables
- `tests/e2e/endings-frameworks.spec.ts` — extend with logic-tab flow

## Tests

### Unit (vitest, no DB)

`src/lib/endings/evaluator.test.ts`:

- **`evaluateDocument` matrix** — single text leaf, single result leaf, nested condition+text returns paragraphs, nested condition+result returns the matching value; empty doc returns `[]` / `null`; first-match-wins across rows; cycle guard.
- **Tiebreak resolution matrix.** Class affinity, scores 5-5:
  - Empty `class_affinity_top` doc → `top= proletariat` returns false (today's behaviour).
  - `class_affinity_top` doc resolves to `proletariat` → `top= proletariat` true; `top= gentry` false; `top≠ gentry` true.
  - Nation 3-way tie (folos = emberlyn = spokgrad = 3, pelico = 0, epicenter = 0): doc returns `emberlyn` → `top= emberlyn` true; doc returns `pelico` (non-tied) → fall back to false; doc returns null → fall back to false.
- **Tiebreak only fires on tie.** Scores 5-2 (no tie): tiebreak doc never invoked, even if it would resolve. Pin via a doc that returns `gentry` and assert `top= proletariat` still wins.

`src/lib/endings/static-analysis.test.ts`:

- Existing aggregate "tie uncovered" cases get `tiebreakDocs: emptyMap` and continue passing.
- New case: rows `[top= proletariat]` + `[top= gentry]` with `tiebreakDocs: { class_affinity_top: { isEmpty: false } }` → tie state drops; uncovered count becomes 0.

### Integration (vitest + local Supabase)

`tests/integration/endings_logic_v2_constraints.test.ts`:

- Result block with `result_value = null` rejected by CHECK.
- Text block with `text = null` rejected.
- Condition block with `text` or `result_value` set rejected.
- Block with `parent_block_id` set but `parent_row_id` null rejected.
- 5 seeded singleton docs are present with their deterministic UUIDs.
- Inserting a 6th doc with kind in `('framework_selection', …)` rejected by the partial unique index.
- Framework doc with `name = null` rejected by the kind/name CHECK; logic doc with `name` set rejected.

`tests/integration/rls.test.ts` — extend: anon client cannot read/write any of the renamed tables.

`src/app/(authed)/endings/_shared/document-actions.test.ts` — for each shared action: assert row shape inserted/updated, assert `saveDocument` is UPDATE-only, assert correct paths revalidated. Mock `next/cache` only. Cover the framework-vs-logic kind branches:

- `addBlock({ block_type: 'result' })` on a framework doc → rejected.
- `addBlock({ block_type: 'text' })` on a logic doc → rejected.
- `addBlock({ block_type: 'result', result_value: 'invalid' })` on `class_affinity_top` → rejected.
- `addBlock({ block_type: 'result', result_value: <framework UUID> })` on `framework_selection` → accepted; `result_value` set to the UUID.

### E2E (Playwright)

Extend `tests/e2e/endings-frameworks.spec.ts`:

- Sign in, navigate to `/endings/logic`, confirm 3 tabs render.
- Ending Framework tab: add a row whose chip says `Performer = WINTER ROSE`, set its result block to "Framework A". Save, reload, assert persistence.
- Class Affinity tab: in the Top section, add a wildcard row with result `proletariat`. Save, reload.
- Set up a framework with an aggregate chip `[top= proletariat]`, set preview scores `proletariat = 3, gentry = 3` (tie), confirm the chip now matches because of the tiebreak doc. Empty the tiebreak doc, confirm the chip stops matching.

## Phasing

Land in this order on branch `endings-logic-v2`. Each commit leaves `pnpm typecheck`, `pnpm lint`, and `pnpm test` (unit) green; integration + E2E suites turn green at the steps noted below.

Each step's tests ride **with** the step, not deferred to the end — that's how schema bugs surface immediately and how each commit can be reviewed in isolation.

1. **Schema migration + types/enums.** Apply `0022_endings_logic_v2.sql` against local Supabase. Update `db/types.ts`, `db/enums.ts`.
   - **Tests:** `tests/integration/endings_logic_v2_constraints.test.ts` (rewrite of `endings_v3_constraints.test.ts`) covers the new schema CHECKs + partial unique indexes + seeded singletons.
   - **Tests deferred:** `frameworks/actions.test.ts` (`describe.skip` until step 2 replaces the actions); `tests/e2e/endings-frameworks.spec.ts` (`test.skip` until step 6).
2. **Shared blocks + shared editor + shared actions.** Move `frameworks/blocks/` → `_blocks/`. Build `_shared/document-actions.ts` and `_shared/document-editor.tsx`. Frameworks workspace switches over (no user-visible change).
   - **Tests:** `_shared/document-actions.test.ts` — for each shared action assert row shape inserted/updated, `saveDocument` is UPDATE-only, correct paths revalidated, kind-aware validation (text leaf rejected on logic doc; result leaf rejected on framework doc; invalid `result_value` rejected per kind).
3. **Logic page rewrite (skeleton).** Tab shell, result block, three tabs. No tiebreak wiring yet — evaluator still returns `false` on tie. The playthrough flow temporarily falls back to "first framework wins" if `framework_selection` doc has no matching row.
   - **Tests:** none new (UI-only; covered by step 6 E2E).
4. **Evaluator + static analysis tiebreak.** Generalize `evaluateFramework` → `evaluateDocument`. Wire `evaluateAggregateChip` to consult tiebreak docs; update static-analysis truth-table.
   - **Tests:** `src/lib/endings/evaluator.test.ts` — `evaluateDocument` matrix (text leaf, result leaf, nested, empty, first-match-wins, cycle guard) + tiebreak resolution matrix (empty doc → false, doc resolves to tied option → true, doc returns non-tied option → false, tie-only-fires-on-tie). `src/lib/endings/static-analysis.test.ts` — existing tie-uncovered cases pass `tiebreakDocs: emptyMap`; new case with a non-empty `class_affinity_top` doc drops the tie state.
5. **Top-level `evaluateEnding`.** Replace the playthrough's framework-selection logic with `framework_selection` doc evaluation. Remove the temporary fallback from step 3.
   - **Tests:** evaluator test extended with `evaluateEnding` cases (no matching row → empty paragraphs; matching row picks framework; chosen framework renders).
6. **E2E rewrite.** Rewrite `tests/e2e/endings-frameworks.spec.ts` (or split into a new `endings-logic.spec.ts`) for the unified shape: 3 logic tabs render; Ending Framework tab persists a row + result; tiebreak doc populated → aggregate chip matches on tied scores; emptied → falls back.
   - **Tests:** the rewrite itself.

One branch, six commits, one PR at the end.

## Verification

After all steps:

- `pnpm typecheck` clean.
- `pnpm lint` baseline unchanged.
- `pnpm test` green; new tiebreak + evaluator + static-analysis cases.
- `pnpm test:int` green; new constraints + RLS.
- `pnpm test:e2e` green; new logic-tab spec.
- `pnpm dev` walkthrough:
  - Logic page: 3 tabs render. Ending Framework tab opens by default. Affinity tabs show Top + Bottom sections.
  - Frameworks page: unchanged user-visible behaviour. Existing flows for creating frameworks, adding text/condition blocks, and previewing all work.
  - Build a framework with `[top= proletariat]`. Set scores 5-5. Without a tiebreak doc row, chip is false. Add a row to `class_affinity_top` returning `proletariat`. Chip now true. Remove that row. Chip false again.
  - Build the framework selection doc with one wildcard row → `Framework A`. Confirm playthrough renders Framework A. Add a higher-priority row `[Performer = WINTER ROSE] → Framework B`, set the variable, confirm Framework B renders.

## Out of scope (followups)

### Active — discussed but not shipped

- **Nation affinity cardinality split.** Deferred — explicitly future work as of 2026-05-06. Subdivide `nation_affinity_top` / `nation_affinity_bottom` into 2-way / 3-way / 4-way / 5-way tie sections. Sketched as Option A (separate `nation_affinity_{top,bottom}_{2,3,4,5}way` doc kinds; evaluator picks by `tiedCount`). Class affinity is unaffected (only 2 options).
- **Step 5 — top-level `evaluateEnding`.** Wire the `framework_selection` doc into the playthrough so it actually picks the framework at game-end, and expand `__random_all__` for that doc at runtime. The dropped `ending_logic_rules` flow has no replacement at the runtime layer yet — authors can configure `framework_selection` but no caller consumes it.
- **Step 6 — E2E rewrite.** `tests/e2e/endings-frameworks.spec.ts` is currently `test.skip` on every test. Rewrite for the unified shape: 3 logic tabs render, persistence per tab, tiebreak resolution end-to-end via the framework preview, fallback usage on each fallback-bearing doc.

### Smaller polish + cleanup

- **`pnpm db:migrate` env-file convenience.** Switch `package.json`'s `db:migrate` script from plain `tsx scripts/apply-migration.ts` to `tsx --env-file=.env.local scripts/apply-migration.ts`. We agreed to hold for a separate PR. Without it, you currently have to `set -a; source .env.local; set +a; pnpm db:migrate`.
- **Move `inspection/letters/workspace.tsx` to use the shared `src/components/impact-tile.tsx`.** That file ships its own local `ClassTile` / `NationTile` / `CounterInput` for now; the shared module was added during the framework-preview tile work but only the preview consumes it. Mechanical cleanup, low risk.
- **Inline variable creation in the frameworks editor.** Today the chip picker only selects preexisting variables — authors have to leave the editor, create a variable on the Variables tab, then come back. Add an inline "+ New variable" path in the chip picker (and the header-variable picker). Same shape as the existing `createVariableInline` / `createValueInline` used in the pre-rebuild logic editor — pull those server actions forward.

### Out of scope long-term (named for completeness)

- **Tiebreak doc completeness analysis.** Statically prove the doc covers every tied assignment, drop the lower-bound caveat. v1 only checks "doc has rows or fallback set".
- **Per-storyline tiebreak.** A storyline could in theory carry its own tiebreak override. Not requested.
- **Logic doc preview pane** (richer). Today's `LogicPreviewView` shows a basic "Resolves to" line per kind. Could add overlap/shadow badges, fallback indication, etc.
- **Drag-drop reorder for header variables.** Master plan §Followups carry-over.
- **Manual color picker** for variables. Still pending.
- **Per-key reroll polish.** Surgical reroll works; a future polish could animate the value swap or remember reroll history.
- **Autosave / collaborative editing.** Master plan §Followups — separate effort. The unified primitive shares the framework save model and rides the same future migration.
- **Autosave / collaborative editing.** Master plan §Followups — separate effort. The unified primitive shares the framework save model and rides the same future migration.
