"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { useClaimWorkspacePeers } from "@/lib/realtime/workspace-peer-claims";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type {
  PresencePeer,
  PresenceProfile,
  PresenceSelection,
} from "@/lib/realtime/presence";

/** Tables the presence channel mirrors. Must match the workspace's list so
 *  postgres_changes consumers (the embedded LettersWorkspace) get the same
 *  events regardless of which surface hosts the provider. */
const PRESENCE_POSTGRES_TABLES = [
  "inspection_letters",
  "letter_groups",
  "actions",
  "report_segments",
  "storylines",
  "inspection_action_ending_assignments",
];

/**
 * Client wrapper that holds the impact-overlay filter (persisted to
 * localStorage), the inspector selection (graph node click → panel state),
 * and renders the graph next to the inspector panel when a node is selected.
 */
type GraphSurfaceProps = {
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
  currentProfile?: PresenceProfile | null;
};

/**
 * Wrapper: hosts the shared presence provider for the entire graph surface
 * so peers stay visible (and postgres_changes keep flowing) even when the
 * inspector is closed. The embedded `<LettersWorkspace>` adopts the same
 * provider via `presenceProvided`.
 */
export function GraphSurface(props: GraphSurfaceProps) {
  return (
    <WorkspacePresenceProvider
      channelName="letters-workspace"
      userId={props.currentUserId}
      email={props.currentEmail}
      profile={props.currentProfile}
      postgresTables={PRESENCE_POSTGRES_TABLES}
    >
      <GraphSurfaceInner {...props} />
    </WorkspacePresenceProvider>
  );
}

