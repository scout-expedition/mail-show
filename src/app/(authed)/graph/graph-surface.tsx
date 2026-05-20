"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowBackUp,
  IconBolt,
  IconDragDrop,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  moveLetterGroupToDay,
  moveLetterToGroup,
  restoreReportSegmentDelivery,
  setActionNextLetterByLetterId,
  setActionReportSegment,
} from "../inspection/letters/actions";
import { Button } from "@/components/ui/button";
import { NavMenuButton } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  DEFAULT_IMPACT_FILTER,
  type FrameworkOption,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import type {
  ActionRow,
  ActionTemplate,
  ActionTemplateGroup,
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
import {
  GraphView,
  type GraphSelection,
  type PeerRingMap,
  type UndoEntry,
} from "./graph-view";
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
import { focusMatchesView } from "@/lib/realtime/presence";

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
  actionTemplateGroups: ActionTemplateGroup[];
  days: Day[];
  segments: ReportSegmentView[];
  nations: Nation[];
  endingAssignments: InspectionActionEndingAssignment[];
  heroes: Citizen[];
  allCitizenIds: string[];
  cities: City[];
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
  frameworkOptions: FrameworkOption[];
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
  actionTemplateGroups,
  days,
  segments,
  nations,
  endingAssignments,
  heroes,
  allCitizenIds,
  cities,
  endingVariables,
  endingValues,
  frameworkOptions,
  currentUserId,
  currentEmail,
  currentProfile,
}: GraphSurfaceProps) {
  const router = useRouter();
  const { peers, selfPeer, selfColor, onPostgresChanges, sendBroadcast } =
    usePresenceContext();

  // Before deleting a row from the graph's context menu, broadcast who's
  // doing it so other clients' DELETE-toast attribution map is populated
  // (mirrors the inspector's handlers in workspace.tsx). Without this, a
  // graph-initiated delete shows up as "Someone deleted this".
  const broadcastRowDeleting = useCallback(
    (id: string) => {
      sendBroadcast("row-deleting", {
        id,
        by: currentProfile?.displayName ?? currentEmail ?? "Someone",
      });
    },
    [sendBroadcast, currentProfile, currentEmail]
  );
  // Workspace-stack peers are owned by /graph; AppPresence (othersOnly in
  // PageHeader) filters these userIds so they don't double-render.
  useClaimWorkspacePeers(peers.map((p) => p.userId));

  // Live-refresh the graph when any table that affects its layout or edges
  // changes. View columns (effective_day_id, content_id, …) aren't on the
  // postgres_changes payload, so a router.refresh re-runs the RSC and reseeds
  // GraphView with fresh data. Debounce coalesces bursts; in-flight inspector
  // edits are protected by useInstantField's committedAwaitingRemote guard so
  // the refresh doesn't snap typed-but-unsaved values back.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const watched = new Set([
      "inspection_letters",
      "letter_groups",
      "actions",
      "report_segments",
      "storylines",
    ]);
    return onPostgresChanges((change) => {
      if (!watched.has(change.table)) return;
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        startTransition(() => {
          router.refresh();
        });
      }, 250);
    });
  }, [onPostgresChanges, router]);
  // Key is suffixed `.v2`: the ImpactFilter shape changed (per-variable map
  // semantics inverted to an explicit set), so an old persisted value would
  // be misread. Bumping the key cleanly discards pre-v2 state.
  const [filter, setFilter] = useLocalStorage<ImpactFilter>(
    "graph.impactFilter.v2",
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
  // stack, since today's flows don't need it. The ref lets the batch branch
  // call the function recursively without a forward-reference lint error.
  const dispatchUndoRef = useRef<(entry: UndoEntry) => Promise<void>>(
    async () => {}
  );
  const dispatchUndo = useCallback(async (entry: UndoEntry): Promise<void> => {
    switch (entry.kind) {
      case "moveLetterGroup":
        await moveLetterGroupToDay(entry.groupId, entry.previousDayId);
        return;
      case "moveLetter":
        await moveLetterToGroup(entry.letterId, entry.previousGroupId);
        return;
      case "moveReport":
        await restoreReportSegmentDelivery(
          entry.segmentId,
          entry.previousOverrideId,
          entry.previousOffset
        );
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
          await dispatchUndoRef.current(entry.entries[i]);
        }
        return;
    }
  }, []);
  // Keep the ref in sync so the batch branch always calls the latest closure.
  // Writing to ref.current during render is the standard "latest-value ref" pattern.
  // eslint-disable-next-line react-hooks/refs
  dispatchUndoRef.current = dispatchUndo;
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

  // Bucket every peer's avatar color by what they have selected, so the
  // graph can render a peer-colored outer ring on the matching node.
  // A peer on the "actions" panel with a specific action chip selected
  // rings that chip; without one (e.g. an inspection-page peer, whose
  // actions panel isn't chip-scoped) it falls back to the parent letter.
  const peerRings = useMemo<PeerRingMap>(() => {
    const groups = new Map<string, string[]>();
    const lettersMap = new Map<string, string[]>();
    const segmentsMap = new Map<string, string[]>();
    const actionsMap = new Map<string, string[]>();
    for (const peer of peers) {
      if (!peer.selection) continue;
      const sel = presenceSelectionToGraph(peer.selection, letters);
      if (!sel) continue;
      const peerColor = peer.profile?.avatarColorHex ?? peer.color;
      if (sel.kind === "segment") {
        const list = segmentsMap.get(sel.segmentId) ?? [];
        list.push(peerColor);
        segmentsMap.set(sel.segmentId, list);
      } else if (sel.kind === "actions" && sel.actionId) {
        const list = actionsMap.get(sel.actionId) ?? [];
        list.push(peerColor);
        actionsMap.set(sel.actionId, list);
      } else if (sel.kind === "letter" || sel.kind === "actions") {
        const key = `${sel.groupId}:${sel.variantKey}`;
        const list = lettersMap.get(key) ?? [];
        list.push(peerColor);
        lettersMap.set(key, list);
      } else if (sel.kind === "group") {
        const list = groups.get(sel.groupId) ?? [];
        list.push(peerColor);
        groups.set(sel.groupId, list);
      }
    }
    return {
      groups,
      letters: lettersMap,
      segments: segmentsMap,
      actions: actionsMap,
    };
  }, [peers, letters]);

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
        leading={<NavMenuButton />}
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
              aria-label={editingEnabled ? "Disable drag and drop" : "Enable drag and drop"}
              title={editingEnabled ? "Disable drag and drop" : "Enable drag and drop"}
              onClick={() => setEditingEnabled((v) => !v)}
              className={editingEnabled ? "border-primary bg-primary text-primary-foreground [&:hover]:bg-primary/90" : ""}
            >
              <IconDragDrop size={16} />
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
              <IconBolt size={16} />
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
              <IconInfoCircle size={16} />
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
              actionTemplateGroups={actionTemplateGroups}
              days={days}
              segments={segments}
              nations={nations}
              endingAssignments={endingAssignments}
              endingVariables={endingVariables}
              endingValues={endingValues}
              impactFilter={filter}
              editingEnabled={editingEnabled}
              recordUndo={recordUndo}
              selection={inspectorOpen ? selection : null}
              onSelectionChange={handleSelectionChange}
              selfRingColor={selfColor}
              peerRings={peerRings}
              onRowDeleting={broadcastRowDeleting}
            />
          </div>
          {overlayOpen ? (
            <aside className="w-[380px] shrink-0 lg:w-[420px]">
              <ImpactOverlayPanel
                nations={nations}
                endingVariables={endingVariables}
                frameworkOptions={frameworkOptions}
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
                templateGroups={actionTemplateGroups}
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

  if (peer.focus && focusMatchesView(peer.focus, peer.selection)) {
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
    if (sel.view === "actions" && sel.letterId) {
      const l = letters.find((x) => x.id === sel.letterId);
      if (l?.content_id) return `Actions ${l.content_id}`;
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
    actionId: sel.kind === "actions" ? sel.actionId ?? null : null,
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
      ? {
          kind: "actions",
          groupId: sel.groupId,
          variantKey,
          actionId: sel.actionId ?? undefined,
        }
      : { kind: "letter", groupId: sel.groupId, variantKey };
  }
  if (sel.groupId) {
    return { kind: "group", groupId: sel.groupId };
  }
  return null;
}
