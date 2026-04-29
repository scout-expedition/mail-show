# Narrative graph: interactive drag, drop, and reconnection

## Context

The narrative graph at `src/app/(authed)/graph/` is becoming a direct-manipulation surface so users can re-plumb their data straight from the graph instead of round-tripping through the inspector. Drag gestures trigger server actions; revalidation re-renders positions; the layout stays grid-snapped (no free-form chart).

Phases 1–6 (excluding the per-panel save modal followup) have shipped. The only piece still open is the per-panel save modal scoping followup below.

## Status by phase

### ✅ Phase 1 — drag letter groups between days
**Done.** `letter-group` nodes draggable. `onNodeDragStop` resolves the row at the pointer Y via `rowMeta`, and (when the row changed) calls `moveLetterGroupToDay(groupId, dayId | null)`. Sequence stays untouched (storyline-unique). New server action in `actions.ts`.

### ✅ Phase 2 — drag letters between groups
**Done.** `letter` nodes draggable; `extent: "parent"` removed so they can leave their group. `onNodeDragStop` finds the drop-target group via `rfRef.current.getIntersectingNodes(node)`. Cross-storyline drops are silently rejected. `moveLetterToGroup(letterId, targetGroupId)` updates `inspection_letters.letter_group_id`, re-slots variants in both groups, renumbers pieces, and nulls any `actions.next_letter_variant` refs in the source group that pointed at the moved letter's old variant.

### ✅ Phase 3 — drag report segments between days
**Done.** `report` nodes draggable. Same `onNodeDragStop` row resolution; calls `moveReportSegmentToDay(segmentId, dayId | null)` to update `delivery_day_override_id`.

### ✅ Phase 4 — reconnect action → next-letter edges
**Done.** Edges now mark `reconnectable: "target"` per subtype: `sn`, `ln`, `stub` are draggable from the arrowhead end; `ls` (letter → segment) is intrinsic and stays fixed. Letter-node target handles flipped to drop-only (`isConnectable={true}`, `isConnectableStart={false}`); other handles stay fully unconnectable. `<ReactFlow nodesConnectable>` flipped to `true` so the reconnect-drag connection line actually renders, since the drag-line wrapper short-circuits when that store flag is false. `onReconnectStart`/`onReconnect`/`onReconnectEnd` use a `edgeReconnectSuccessful` ref to distinguish a successful retarget from a clear: dropping on a letter calls `setActionNextLetterByLetterId(actionId, letterId)`; dropping in empty space calls it with `null`. `isValidConnection` filters drop targets to letter nodes.

Server side: `setActionNextLetterByLetterId` replaces the old variant-key-based `setActionNextLetter`. It validates same-storyline + adjacent (`sequence + 1`) and promotes the target letter's variant from null → `'a'` via `ensureLetterVariant` so a single-letter group can be linked without going through the inspector first. Invalid targets are silent no-ops; the next render snaps back from props.

### ✅ Phase 5 — rubber-band multi-select + batch move
**Done.** `elementsSelectable={true}` and `selectionOnDrag={true}` on `<ReactFlow>`. `onNodeDragStop` branches on `draggedNodes.length > 1` and dispatches `batchMoveToDay(moves)`. Letters in the selection collapse to their parent groups (deduped); reports stay reports; action chips are excluded from move ops since they follow their letter.

### ⬜ Per-panel save modal scoping (followup)
**Not started.** Today the unsaved-changes modal renders as a single `absolute inset-0` overlay scoped to `LettersWorkspace`. The desired behavior:
- Each panel that can be dirty (Letter Group, Inspection Letter, Letter Actions, Report Segment, Storyline) hosts its own modal slot positioned over its own card.
- When multiple panels are dirty during one navigation, render a modal over **each** dirty panel simultaneously — Save / Don't Save / Cancel per panel. Cancel on any aborts the whole navigation; the others stay open until resolved.
- Implementation sketch: each panel exposes a `useUnsavedDialog({ scoped: true })` instance + a `relative` container ref; a workspace-level orchestrator collects dirty panels at navigation time, fires each panel's `ask()` in parallel, and proceeds only when all resolve to save/discard.

