"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconArrowBackUp,
  IconCirclePlusMinus,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightExpand,
  IconLock,
  IconLockOpen,
} from "@tabler/icons-react";
import {
  batchMoveToDay,
  moveLetterGroupToDay,
  moveLetterToGroup,
  moveReportSegmentToDay,
  setActionNextLetterByLetterId,
  setActionReportSegment,
} from "../inspection/letters/actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  DEFAULT_IMPACT_FILTER,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import type {
  ActionRow,
  ActionTemplate,
  Citizen,
  City,
  Day,
  EndingVariable,
  EndingVariableValue,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { GraphView, type GraphSelection, type UndoEntry } from "./graph-view";
import { ImpactOverlayPanel } from "./impact-overlay-panel";
import {
  LettersWorkspace,
  type ControlledSelection,
} from "../inspection/letters/workspace";

/**
 * Client wrapper that holds the impact-overlay filter (persisted to
 * localStorage), the inspector selection (graph node click → panel state),
 * and renders the graph next to the inspector panel when a node is selected.
 */
export function GraphSurface({
  storylines,
  letterGroups,
  letters,
  actions,
  actionTemplates,
  days,
  segments,
  nations,
  endingAssignments,
  heroes,
  allCitizenIds,
  cities,
  endingVariables,
  endingValues,
  currentUserId,
  currentEmail,
}: {
  storylines: Storyline[];
  letterGroups: LetterGroup[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  actionTemplates: ActionTemplate[];
  days: Day[];
  segments: ReportSegmentView[];
  nations: Nation[];
  endingAssignments: InspectionActionEndingAssignment[];
  heroes: Citizen[];
  allCitizenIds: string[];
  cities: City[];
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
  currentUserId?: string;
  currentEmail?: string;
}) {
  const [filter, setFilter] = useLocalStorage<ImpactFilter>(
    "graph.impactFilter",
    DEFAULT_IMPACT_FILTER
  );
  // Default-locked: graph reads as a static map until the user explicitly
  // unlocks editing. Prevents accidental day-moves / reconnects while
  // panning around. Persists across reloads so power users don't have to
  // re-click on every visit.
  const [editingEnabled, setEditingEnabled] = useLocalStorage<boolean>(
    "graph.editingEnabled",
    false
  );
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  // Replay an undo entry by calling the same server action that produced
  // it in reverse. Recursive for batch entries (multi-select drags). No
  // "redo" — applying an undo doesn't push the inverse back onto the
  // stack, since today's flows don't need it.
  const dispatchUndo = useCallback(async (entry: UndoEntry): Promise<void> => {
    switch (entry.kind) {
      case "moveLetterGroup":
        await moveLetterGroupToDay(entry.groupId, entry.previousDayId);
        return;
      case "moveLetter":
        await moveLetterToGroup(entry.letterId, entry.previousGroupId);
        return;
      case "moveReport":
        await moveReportSegmentToDay(entry.segmentId, entry.previousDayId);
        return;
      case "setNextLetter":
        await setActionNextLetterByLetterId(
          entry.actionId,
          entry.previousLetterId
        );
        return;
      case "setReport":
        await setActionReportSegment(
          entry.actionId,
          entry.previousReportSegmentId
        );
        return;
      case "batch":
        for (let i = entry.entries.length - 1; i >= 0; i--) {
          await dispatchUndo(entry.entries[i]);
        }
        return;
    }
  }, []);
  const recordUndo = useCallback((entry: UndoEntry) => {
    // Cap the stack so a long session doesn't accumulate forever.
    setUndoStack((prev) => {
      const next = [...prev, entry];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });
  }, []);
  const undo = useCallback(async () => {
    let popped: UndoEntry | undefined;
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (popped) {
      try {
        await dispatchUndo(popped);
      } catch {
        // Server rejected the inverse (e.g., target row was deleted). Drop
        // silently — pushing the failed entry back would just loop.
      }
    }
  }, [dispatchUndo]);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const initial = selectionToInitial(selection, letters, segments);

  // Inspector edits auto-save via instant-save, so navigation no longer
  // needs an unsaved-changes gate.
  const handleSelectionChange = useCallback(
    (sel: GraphSelection | null) => {
      setSelection(sel);
      if (sel) {
        setOverlayOpen(false);
        setInspectorOpen(true);
      }
    },
    []
  );

  const handleInspectorToggle = useCallback(() => {
    if (inspectorOpen) {
      setInspectorOpen(false);
    } else {
      setOverlayOpen(false);
      setInspectorOpen(true);
    }
  }, [inspectorOpen]);

  const handleOverlayToggle = useCallback(() => {
    if (!overlayOpen) {
      setInspectorOpen(false);
    }
    setOverlayOpen((v) => !v);
  }, [overlayOpen]);

  // Cmd/Ctrl+Z anywhere on /graph triggers an undo. We skip when an
  // editable element is focused so typing in the inspector still gets
  // native undo. Shift+Z is reserved for a future redo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (undoStack.length === 0) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoStack.length, undo]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <PageHeader
        title="Narrative Graph"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={undoStack.length === 0}
              aria-label="Undo last graph change"
              title={
                undoStack.length === 0
                  ? "Nothing to undo"
                  : `Undo last graph change (⌘/Ctrl+Z) · ${undoStack.length} step${undoStack.length === 1 ? "" : "s"}`
              }
              onClick={() => void undo()}
            >
              <IconArrowBackUp size={16} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={editingEnabled}
              aria-label={editingEnabled ? "Lock graph (read-only)" : "Unlock graph (allow edits)"}
              title={editingEnabled ? "Lock graph (read-only)" : "Unlock graph (allow edits)"}
              onClick={() => setEditingEnabled((v) => !v)}
              className={editingEnabled ? "border-primary bg-primary text-primary-foreground [&:hover]:bg-primary/90" : ""}
            >
              {editingEnabled ? <IconLockOpen size={16} /> : <IconLock size={16} />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={overlayOpen}
              aria-label={overlayOpen ? "Close impact overlays" : "Open impact overlays"}
              title={overlayOpen ? "Close impact overlays" : "Open impact overlays"}
              onClick={() => void handleOverlayToggle()}
              className={overlayOpen ? "border-primary bg-primary text-primary-foreground [&:hover]:bg-primary/90" : ""}
            >
              <IconCirclePlusMinus size={16} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={inspectorOpen}
              aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
              title={inspectorOpen ? "Close inspector" : "Open inspector"}
              onClick={handleInspectorToggle}
              className={inspectorOpen ? "border-primary bg-primary text-primary-foreground [&:hover]:bg-primary/90" : ""}
            >
              {inspectorOpen ? (
                <IconLayoutSidebarLeftExpand size={16} />
              ) : (
                <IconLayoutSidebarRightExpand size={16} />
              )}
            </Button>
          </div>
        }
      />
      {letterGroups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Create some storylines and letter groups to see the graph.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="min-h-0 min-w-0 flex-1">
            <GraphView
              storylines={storylines}
              letterGroups={letterGroups}
              letters={letters}
              actions={actions}
              actionTemplates={actionTemplates}
              days={days}
              segments={segments}
              nations={nations}
              endingAssignments={endingAssignments}
              impactFilter={filter}
              editingEnabled={editingEnabled}
              recordUndo={recordUndo}
              selection={inspectorOpen ? selection : null}
              onSelectionChange={handleSelectionChange}
            />
          </div>
          {overlayOpen ? (
            <aside className="w-[380px] shrink-0 lg:w-[420px]">
              <ImpactOverlayPanel
                nations={nations}
                filter={filter}
                onFilterChange={setFilter}
              />
            </aside>
          ) : null}
          {inspectorOpen ? (
            <aside className="w-[380px] shrink-0 lg:w-[420px]">
              <LettersWorkspace
                storylines={storylines}
                groups={letterGroups}
                days={days}
                letters={letters}
                actions={actions}
                templates={actionTemplates}
                heroes={heroes}
                allCitizenIds={allCitizenIds}
                cities={cities}
                nations={nations}
                segments={segments}
                endingVariables={endingVariables}
                endingValues={endingValues}
                endingAssignments={endingAssignments}
                initialGroupId={initial.groupId}
                initialLetterId={initial.letterId}
                initialSegmentId={initial.segmentId}
                currentUserId={currentUserId}
                currentEmail={currentEmail}
                controlledSelection={selection as ControlledSelection}
                onSelectionChange={(sel) => {
                  // Panel-driven selection changes (user clicking within
                  // the inspector list) are already dirty-guarded inside
                  // the workspace itself, so we mirror without
                  // re-prompting from here.
                  setSelection(sel as GraphSelection | null);
                }}
                onClose={() => {
                  handleInspectorToggle();
                }}
                forceNarrow
              />
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

function selectionToInitial(
  sel: GraphSelection | null,
  letters: InspectionLetterView[],
  segments: ReportSegmentView[]
): {
  groupId: string | null;
  letterId: string | null;
  segmentId: string | null;
} {
  if (!sel) return { groupId: null, letterId: null, segmentId: null };
  if (sel.kind === "group") {
    return { groupId: sel.groupId, letterId: null, segmentId: null };
  }
  if (sel.kind === "letter" || sel.kind === "actions") {
    // Resolve the variant key to a real letter id at mount time so the
    // workspace starts on the "main" view with letterState already
    // hydrated — otherwise the first render shows the dashed
    // "Select a letter…" empty state until the controlled-selection
    // effect catches up.
    const letter = letters.find(
      (l) =>
        l.letter_group_id === sel.groupId &&
        (l.variant ?? "") === sel.variantKey
    );
    return {
      groupId: sel.groupId,
      letterId: letter?.id ?? null,
      segmentId: null,
    };
  }
  // Segment selections: resolve the parent group too so its segment list
  // is non-empty on the first render.
  const seg = segments.find((s) => s.id === sel.segmentId);
  return {
    groupId: seg?.letter_group_id ?? null,
    letterId: null,
    segmentId: sel.segmentId,
  };
}
