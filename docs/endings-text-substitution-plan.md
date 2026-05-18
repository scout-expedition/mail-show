# Plan: variable substitution in text blocks via `@[Name]` syntax (Phase 1)

## Context

Authors want to interpolate variable values into text-block prose so preview shows context-sensitive copy. Today text blocks render their `text` column verbatim; the evaluator pushes `b.text` straight onto the output array (`src/lib/endings/evaluator.ts:917-920`).

User request:
> "The concert was headlined by @[Mainstage Performer]" → "The concert was headlined by Winterose"

Phase 1 ships the substitution itself: any `@[Variable Name]` token in a text block's body resolves to that variable's current value at preview/evaluate time. The authoring textarea stays a plain textarea — authors type the syntax by hand for now.

Phases 2 (autocomplete popup on `@` keystroke) and 3 (pill-chrome rendering of `@[Name]` in the authoring editor) are explicit followups, listed at the bottom.

## Approach

### 1. New helper: `src/lib/endings/text-substitution.ts`

Pure function, no React, no DB:

```ts
export function substituteVariables(
  text: string,
  ctx: {
    variableByName: Map<string, EvalVariable>;
    selections: PreviewSelections;
    valuesById: Map<string, string>; // ending_variable_values.id → .value (label)
  }
): string
```

Scans for `(?<![A-Za-z0-9@])@\[([^\]]+)\]` — the negative lookbehind keeps `email@[host.com]` and `@@[Name]` from triggering substitution while still allowing `@[Name]` at start of string, after whitespace, or after punctuation. For each match, resolve by exact (case-sensitive) name lookup against `variableByName`. Behavior per kind:

- **`text`**: `ctx.valuesById.get(selections.textValueIds[var.id])` → if present, substitute; if unset, leave the literal `@[Name]` token in place so the author can spot it.
- **`number_ref`**: `selections.numbers[var.id]` → stringify if non-null, else leave literal.
- **`aggregate_ref`**: read `selections.resolved_aggregates?.get(aggKey(var))` (the winning column name). Map through `VARIABLE_LABELS` from `src/lib/playthrough/variables.ts:38-49` for the display label; fall back to the raw column name.
- **Variable not found by name**: leave literal `@[Name]`.

Edge cases captured in tests (see §5).

### 2. Thread `values` into `EvalInputs` — `src/lib/endings/evaluator.ts`

`EvalInputs` (line 570) currently has `blocks, rows, chips, variables, selections`. Add:

```ts
values?: EndingVariableValue[];
```

Optional so existing callers don't break. Build `valuesById` once in `buildIndexes` (line 585) and stash it on `Indexes` alongside `variableById`. Also build `variableByName: Map<string, EvalVariable>` there.

### 3. Hook substitution into `renderBlocks` — `src/lib/endings/evaluator.ts:917`

Replace the bare push with a call through `substituteVariables`:

```ts
if (b.block_type === "text") {
  const trimmed = b.text.trim();
  if (trimmed.length > 0) {
    out.push(
      substituteVariables(b.text, {
        variableByName: indexes.variableByName,
        selections,
        valuesById: indexes.valuesById,
      })
    );
  }
  continue;
}
```

Substitution runs on every text-block render path — `evaluateFramework`, `evaluateDocument`, the static-analysis helpers — because they all funnel through `renderBlocks`.

### 4. Wire `values` from the framework preview surface

Only `src/app/(authed)/endings/frameworks/preview-view.tsx` needs the new `values` field. It already receives `values: EndingVariableValue[]` from the page loader — passing it into the evaluator `useMemo` is a one-line change.

**Logic preview is intentionally skipped.** Text blocks are rejected by both `addBlock` and `saveDocument` when `kind !== "framework"` (`document-actions.ts:328`, `:1480`). Substitution only runs on text blocks, so the code path is unreachable on logic docs — wiring `values` or `resolved_aggregates` there would be dead code. If logic docs ever allow text blocks, mirror the framework wiring then.

Static analysis is also unaffected: it builds its own `StaticInputs` shape (`document-editor.tsx:467,475`) and goes through `variableDomain()` / `shadowedRowIds`, not the substitution-aware `renderBlocks`. The optional `values?` field on `EvalInputs` is type-safe for those call sites without changes.

### 5. Tests — `src/lib/endings/evaluator.test.ts`

Add a new `describe` block, mirroring the existing `evaluateFramework` shape (helpers at lines 96-135 already produce minimal `EvalBlock` / `EvalChip` / `EvalVariable` literals):

