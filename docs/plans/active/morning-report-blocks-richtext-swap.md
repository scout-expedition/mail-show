# Morning-report blocks: swap MarkdownTextarea → RichTextEditor

## Context

Commit `26a066e` (feat(content): WYSIWYG rich-text editor for letter & report content) replaced `MarkdownTextarea` with the Lexical-based `RichTextEditor` (`src/components/rich-text/rich-text-editor.tsx`) on the inspector panels for letter `content` and report-segment `content` — see workspace.tsx:3465 (`LetterEditorCard`) and workspace.tsx:3964 (`LetterSegmentCard`).

The Morning Reports page (`/top-of-day/morning-reports`) shipped before that change in PR #55 and was never re-pointed. Its three editable block components (`ReportBlock`, `GenericReportBlock`, `PinnedBlock`) still mount `MarkdownTextarea`, so the same field that renders as bold/italic/strikethrough/lists in the inspector renders as raw `**markers**`/`_underscores_` in the morning-report editor — the visible mismatch you noticed. The authoring preview (`preview-view.tsx`) likewise renders body content as raw text in a `<pre>`, so Lexical-JSON content saved from the inspector would surface as JSON in the preview today.

A grep confirms `MarkdownTextarea` and `BLOCK_TEXTAREA_CLASS` are now used **only** by the three morning-report block files — switching them removes the last consumers of both.

## Change

Replace `MarkdownTextarea` with `RichTextEditor` in the three Morning-Reports block components, and replace the `<pre>`-based `PreviewBody` with `RichTextReadonly` so the live preview renders the same content the inspector saves. Match the inspector's call-site shape (`className={cn("font-mono text-xs", GHOST_FIELD)}`, editor-owned `onFocus`/`onBlur`), keep the morning-report blocks' compact `minRows={2}` (not the inspector's 8 — these blocks are list rows, not focused editing surfaces).

`RichTextEditor.value` is typed `string | null | undefined` and its docstring explicitly accepts "Lexical editor-state JSON, or legacy Markdown/plain text" — so the wire shape stays a `string`, no DB/types change, and existing markdown rows hydrate cleanly via `buildInitialEditorStateJSON`.

## Files to modify

- `src/app/(authed)/top-of-day/morning-reports/_blocks/report-block.tsx` (lines 10–15, 120–126)
  - Drop `BLOCK_TEXTAREA_CLASS` + `MarkdownTextarea` imports; import `RichTextEditor` from `@/components/rich-text/rich-text-editor` and `GHOST_FIELD` from `@/components/panel`.
  - Replace the `<div onFocus onBlur><MarkdownTextarea …/></div>` wrapper with `<RichTextEditor value onChange onFocus onBlur minRows={2} className={cn("font-mono text-xs", GHOST_FIELD)} />`. Use the editor's own `onFocus`/`onBlur` props — no wrapper div needed.

- `src/app/(authed)/top-of-day/morning-reports/_blocks/generic-report-block.tsx` (lines 12–17, 138–148)
  - Same swap. Keep the `FieldHighlight` wrapper, drop the inner `<div onFocus onBlur>`.

- `src/app/(authed)/top-of-day/morning-reports/_blocks/pinned-block.tsx` (lines 9–10, 77–86)
  - Same swap.

- `src/app/(authed)/top-of-day/morning-reports/preview-view.tsx` (lines 347–358, plus an import for `RichTextReadonly`)
  - Replace `PreviewBody`'s `<pre>` with `<RichTextReadonly value={body} className="min-h-[3rem] rounded-md bg-[var(--block-result-bg)] px-3 py-2 font-mono text-sm text-foreground" emptyFallback={<span className="italic text-muted-foreground/50">(empty)</span>} />`. This mirrors `/days/[identifier]/top-of-day/page.tsx:188`, which is already the read-only consumer of the same field.
  - **All visual classes (`min-h-[3rem]`, `rounded-md`, `bg-[var(--block-result-bg)]`, `px-3 py-2`, `font-mono`, `text-sm`, `text-foreground`) must be passed via `className` — `RichTextReadonly` only forwards `className` to its outer `<div>` and applies only `whitespace-pre-wrap break-words outline-none` to the inner `ContentEditable`. Without this, the preview loses its black fill, padding, monospace font, and rounded chrome.**

- `src/app/(authed)/top-of-day/morning-reports/_blocks/block-shell.tsx` (lines 22–28)
  - Delete the now-unused `BLOCK_TEXTAREA_CLASS` export.

- `src/components/markdown-textarea.tsx` (whole file)
  - Delete — no remaining consumers after the swap (verified via grep across `src/`). Removes the last vestige of the markdown era so it can't be re-adopted by accident.

## Reused, do not re-implement

- `RichTextEditor` (`src/components/rich-text/rich-text-editor.tsx`) — the same component the inspector uses; props `{ value, onChange, onFocus, onBlur, minRows, placeholder, className }`. Already covers legacy-markdown hydration and Lexical JSON round-trip.
- `RichTextReadonly` (`src/components/rich-text/rich-text-readonly.tsx`) — for the preview pane.
- `GHOST_FIELD` (`src/components/panel.tsx:23`) — the same input-chrome token the inspector applies to `RichTextEditor`.

## Verification

1. `pnpm typecheck` — confirms the prop signature swap (`onChange(event)` → `onChange(next: string)`) is clean.
2. `pnpm lint`.
3. `pnpm dev`, then in the browser:
   - `/inspection/letters` → pick a report segment, type **bold**, save (autosaves). Confirm rendered bold.
   - `/top-of-day/morning-reports` → find the same segment's block. The body should render the bold as bold (matching the inspector), not as `**bold**`. Editing inline should show the same WYSIWYG behaviour. Try Pinned (intro / sign-off), Generic, and Letter-Group → ReportBlock variants.
   - The right-pane preview on the same page should render formatting (not raw text or JSON).
4. Sanity-check the `/days/[identifier]/top-of-day` read-only view — already on `RichTextReadonly`, so it shouldn't change.
5. `pnpm test src/components/rich-text/rich-text-editor.test.tsx` — existing editor tests still pass (no behavior change to the editor itself, this is just a new consumer).

## Out of scope (deliberately)

Block chrome (PanelHeader title bar, trigger-pill always-on coloring, etc.) — the user's clarification scoped this fix to the content-editor swap. Those deltas exist but are separate changes.