function GraphSurfaceInner({
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
  currentProfile,
}: GraphSurfaceProps) {
  const router = useRouter();
  const { peers, selfPeer } = usePresenceContext();
  // Workspace-stack peers are owned by /graph; AppPresence (othersOnly in
  // PageHeader) filters these userIds so they don't double-render.
  useClaimWorkspacePeers(peers.map((p) => p.userId));
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

  // ---------- Presence: location label + jump-to-peer ----------
  //
  // Header avatars are always "Graph"-prefixed regardless of which surface
  // a peer is technically on; the page-scoped label is more useful here
  // than chasing the peer's surface. Panel suffix is the deepest known
  // entity (focused field → focused row's display id, else deepest non-null
  // id in `peer.selection`). When no panel info is known, just "Graph".
  const peerLocations = useMemo(() => {
    const m = new Map<string, string>();
    const all = selfPeer ? [selfPeer, ...peers] : peers;
    for (const peer of all) {
      const panel = resolvePeerPanel(peer, {
        letters,
        letterGroups,
        segments,
        storylines,
        actions,
      });
      m.set(peer.userId, panel ? `Graph\n${panel}` : "Graph");
    }
    return m;
  }, [
    peers,
    selfPeer,
    letters,
    letterGroups,
    segments,
    storylines,
    actions,
  ]);

  // Derive the local user's PresenceSelection from the graph's GraphSelection
  // so AvatarStack can dim peers who aren't sharing the visible panel.
  // Null when the inspector is closed (no panel = nothing to be off from).
  const selfSelection = useMemo<PresenceSelection | null>(() => {
    if (!inspectorOpen || !selection) return null;
    return graphSelectionToPresence(selection, letters);
  }, [inspectorOpen, selection, letters]);

  // Click a peer's avatar → open the inspector and load their panel.
  const jumpToPeer = useCallback(
    (peer: PresencePeer) => {
      const sel = peer.selection;
      if (!sel) return;
      const next = presenceSelectionToGraph(sel, letters);
      if (!next) return;
      setSelection(next);
      setOverlayOpen(false);
      setInspectorOpen(true);
    },
    [letters]
  );

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
        presenceOthersOnly
        actions={
          <div className="flex items-center gap-2">
            <AvatarStack
              peers={peers}
              self={selfPeer}
              selfSelection={selfSelection}
              peerLocations={peerLocations}
              onAvatarClick={jumpToPeer}
              onSelfClick={() => router.push("/settings")}
              narrow
              className="mr-1"
            />
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
                currentProfile={currentProfile}
                presenceProvided
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

/**
 * Resolve a peer's deepest known entity to a display string ("Letter L-A3/b",
 * "Group A7", "Report R-A3/i", or "Storyline …"). Prefers `peer.focus`
 * (most precise — the actual focused row) and falls back to the deepest
 * non-null id in `peer.selection`. Returns null when nothing's known so the
 * caller can fall back to a surface-only label ("Graph").
 */
function resolvePeerPanel(
  peer: PresencePeer,
  mirrors: {
    letters: InspectionLetterView[];
    letterGroups: LetterGroup[];
    segments: ReportSegmentView[];
    storylines: Storyline[];
    actions: ActionRow[];
  }
): string | null {
  const { letters, letterGroups, segments, storylines, actions } = mirrors;
  const storylineById = new Map(storylines.map((s) => [s.id, s]));

  if (peer.focus) {
    const id = peer.focus.recordId;
    switch (peer.focus.table) {
      case "inspection_letters": {
        const l = letters.find((x) => x.id === id);
        if (l?.content_id) return `Letter ${l.content_id}`;
        break;
      }
      case "letter_groups": {
        const g = letterGroups.find((x) => x.id === id);
        if (g) {
          const s = storylineById.get(g.storyline_id);
          return `Group ${s?.abbreviation ?? ""}${g.sequence}`;
        }
        break;
      }
      case "actions": {
        const a = actions.find((x) => x.id === id);
        const l = a
          ? letters.find((x) => x.id === a.inspection_letter_id)
          : null;
        if (l?.content_id) return `Actions ${l.content_id}`;
        break;
      }
      case "report_segments": {
        const seg = segments.find((x) => x.id === id);
        if (seg?.report_id) return `Report ${seg.report_id}`;
        break;
      }
      case "storylines": {
        const s = storylines.find((x) => x.id === id);
        if (s) return `Storyline ${s.name}`;
        break;
      }
    }
  }
  const sel = peer.selection;
  if (sel) {
    if (sel.segmentId) {
      const seg = segments.find((x) => x.id === sel.segmentId);
      if (seg?.report_id) return `Report ${seg.report_id}`;
    }
    if (sel.letterId) {
      const l = letters.find((x) => x.id === sel.letterId);
      if (l?.content_id) return `Letter ${l.content_id}`;
    }
    if (sel.groupId) {
      const g = letterGroups.find((x) => x.id === sel.groupId);
      if (g) {
        const s = storylineById.get(g.storyline_id);
        return `Group ${s?.abbreviation ?? ""}${g.sequence}`;
      }
    }
    if (sel.storylineId) {
      const s = storylines.find((x) => x.id === sel.storylineId);
      if (s) return `Storyline ${s.name}`;
    }
  }
  return null;
}

/** Project a `GraphSelection` into a presence-shaped selection so AvatarStack's
 *  visible-slot logic can compute the right co-location predicate. Always
 *  narrow on the graph surface — the inspector embeds the workspace in
 *  `forceNarrow` mode (single-panel view). */
function graphSelectionToPresence(
  sel: GraphSelection,
  letters: InspectionLetterView[]
): PresenceSelection {
  if (sel.kind === "segment") {
    return {
      storylineId: null,
      groupId: null,
      letterId: null,
      segmentId: sel.segmentId,
      view: "segment",
      narrow: true,
    };
  }
  if (sel.kind === "group") {
    return {
      storylineId: null,
      groupId: sel.groupId,
      letterId: null,
      segmentId: null,
      view: "group",
      narrow: true,
    };
  }
  // letter | actions — resolve the variant to a letter id so visibleRecordId
  // matches by letterId across both surfaces.
  const letter = letters.find(
    (l) =>
      l.letter_group_id === sel.groupId &&
      (l.variant ?? "") === sel.variantKey
  );
  return {
    storylineId: null,
    groupId: sel.groupId,
    letterId: letter?.id ?? null,
    segmentId: null,
    view: sel.kind === "actions" ? "actions" : "main",
    narrow: true,
  };
}

/** Inverse of `graphSelectionToPresence`: turn a peer's chain into a graph
 *  selection so jump-to-peer can apply it. Returns null when the peer has
 *  no actionable selection (e.g. they're at the storylines list). */
function presenceSelectionToGraph(
  sel: PresenceSelection,
  letters: InspectionLetterView[]
): GraphSelection | null {
  if (sel.segmentId) {
    return { kind: "segment", segmentId: sel.segmentId };
  }
  if (sel.letterId && sel.groupId) {
    const letter = letters.find((l) => l.id === sel.letterId);
    const variantKey = letter?.variant ?? "";
    return sel.view === "actions"
      ? { kind: "actions", groupId: sel.groupId, variantKey }
      : { kind: "letter", groupId: sel.groupId, variantKey };
  }
  if (sel.groupId) {
    return { kind: "group", groupId: sel.groupId };
  }
  return null;
}