### ✅ Phase 6 — drop-zone affordances + cursor polish
**Done.** `onNodeDragStart` / `onNodeDrag` / `onNodeDragStop` now drive three state slices: `hoveredRowId` (day band under the pointer), `hoveredGroupId` (letter-group a letter is being dragged onto, validated for same-storyline before highlighting), and `isDragging` (cursor). The hovered overlay is applied via a thin `decoratedNodes` `useMemo` that maps over the static layout — keeping per-frame hover updates out of the heavy O(nodes+edges) layout memo. Column-band nodes accept a `hovered` prop and switch to a `--ring`-tinted background + dashed outline; letter-group nodes accept a `hovered` prop and ring with `ring-2 ring-ring`. Letter, report, and letter-group nodes carry `cursor-grab active:cursor-grabbing`; while `isDragging` is true the wrapper sets `[&_*]:!cursor-grabbing` so the cursor stays consistent through xyflow's pointer-capture transitions. Keyboard nudge stayed out of scope.

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

## Post-phase iteration (2026-04-26)

Five items shipped on top of phases 1–6. Notes here so future sessions don't re-derive the design.

### ✅ U2↔U1 letter-move variant collision
**Fixed.** `moveLetterToGroup` now nulls the moved letter's variant in the same UPDATE that switches `letter_group_id`, so the (letter_group_id, variant) unique constraint never fires when the target group already has a letter at the source's old variant. `reassignVariants(targetGroupId)` repopulates a fresh slot from sort_order. Symptom before fix: dragging worked U2→U1 only because U1 happened not to have the conflicting variant; the reverse silently failed and snapped back.

### ✅ Reconnect flicker (optimistic edge state)
**Fixed.** `optimisticNextByAction: Record<actionId, string | null>` lives in `GraphView` and is consulted by the layout `useMemo` before reading `a.next_letter_variant`. `onReconnect` and `onConnect` set the override, await the server action, and clear the entry in a `finally{}`. Each entry is independently cleared so back-to-back reconnects don't trample each other. Also added a client-side same-storyline + adjacent-group guard before painting the optimistic edge — an invalid drop is a no-op so the optimistic edge never points somewhere the server would reject.

### ✅ Edit-mode toggle
**Shipped.** Lock/Unlock button in the graph header (`graph-surface.tsx`) persists to `localStorage["graph.editingEnabled"]`, defaults to **locked**. Gating in `GraphView`:
- `nodesDraggable`, `nodesConnectable`, `selectionOnDrag` all flip with the toggle.
- `panOnDrag` flips inverse so locked mode pans on canvas drag.
- Per-edge `reconnectable` is forced to `false` when locked.
- `onConnect` / `onReconnect*` handlers go `undefined` when locked.
- Wrapper applies `[&_.cursor-grab]:!cursor-pointer` so cards read as click-to-inspect, not drag-to-move, while locked.

### ✅ Connection-source handles for missing report / next-letter
**Shipped.** In edit mode, the layout mints a `connectionSource` node next to each letter-source chip whose action lacks a report (color circle in the action's color) and/or a next-letter (grey circle). Each circle is an xyflow `Handle` with `isConnectableStart`. `onConnect` receives the drop, parses the source `connect:<actionId>:report|next`, and dispatches:
- `setActionReportSegment(actionId, segmentId)` — new server action, validates the segment belongs to the source letter's report group.
- `setActionNextLetterByLetterId(actionId, letterId)` — same path Phase 4 used; applies the optimistic-override pattern.

Additional changes:
- `report-node.tsx` target handle flipped to drop-only (`isConnectable={true}, isConnectableStart={false}`).
- `hideChip` logic in the edge build now also keeps the chip visible for `ln` edges in edit mode when the action is missing a report or next, so the new circles have something to anchor to. `sn` continuation chips stay hidden (one chip per action).
- `isValidConnection` filters drop targets per source: `connect:*:report` requires a `report:*` target; `connect:*:next` (and reconnect drags) require a `letter:*` target.

### ✅ Undo button + Cmd/Ctrl+Z
**Shipped.** `UndoEntry` union exported from `graph-view.tsx`; `recordUndo` callback prop is fired before each mutating dispatch (single drag, batch drag, reconnect retarget, reconnect clear, new connection from a connect-source). Stack lives in `graph-surface.tsx` (capped at 100). Header button is disabled when empty. Global `keydown` listener on `Cmd/Ctrl+Z` (skips when an `<input>`/`<textarea>`/`contentEditable` element is focused so the inspector still gets native undo). No redo. `dispatchUndo` calls the same server actions in reverse — moves snap back to `previousDayId`, letter moves snap back to `previousGroupId`, action links restore from `previousLetterId` / `previousReportSegmentId`. Batch entries replay in reverse insertion order.

## Still open

Per-panel save modal scoping (the original ⬜ followup). UX polish for the workspace's unsaved-changes dialog, not the graph itself — can be picked up alongside the next Letters Workspace pass.
