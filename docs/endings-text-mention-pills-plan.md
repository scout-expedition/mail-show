# Plan: pill chrome for `@[Name]` tokens in text blocks (Phase 3)

## Context

Phase 1 (PR #37) shipped `@[Variable Name]` substitution at preview time. Phase 2 (PR #38) added an autocomplete popup that inserts the literal `@[Name]` string into a plain textarea. Phase 3 is the final UX pass: render committed `@[Name]` tokens as colored **pills** (matching `VariableChip` in condition-block headers) inside the authoring editor, instead of leaving them as raw text.

Today's authoring surface uses `MentionTextarea` — a plain `<textarea>` with an autocomplete popup. Plain text only; tokens look like `@[Variable Name]`. Phase 3 replaces the textarea with a contenteditable editor that renders tokens as inline pills while still serializing to the same `@[Name]` strings stored in `ending_blocks.text`. No DB changes.

**Mid-implementation scope drift**: the original plan said "no evaluator change," but the preview-coloring feature added mid-PR (color resolved values blue, unresolved literals amber) required the evaluator to emit `paragraphSegments: SubstitutionSegment[][]` alongside `paragraphs: string[]` on `DocumentEvaluation`. Existing string consumers are unchanged; this is an additive field. The Phase 1 substitution behavior is byte-identical.

Intended outcome:
- A text block's body renders as a mix of plain text and inline pills.
- Typing `@` still triggers the autocomplete popup (same UX as Phase 2); committing a candidate inserts a pill node instead of a text token.
- Backspacing into a pill deletes the whole pill (atomic node behavior).
- Existing text blocks with `@[Name]` tokens in the DB render with pills on first load.
- Saving still writes `@[Name]` strings to the DB — no migration, no evaluator change.

## Approach

### 1. Editor library: Lexical

Adopt **Lexical** (Meta-maintained, framework-agnostic core, `@lexical/react` for bindings). The bundle-size and React-19-support claims below are approximate — verify exact numbers during install, before merging.

Reasons:

- Bundle: Lexical core + react bindings is meaningfully smaller than TipTap's ProseMirror foundation. The exact gzipped chunk size will be visible after installing — pin a real number in the PR description, don't take this plan's estimate as gospel.
- React 19: Lexical's recent releases advertise React 19 support. Confirm at install by reading the package's `peerDependencies` and running a smoke build before committing further.
- Explicit editor-state model — easier to reason about serialization than ProseMirror.
- Custom node classes are first-class; the mention-node pattern is well-documented in their playground.

A custom `contenteditable` was considered and rejected: pill-as-atomic-node + autocomplete + clipboard handoff together justify a maintained framework. Slate and Plate were also considered; Lexical's `DecoratorNode` API is the cleanest match for "atomic inline pill."

Packages to add:
- `lexical`
- `@lexical/react`
- `@lexical/utils` (helpers for $-node creation, range manipulation)

### 2. New files

- `src/app/(authed)/endings/_blocks/lexical/mention-node.ts` — custom `MentionNode` class extending `DecoratorNode<React.ReactNode>`. Each node carries `variableName: string` (and optionally the cached variable id for color lookup). `decorate()` renders the pill JSX. `getTextContent()` returns `@[${variableName}]` so plain-text serialization is free.
- `src/app/(authed)/endings/_blocks/lexical/serialize.ts` — pure helpers:
  - `lexicalRootToText(root: SerializedEditorState): string` — walks the editor state and returns the canonical `@[Name]` plain-text representation.
  - `parseTextToNodes(text: string): SerializedLexicalNode[]` — splits a `text` string on the `@[Name]` regex (reusing the existing `TOKEN_RE` from text-substitution.ts) and produces a flat array of `TextNode` + `MentionNode` payloads suitable for `editor.update(() => { ... })` import on first mount.
- `src/app/(authed)/endings/_blocks/lexical/mention-trigger-plugin.tsx` — Lexical plugin that reuses `detectMentionTrigger` + `MentionAutocomplete` popup (already built in Phase 2). On `@` keystroke, opens the popup; commit inserts a `MentionNode` via Lexical's API. The existing `commitMentionToken` helper is no longer needed.
- `src/app/(authed)/endings/_blocks/lexical/text-block-editor.tsx` — the React component that wraps `LexicalComposer`, `RichTextPlugin`, the mention-trigger plugin, an `OnChangePlugin` that serializes back to plain text and calls `onChange`, and an initial-state setup that calls `parseTextToNodes` on mount.

### 3. Files to modify

- `src/app/(authed)/endings/_blocks/text-block.tsx` — swap `MentionTextarea` for `<LexicalTextBlockEditor value={block.text} onChange={onChange} variables={variables} ... />`. Drag/collapse/header chrome unchanged. The grip in the header has its own explicit `draggable` element (line 100), so the contenteditable body does not interfere with the card-level drag.
- `src/app/(authed)/endings/_blocks/mention-autocomplete.tsx` — explicit cleanup list:
  - **Keep**: `detectMentionTrigger`, `filterVariablesForMention`. Both reused by the Lexical plugin.
  - **Export** (currently private): the popup component (`MentionPopup` → rename to `MentionAutocompletePopup` and export). It's currently hard-wired to anchor under a textarea wrapper; refactor it to accept absolute pixel coordinates (`top`, `left`) so the Lexical plugin can position it at the caret rather than under a parent element.
  - **Remove**: `MentionTextarea` (component + auto-grow logic + ref/blur handling + the wrapper `<div className="relative">`). Also remove the textarea-specific imports it pulled in.
  - **Remove**: `commitMentionToken` helper (replaced by an `editor.update` call inside the Lexical plugin).
- `src/app/(authed)/endings/_blocks/mention-autocomplete.test.ts` — explicit cleanup:
  - **Keep**: the `detectMentionTrigger` (12 cases) and `filterVariablesForMention` (8 cases) suites.
  - **Remove**: the `commitMentionToken` suite (6 cases). Those scenarios are replaced by the Lexical `editor.update` path covered in the new editor-interaction tests.
- `src/lib/endings/text-substitution.ts` — **export `TOKEN_RE`** (or add a `matchVariableTokens(text)` helper that returns range objects). Today's `TOKEN_RE` is a file-private `const`; the new parser needs it.
- `package.json` — add `lexical`, `@lexical/react`, `@lexical/utils` (runtime deps); `@testing-library/react`, `jsdom` (devDependencies for interaction tests).

### 4. Pill rendering

Mirror `VariableChip` styling (`src/app/(authed)/endings/_blocks/chip.tsx:405-435`). The pill is a `<span>` with:

- `inline-flex items-center rounded-md px-1.5 text-[10px] font-mono font-semibold uppercase tracking-[0.025em]`
- Background = `variable.color_hex ?? paletteColor(variable.color_index)`
- Text color = `var(--block-card)` (so it pops on dark backgrounds)

If the variable name doesn't resolve (typo, deleted variable), render a "missing" pill: amber border, no fill, with the literal name inside. Authors can still see + edit the token; preview substitution will leave it literal too.

Pills are **atomic** — caret never enters them. Lexical's `DecoratorNode` handles this for free.

### 5. Serialization contract

Round-trip invariant: `lexicalRootToText(editorState)` must produce the exact `@[Name]` string format today's textarea would have produced. Implemented as a **fully custom walker**, not via Lexical's default `getTextContent()` on root — that would emit `\n\n` between paragraphs in some plugin configurations, which would silently change saved content.

The walker:
- Iterates root children (paragraphs).
- For each paragraph, iterates inline children:
  - `TextNode` → `node.getTextContent()` verbatim.
  - `MentionNode` → `@[${variableName}]`.
- Joins paragraph outputs with a single `\n` (matches today's textarea, which inserts `\n` on Enter).

`parseTextToNodes` is the inverse:
- Reuses the regex from `text-substitution.ts`. **Prerequisite**: that file currently keeps `TOKEN_RE` as a file-private `const`. Export it (or expose a `matchVariableTokens(text)` helper that returns `{ start, end, name }` ranges) so both the evaluator and the editor see the same tokens.
- For each match: emit a `MentionNode({ variableName: match[1] })`.
- For non-match segments: split on `\n` and emit paragraphs of `TextNode`s.

Whitespace fidelity is a real concern (Codex review of the plan flagged it). The serialization tests explicitly cover: leading/trailing whitespace, blank paragraphs, decorator-at-paragraph-edge, multi-newline runs.

### 6. Existing text-block content

No migration needed. On first mount of an existing text block, `parseTextToNodes` consumes the stored `text` and produces the initial Lexical editor state — pills appear in place of `@[Name]` tokens, plain prose around them. Authors see pills immediately; the DB still holds the same strings.

### 7. Save flow

Lexical's `OnChangePlugin` fires after every edit. We serialize the root and call the existing `onChange(text: string)` prop. The rest of the save flow (dirty flag, manual save button) is unchanged.

### 8. Autocomplete reuse

The autocomplete **logic** (`detectMentionTrigger`, `filterVariablesForMention`, the kind-grouped list with dividers) is reused unchanged. The popup **component** needs refactoring:

- Today's popup is a file-private function inside `mention-autocomplete.tsx`, with TWO hard-wired render paths both using `absolute left-0 top-full`:
  1. The `<ul role="listbox">` branch (lines ~136–185 in current file) for the populated list.
  2. The `<div>` "No matching variables." fallback (lines ~122–127) when filtered is empty.
- Export it (renamed to make its public role clear) and widen its props to accept absolute pixel coordinates (`top`, `left`). Both render paths must use those coords so the empty-results fallback positions correctly at the caret too.
- The textarea version stays out of `_blocks/`; only the popup remains.

The new plugin replaces the trigger-detection + commit-splice plumbing:

- Trigger detection: still uses `detectMentionTrigger`, but reads `text` and caret offset from Lexical's selection API instead of `textarea.selectionStart`.
- Commit: instead of `commitMentionToken` (text splice), the plugin calls `editor.update(() => { ... })` and uses Lexical's `$createMentionNode` + selection-replace APIs.

### 9. Backspace / cut / paste / clipboard

- **Backspace at the right edge of a pill**: Lexical's `DecoratorNode` defaults to deleting the whole pill. Selection-edge behavior has had bugs historically in Lexical; we add interaction tests (see §11) for the arrow-key and backspace edge cases at pill boundaries.
- **Click inside pill**: caret snaps to nearest edge.
- **Copy**: Lexical writes **three** clipboard formats: `text/plain`, `text/html`, and a custom `application/x-lexical-editor` MIME for in-editor rich-state round-trip. For the `text/plain` payload, register a custom plain-text serializer so pills emit `@[Name]` (matches our DB format). For in-editor paste, Lexical reads the custom MIME and recreates the pill nodes directly — no parse required.
- **Paste from outside our editor** (any source emitting `text/plain` with `@[Name]` patterns in it): register a Lexical paste handler that intercepts the `text/plain` payload and runs `parseTextToNodes` on it before insertion. This converts inline `@[Name]` strings into pills as the paste lands.
- **Initial parse on mount** is the only other conversion site. We intentionally do **NOT** convert literal keyboard-typed `@[Name]` to pills on the fly — that would either fight the user's caret or race with the Save button reading stale state (Codex review of the plan flagged this). Authors who type `@[Name]` literally see plain text; the autocomplete is the primary entry point for pills. On the next save + reload, the literal token re-parses into a pill on mount.

### 10. Auto-grow

Lexical's `ContentEditable` is a `<div contenteditable>`. It grows with content naturally (no `style.height = scrollHeight` dance needed). Set `min-height` to roughly 2 lines worth — matching the textarea's `rows={2}` minimum — and let CSS do the rest.

### 11. Tests

The risky surfaces (selection-edge behavior, paste handling, blur ordering) deserve interaction coverage, not just headless pure-function tests. `vitest.config.ts` already supports per-file opt-in jsdom via the `// @vitest-environment jsdom` pragma, and `@testing-library/jest-dom` is already a devDependency — only missing pieces are `@testing-library/react` and `jsdom` itself. Install both.

- **Serialization** (`serialize.test.ts`, node env): round-trip cases for `parseTextToNodes` → `lexicalRootToText`. Cover: pure text, single mention, mention mid-sentence, adjacent mentions `@[A]@[B]`, multiple paragraphs, **leading/trailing whitespace**, **blank paragraphs**, **decorator at paragraph edge**, **multi-newline runs**, **no tokens**.
- **Mention node** (`mention-node.test.ts`, node env): `getTextContent()`, `clone()`, basic node lifecycle with a headless Lexical editor instance.
- **Editor interaction** (`text-block-editor.test.tsx`, jsdom env via top-of-file pragma): renders `<LexicalTextBlockEditor>` with a controlled `onChange` and asserts behavior for:
  - Initial parse: passing `value="Hi @[Bob]."` results in a paragraph with `[TextNode("Hi "), MentionNode(Bob), TextNode(".")]`.
  - Backspace at right edge of a pill removes the whole pill.
  - Arrow-right past a pill lands the caret on the text after, not inside.
  - **Arrow-left from text immediately after a pill lands the caret on the text before, not inside.** (Symmetric to arrow-right; Lexical decorator-edge bugs are historically symmetric.)
  - Pasting `text/plain` containing `@[Name]` converts it to a pill in-place.
  - **Undo (Ctrl/Cmd+Z) after a pill insert removes the pill cleanly, leaving the editor in the pre-insert state.** (Lexical's undo stack can re-enter decorator interiors when merge configs are wrong.)
  - `onChange` fires with the round-tripped plain-text after each edit.
  - Mount does not fire a spurious `onChange` (initial-state-as-init, not initial-state-as-update).
- **Pure helpers** carried over from Phase 2 (`detectMentionTrigger`, `filterVariablesForMention`) — keep their existing node-env tests; they're reused as-is.
- Visual smoke test still required for end-to-end UX.

## Verification

1. `pnpm typecheck` clean.
2. `pnpm test` — full unit suite, including new serialization + mention-node tests.
3. `pnpm dev`, navigate to `/endings/frameworks`:
   - **New text block**: type `@`, autocomplete opens (same UX as Phase 2). Pick a variable → a colored pill appears inline. Type more prose around it.
   - **Existing text block** (one of the blocks created in Phase 1/2 smoke tests with `@[Mainstage Performer]`): reload the page. The text block should now render the token as a pill instead of literal `@[...]` text.
   - **Save + reload**: pill content survives a save → reload cycle.
   - **Backspace into pill**: deletes the whole pill.
   - **Click inside pill**: caret snaps to an edge, doesn't enter.
   - **Type `@[Bogus]` literally** (without using autocomplete) and save. **Note**: literal-typed tokens stay as plain text in the editor until next save+reload — by design (see §9). After save+reload, the bogus name renders as a "missing" pill (amber border). Preview still leaves it literal — Phase 1 behavior unchanged.
   - **Type `@[Mainstage Performer]` literally** for a known variable, then save+reload. Confirm it now renders as a pill (this is the "convert on initial parse" path).
   - **Copy a pill, paste it**: source `@[Name]` string survives on the clipboard; paste produces a new pill.
   - **Drag/reorder, collapse, summary input**: all unchanged from Phase 2.
4. **Regression**: preview output should be byte-identical to Phase 2 for any saved text block (we changed only how the body renders in the editor, not what's stored or substituted).

## Risks + open questions

- **Bundle size**: pin the real gzipped chunk size in the PR description after install. The endings authoring surface is admin-only; not loading on customer pages because `_blocks/` only imports into routes under `src/app/(authed)/endings/**` (confirmed by Codex's reverse-import sweep).
- **SSR / hydration**: Lexical is client-only. The text block already lives inside `"use client"` components (the whole `_blocks/` tree), so this is a no-op — but verify there's no SSR import path that pulls Lexical into a server bundle.
- **Mobile / touch**: contenteditable mobile behavior is fragile. The authoring surface is desktop-focused per CLAUDE.md, so mobile is a known non-goal — but the pill atomic-node behavior should still feel sensible on touch.
- **Cursor placement after pill insert**: Lexical's selection API needs explicit caret-after-node placement post-commit. Wire it correctly or the user types into the pill.
- **`OnChangePlugin` first-fire race**: initialize the editor's state via the `LexicalComposer` `initialEditorState` config (which runs before `OnChangePlugin` subscribes), NOT via a mount-time `editor.update`. That avoids a fake first onChange dirtying the doc.
- **Selection edge cases at pill boundaries**: Lexical's `DecoratorNode` has historically had bugs around arrow/backspace at decorator edges. The new jsdom interaction tests cover these explicitly.
- **Pill-from-literal-typing is intentionally deferred to next mount**: avoids the Save/blur race (Save reads React state from `DocumentEditor`; a blur-triggered conversion lands after Save serializes if focus moves to the Save button). Authors who want immediate pills should use the autocomplete; the next save + reload converts any stray literal tokens.

## Followups (out of scope for this PR — file as separate issues)

- **Accessibility** — explicit `aria-activedescendant` wiring on the editor + screen-reader announcements for autocomplete navigation. Codex flagged this on PR #38; bundling with Phase 3's larger surface area lets us address it once on the new editor.
- **Pill hover affordance** — show the variable's current preview value as a tooltip on hover. Nice-to-have.
- **Variable rename propagation** — today renames break `@[Name]` references. Could add a name-change migration helper, or switch storage to `@{uuid}` format with a one-off backfill. Decided against in Phase 1; revisit if rename frequency increases.
