# Narrative graph: interactive drag, drop, and reconnection

## Context

The narrative graph at `src/app/(authed)/graph/` is becoming a direct-manipulation surface so users can re-plumb their data straight from the graph instead of round-tripping through the inspector. Drag gestures trigger server actions; revalidation re-renders positions; the layout stays grid-snapped (no free-form chart).

Phases 1–3, 5, and the surrounding polish/inspector work have shipped. Two pieces remain:

- **Phase 4** — drag the arrowhead end of an action's next-letter edge to retarget or clear.
- **Phase 6** — drop-zone affordances during drag (cursor + tinted target row/group).

## Status by phase

### ✅ Phase 1 — drag letter groups between days
**Done.** `letter-group` nodes draggable. `onNodeDragStop` resolves the row at the pointer Y via `rowMeta`, and (when the row changed) calls `moveLetterGroupToDay(groupId, dayId | null)`. Sequence stays untouched (storyline-unique). New server action in `actions.ts`.

### ✅ Phase 2 — drag letters between groups
**Done.** `letter` nodes draggable; `extent: "parent"` removed so they can leave their group. `onNodeDragStop` finds the drop-target group via `rfRef.current.getIntersectingNodes(node)`. Cross-storyline drops are silently rejected. `moveLetterToGroup(letterId, targetGroupId)` updates `inspection_letters.letter_group_id`, re-slots variants in both groups, renumbers pieces, and nulls any `actions.next_letter_variant` refs in the source group that pointed at the moved letter's old variant.

### ✅ Phase 3 — drag report segments between days
**Done.** `report` nodes draggable. Same `onNodeDragStop` row resolution; calls `moveReportSegmentToDay(segmentId, dayId | null)` to update `delivery_day_override_id`.

