# Endings Frameworks — Figma visual fidelity pass

Mockup: https://www.figma.com/design/AD68eqkgtzsl4pgykdI81Y/Mail-Show-Ending-Frameworks?node-id=1-2

## Context

`docs/endings-frameworks-plan.md` (Phases 1–3) committed to the **structural** intent of the mockup: chip-row authoring, multi-variable conditions, typed operators, collapse chevron, overlap detection. It explicitly did not commit to pixel-perfect typography, spacing, color palette, or the exact chip-pill / row chrome shown in Figma.

Phase 1–3 ships an editor that reads correctly but doesn't visually match the mockup. This plan closes that gap as a single focused pass.

## Approach

A side-by-side audit, then a delta-driven implementation pass — no new behavior, no schema changes. Specifically:

1. **Audit (one sitting):** open `/endings/frameworks` next to the Figma file. Walk every visible surface — list panel, framework header, condition block header, condition row, chip pill, add-chip picker, add-row pill, add-block pill, preview pane — and write down the deltas (typography, spacing, color, border, radius, hover/focus states, drag affordance). Capture this list in this doc as a checklist.
2. **Token reconciliation:** if the mockup uses tokens we don't have, decide whether to add them to `tailwind.config.ts` or local CSS variables. Don't introduce new color names that won't be reused.
3. **Implement:** one PR, one component-folder at a time (chip pill first, then condition row, then condition block header, then preview). Type/lint clean per file. No behavior change — diffs should be className/markup only, with the rare exception of restructuring a row to enable a layout the mockup requires.

## Out of scope

- **Behavioral changes.** Inline editing semantics, drag rules, save model, picker UX — all locked. If the mockup shows a different interaction, file a separate plan.
- **New schema.** Same data model.
- **The Logic tab.** Per the master plan, Logic stays on the old engine until the chip-row primitive is stable.
- **Manual color picker.** Authors don't pick chip colors; the deterministic palette (text vars) and the impact/nation-color overrides (number_ref vars) stay as-is. If the mockup implies a picker, treat that as a separate effort.

## Audit checklist (filled in during the audit pass)

> Empty until the audit happens. Each entry: `[component] — current vs mockup → planned change`.

### Framework list (left panel)
- _TBD_

### Framework editor header (name, save/revert, preview toggle)
- _TBD_

### Condition block — outer shell
- _TBD_

### Condition block — header (chevron, label, row count, trash)
- _TBD_

### Condition row (chip column + content column)
- _TBD_

### Chip pill (variable + operator + value, inline edit, remove)
- _TBD_

### Add-chip inline picker
- _TBD_

### Text block (textarea + grip + delete)
- _TBD_

### Adders (root +text/+condition pill, per-block +row pill)
- _TBD_

### Preview pane (variable inputs + paragraphs + overlap warning)
- _TBD_

## Files in scope

Anything under `src/app/(authed)/endings/frameworks/` plus shared components used by it. Specifically expected to change:

- `blocks/chip.tsx`
- `blocks/condition-block.tsx`
- `blocks/text-block.tsx`
- `blocks/block-list.tsx`
- `framework-editor.tsx`
- `framework-list.tsx`
- `preview-view.tsx`

Shared component touch (only if the audit forces it):
- `src/components/panel.tsx` (PanelHeader, GHOST_FIELD, AutoTextarea)
- `tailwind.config.ts` for any genuinely-shared token

## Verification

- Side-by-side screenshot of every audited surface vs the mockup, attached to the PR.
- `pnpm typecheck` / `pnpm lint` clean.
- Existing E2E (`tests/e2e/endings-frameworks.spec.ts`) still passes — visual changes shouldn't break selectors. If the audit forces a selector change, update the spec.
- Manual smoke: drag-drop, chip add/edit/remove, collapse, preview overlap warning all behave as before.

## Followups out of scope here

- Visual regression snapshots (Playwright `toMatchSnapshot` or Chromatic) — useful but a separate infra effort.
- Animation/transition polish beyond hover states already in use.
- Mobile/narrow-viewport layout — the editor today assumes desktop and the mockup does too.
