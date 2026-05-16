# Markdown text areas → WYSIWYG rich-text editor

Branch: `corey/markdown-text-areas`. Status: **implemented** — typecheck clean,
426 tests pass (24 new), production build green. Manual browser pass pending.

## Context

The inspection-letter `content` and report-segment `content` fields were edited
through `MarkdownTextarea` — a plain `<textarea>` with a floating toolbar that
inserted **raw** Markdown markers (`**bold**`, `## `, `- `, …). The editor never
rendered the formatting, so authors saw literal `**` characters instead of bold
text. This work replaces it with a true WYSIWYG editor: formatting renders
styled as you type, plus underline & strikethrough (which Markdown can't
represent).

Content is stored as **Lexical editor-state JSON**. Existing legacy
Markdown/plain-text values auto-convert when a letter/report is first opened —
no DB migration. The DB columns stay plain `text`; no schema change.

The codebase already runs Lexical for the endings text-block editor
(`src/app/(authed)/endings/_blocks/lexical/`) — that module is the model:
`LexicalComposer` + `RichTextPlugin` + `OnChangePlugin` + a `ValueSyncPlugin`
(live-collab prop sync with an infinite-loop guard) + `buildInitialEditorStateJSON`
(flash-free hydration).

## Behaviour

- Toolbar buttons: **Bold, Italic, Underline, Strikethrough, Bullet list,
  Numbered list**. The old **Code, Link, Quote** buttons are removed. Heading
  was dropped after review.
- Keyboard shortcuts toggle: Bold `⌘/Ctrl+B`, Italic `⌘/Ctrl+I`, Underline
  `⌘/Ctrl+U` (free from Lexical rich-text), Strikethrough `⌘/Ctrl+Shift+S`
  (wired manually).
- Toolbar buttons reflect the active formatting of the current selection.
- Floating-toolbar UX preserved: appears on focus, dodges the caret when it
  sits on the first line.

## Dependencies

`@lexical/list` and `@lexical/markdown` added to `package.json` as direct deps
(`^0.44.0`) — previously only transitive deps of `@lexical/react`, so not
importable under pnpm's strict `node_modules`.

## New files — `src/components/rich-text/`

### `serialize.ts` (pure module)
- `RICH_TEXT_NODES` — `[ListNode, ListItemNode]`.
- `LEGACY_TRANSFORMERS` — subset of `@lexical/markdown` transformers: lists +
  bold/italic/strikethrough. Excludes Heading/Code/Link/Quote/InlineCode so old
  markup for removed buttons degrades to plain text.
- `isLexicalStateJSON(value)` — cheap prefilter then authoritative
  `editor.parseEditorState(value)` in `try/catch`.
- `buildInitialEditorState(value)` / `buildInitialEditorStateJSON(value)` —
  legacy markdown → editor state via `$convertFromMarkdownString`.
- `serializeEditorState`, `isEmptyEditorState`.

### `rich-text-editor.tsx` (`"use client"`)
`RichTextEditor` — editable editor. Props `value: string | null | undefined`,
`onChange: (next: string) => void`, `onFocus`, `onBlur`, `minRows`,
`placeholder`, `className`. `onFocus`/`onBlur` wired onto `ContentEditable`.
Plugins: `RichTextPlugin`, `ListPlugin`, `HistoryPlugin`, `OnChangePlugin`,
`ValueSyncPlugin`, `StrikethroughShortcutPlugin`, `<FloatingToolbar/>`. Empty
editor emits `""`.

### `floating-toolbar.tsx` (`"use client"`)
6 buttons via Lexical commands: `FORMAT_TEXT_COMMAND` (bold/italic/underline/
strikethrough) and `INSERT_*_LIST_COMMAND` / `REMOVE_LIST_COMMAND` (list
toggle). Active state via a selection update listener. Keeps the caret-dodge
UX.

### `strikethrough-shortcut-plugin.tsx` (`"use client"`)
`KEY_DOWN_COMMAND` for `⌘/Ctrl+Shift+S`.

### `rich-text-readonly.tsx` (`"use client"`)
`editable: false` Lexical instance sharing nodes + theme; `(empty)` placeholder.

### `theme.ts`
Shared Lexical theme mapping formats/headings/lists to Tailwind classes.

## Edits

- `src/app/(authed)/inspection/letters/workspace.tsx` — delete inline
  `MarkdownTextarea`, swap both content call sites to `RichTextEditor`.
- `src/app/(authed)/days/[identifier]/top-of-day/page.tsx` — replace the
  `<pre>` report-content block with `<RichTextReadonly>`.

## Tests

`src/components/rich-text/serialize.test.ts` and `rich-text-editor.test.tsx`,
mirroring `endings/_blocks/lexical/*.test`.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus manual checks on
`/inspection/letters`, report segments, and `/days/<id>/top-of-day`.