### ⬜ Phase 4 — reconnect action → next-letter edges
**Not started.** Plan:
- Mark relevant edges as reconnectable in the emit loop:
  - `sn` (segment → next-letter): `reconnectable: "target"`.
  - `ln` (letter → next-letter, no report): `reconnectable: "target"`.
  - `stub` (dangling, circle terminator): `reconnectable: "target"` so users can drag a dangling endpoint onto a letter to create a link.
  - `ls` (letter → segment): not reconnectable (segment is the action's intrinsic report).
- Verify `<BaseEdge>` in `action-icon-edge.tsx` plays nicely with xyflow's reconnect overlay; add a small visible drag-handle near the arrowhead endpoint if the default doesn't render on custom edges.
- On `<ReactFlow>` add `onReconnect` and `onReconnectEnd`:
  - `onReconnect(oldEdge, newConn)`: parse `oldEdge.id` → `a:<actionId>:<kind>`. Resolve `newConn.target` to a letter (must be in the source action's storyline AND the next group by sequence). Call `setActionNextLetter(actionId, targetVariantKey)`.
  - `onReconnectEnd(_, edge, handleType, state)`: if `state.isValid === false` (dropped on empty), call `setActionNextLetter(actionId, null)` to clear the link.
- Server action `setActionNextLetter` already exists (added in Phase 1's batch). It calls `ensureInspectionLetterVariant` when needed and `revalidatePath("/inspection/letters")` + `"/graph"`.
- Cross-storyline / non-adjacent reconnects should silently snap back, mirroring Phase 2's behavior.

### ✅ Phase 5 — rubber-band multi-select + batch move
**Done.** `elementsSelectable={true}` and `selectionOnDrag={true}` on `<ReactFlow>`. `onNodeDragStop` branches on `draggedNodes.length > 1` and dispatches `batchMoveToDay(moves)`. Letters in the selection collapse to their parent groups (deduped); reports stay reports; action chips are excluded from move ops since they follow their letter.

### ⬜ Per-panel save modal scoping (followup)
**Not started.** Today the unsaved-changes modal renders as a single `absolute inset-0` overlay scoped to `LettersWorkspace`. The desired behavior:
- Each panel that can be dirty (Letter Group, Inspection Letter, Letter Actions, Report Segment, Storyline) hosts its own modal slot positioned over its own card.
- When multiple panels are dirty during one navigation, render a modal over **each** dirty panel simultaneously — Save / Don't Save / Cancel per panel. Cancel on any aborts the whole navigation; the others stay open until resolved.
- Implementation sketch: each panel exposes a `useUnsavedDialog({ scoped: true })` instance + a `relative` container ref; a workspace-level orchestrator collects dirty panels at navigation time, fires each panel's `ask()` in parallel, and proceeds only when all resolve to save/discard.

### ⬜ Phase 6 — drop-zone affordances + cursor polish
**Not started.** Plan:
- During drag (`onNodeDragStart` → set state, `onNodeDrag` → update hovered target, `onNodeDragStop` → clear), highlight the row that's currently under the pointer. Easiest path: bump the column-band node's data with a `hovered: boolean` flag and tint when true (`bg-accent/20` or similar).
- For letter-cross-group drag, ring the intersecting target group while hovering (use `getIntersectingNodes` in `onNodeDrag`).
- `cursor-grab` on `letter`, `report`, and `letter-group` nodes; `cursor-grabbing` on the wrapper while a drag is in progress (track via `onNodeDragStart` / `onNodeDragStop`).
- Optional stretch: keyboard nudge — Arrow Up / Arrow Down on a selected entity moves it to the adjacent day.

## Snap-back mechanics (already in place)
xyflow v12 with controlled `nodes` prop never persists drag positions on its own. After a server action succeeds → `revalidatePath("/graph")` → `page.tsx` re-fetches → `useMemo` recomputes → the node lands at its new snapped grid position. If a drop isn't a valid target, no action fires and the next render snaps the node back from props.

## Surrounding work that shipped alongside

- **Inline inspector**: `LettersWorkspace` is embedded in graph-surface with `forceNarrow` (single-panel slide), `controlledSelection` / `onSelectionChange`, and `onClose`. Selection state is mirrored between graph + panel and a `setCenter()` effect re-pans on selection change after the aside reflows.
- **Unified unsaved-changes prompt**: shared `useUnsavedDialog` (Discard / Cancel / Save) in `src/components/unsaved-dialog.tsx`. Title reflects the dirty kind ("Unsaved Action" / "Unsaved Inspection Letter" / "Unsaved Letter Group" / "Unsaved Storyline"). Workspace's old binary `onConfirmDiscard` now routes through this dialog and `saveAllNow`.
- **Page-leave guards**: both `/graph` and `/inspection/letters` install a `beforeunload` listener and a document-level click capture for `<a>` so client-side `<Link>` navigation runs through the unsaved prompt. Save flushes via `saveAllRef.current`/`saveAllNow`; Discard drops dirty flags inline; the navigation replays via `router.push` (or `window.location.href` cross-origin).
- **Header / chrome polish**:
  - Sticky day-gutter (left) + storyline-header (top) overlays read xyflow viewport state via `onMove`/`onMoveEnd`. Day pills size their height to `rowHeight * zoom` so they grow when zoomed; storyline pills no longer clipped at the gutter boundary (overflow visible, z-20).
  - Bottom-right zoom controls (custom dark stack with percentage on top; `IconPlus`/`IconMinus`/`IconFocusCentered`).
  - Letter-group label moved from "above center" to half-on/half-off the box's left edge (`translate(-50%, -50%)`); `GROUP_PAD_LEADING/TRAILING` 25 → 44 for breathing room.
  - SaveRevert no longer reserves space; "Saved"/"Unsaved" status sits next to the overflow menu when clean and slides left when dirty.
  - Letter-group inspector panel: "Group delivery" readout + "Delivery override" dropdown + "Actions" button each with column-2 width and matching labels.
- **Visual consistency on edges**: report → next-letter continuations render line-only at `#5e5e5e`; letter → next-letter direct (no report) likewise hides the chip; multiple-arrow convergence renders white. Bezier `curvature: 0.5` and a 3px arrow pullback align line-to-arrowhead joins.
- **All-row chip alignment**: chips for letter sources in the same day row share `chipY = rowBottom − ROW_BOTTOM_PAD/2`. Spacing: `ROW_TOP_PAD = 56`, `ROW_BOTTOM_PAD = 32`, `CELL_VGAP = 40`, `STORYLINE_COL_MIN_W = 320`, `MIN_ROW_CONTENT_H = 80`, `CHIP_PITCH = 36`. Letter variants top-aligned inside the group.
- **Bug fix — typing reverts / silent discard / "auto-save"**: workspace's controlled-mode effects had `onSelectionChange` in their deps. The graph re-creates that callback on every render, which fired the apply effect on every keystroke (each `onDirtyChange` broadcast caused a parent re-render → new callback identity). The effect was resetting dirty flags + overwriting `letterState`. Fix: deps reduced to `[controlledSelection]` and `[selectedGroupId, selectedId, selectedSegmentId, view]`.

## Files modified along the way

- `src/app/(authed)/graph/graph-view.tsx` — drag handlers, onNodeDragStop dispatcher, sticky overlays, edge data
- `src/app/(authed)/graph/graph-surface.tsx` — selection state, embedded LettersWorkspace, dirty guards, page-leave intercept
- `src/app/(authed)/graph/edges/action-icon-edge.tsx` — bezier paths, curvature, arrow pullback, hideChip + report-source styling
- `src/app/(authed)/graph/nodes/letter-node.tsx` / `report-node.tsx` / `letter-group.tsx` / `stub-target.tsx` — handles + selection plumbing
- `src/app/(authed)/inspection/letters/actions.ts` — `moveLetterGroupToDay`, `moveLetterToGroup`, `moveReportSegmentToDay`, `setActionNextLetter`, `batchMoveToDay`
- `src/app/(authed)/inspection/letters/workspace.tsx` — controlled-mode props, `onDirtyChange(kind)`, `saveAllRef`, `forceNarrow`, page-leave guards, breadcrumb hidden in controlled mode, dirty-prompt routing through `askUnsaved`
- `src/components/unsaved-dialog.tsx` (new) — shared `useUnsavedDialog`
- `src/components/pills.tsx` — `selected?: boolean` on cards/pill (focus ring uses `--ring`)

## Verification (run when picking up Phase 4 / Phase 6)

1. Reload `/graph`. Drag a letter group to a different day → snaps into the new day's row in the same storyline column. Drag a letter card from one group onto another in the same storyline → variants re-slot, action `next_letter_variant` clears for orphans. Drag a report card to a different row → its `delivery_day_override_id` updates. Multi-select via rubber-band, drag → all selected entities land on the new day in one revalidation.
2. Open the inspector, edit a letter, navigate (graph click / panel-list click / page link) → unsaved-changes prompt fires; Save flushes via `saveAllNow` then continues; Discard drops edits then continues; Cancel aborts.
3. **Phase 4 unit**: dragging the arrowhead of an `sn`/`ln` edge onto another letter retargets `actions.next_letter_variant`. Dropping in empty space clears it. Dragging from a `stub` endpoint onto a valid next-letter creates a fresh link.
4. **Phase 6 unit**: while dragging, the row under the pointer tints; `cursor-grab` on idle, `cursor-grabbing` on active drag. For letter cross-group drag, the hovered target group rings up.

## Sequencing for the remainder

- Phase 4 first (mostly server-action + xyflow API wiring; smaller blast radius).
- Phase 6 last (CSS + state plumbing; pure UX polish).