- text var with a selected value → substitutes label
- text var with no selection → leaves literal `@[Name]`
- number_ref var → substitutes stringified number
- aggregate_ref var with pre-resolved winner → substitutes the `VARIABLE_LABELS` label
- unknown variable name (typo) → leaves literal
- multiple tokens in same text → all substituted
- token mid-sentence: `"Hello @[Name], welcome"` → `"Hello Bob, welcome"`
- empty brackets `@[]` → left literal (regex requires at least one char inside)
- nested brackets impossible since regex stops at first `]` — token `@[Foo[Bar]]` resolves `Foo[Bar` (not a real name → literal)
- false-match resistance: `email@[host.com]` and `@@[Name]` are left literal because the negative lookbehind blocks the leading `@` after a word char or another `@`
- token after punctuation: `Hello, @[Name]!` → substitution still works (the comma+space precedes `@`)

### Files to modify

- `src/lib/endings/text-substitution.ts` *(new)*
- `src/lib/endings/evaluator.ts` — `EvalInputs.values`, `Indexes.valuesById`, `Indexes.variableByName`, `renderBlocks` hook
- `src/lib/endings/evaluator.test.ts` — new substitution suite
- `src/app/(authed)/endings/frameworks/preview-view.tsx` — pass `values` into evaluator call (logic preview is skipped; see §4)

### Reused utilities

- `VARIABLE_LABELS` — `src/lib/playthrough/variables.ts:38-49` for aggregate column → display label
- `aggKey()` — `src/lib/endings/evaluator.ts:127` for building the `resolved_aggregates` key
- `PreviewSelections`, `EvalVariable`, `EvalInputs` types from `src/lib/endings/evaluator.ts`
- `EndingVariableValue` from `src/lib/db/types.ts`

### No DB / migration

`@[Name]` is stored verbatim in `ending_blocks.text`. No schema change, no migration. `ending_variables.name` already has a `UNIQUE` constraint (`supabase/migrations/0009_endings.sql:19`), so the name→variable Map can't silently collide.

### Performance note

`buildIndexes` runs on every preview state change (each dropdown click, each numeric input keystroke), so the new `variableByName` Map allocates per render. The maps are small (one entry per variable, typically <20), so this is fine in practice — flagging for future profiling, not blocking.

### Storage trade-off (decided)

Storing by **name**, not ID. Pros: human-readable in the DB, copy-paste between blocks works, no autocomplete dependency in Phase 1. Con: renaming a variable breaks references. Acceptable for Phase 1; if rename-stability becomes painful, migrate to `@{uuid}` storage with a one-off backfill — that work pairs naturally with Phase 3's rich editor.

## Verification

1. `pnpm typecheck` clean.
2. `pnpm test src/lib/endings/evaluator.test.ts` — new substitution tests pass.
3. `pnpm dev`, open `/endings/frameworks`:
   - Pick an existing framework (or create one).
   - In a variable (e.g. `Mainstage Performer`) add two values: `Winterose`, `Iron Heron`.
   - Add a text block with body `The concert was headlined by @[Mainstage Performer].`
   - Save, open Preview tab, select `Winterose` for the variable.
   - Confirm preview shows `The concert was headlined by Winterose.`
   - Switch to `Iron Heron`, confirm preview updates.
4. Typo handling: edit text to `@[Bogus Variable]`, save, preview. Should render literal `@[Bogus Variable]`.
5. Cross-doc: repeat the smoke test on `/endings/logic` (Ending tab) — the same `DocumentEditor`/preview path drives it.
6. Aggregate vars (optional but valuable): with a class-affinity variable, add `Class results: @[Class Affinity].` to a text block. In preview, set the impact column inputs so a class wins; confirm the rendered text shows the class label (e.g. `Working Class`).

## Phase 2 & 3 (out of scope for this PR — file as separate issues after merge)

- **Phase 2 — Autocomplete popup.** On `@` keystroke in the text-block textarea, open a floating popup positioned at the caret. List filtered variables from `DocumentEditor`'s `variables` prop (already available, just needs to be threaded down to `TextBlock`). Enter/click commits `@[Variable Name]` at the caret. Plain textarea stays; popup is a sibling positioned-absolute React component. Pattern: mirror the existing `AddHeaderVariablePicker` (`src/app/(authed)/endings/_blocks/condition-block.tsx:852-980`) but trigger off `@` instead of a button.
- **Phase 3 — Pill chrome in the editor.** Replace `AutoTextarea` with a contenteditable editor (Lexical recommended — actively maintained, framework-native, custom-node API fits mentions). Add a `Mention` node that renders `@[Name]` tokens as `VariableChip` pills (`src/app/(authed)/endings/_blocks/chip.tsx:405-435`) using the variable's `color_hex`/`color_index`. Serialize to the existing `@[Name]` string format on save so the storage shape stays compatible. Adds one dependency (`lexical` + `@lexical/react`).
