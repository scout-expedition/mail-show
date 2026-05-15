"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  EdgeLabelRenderer,
  MarkerType,
  PanOnScrollMode,
  Panel,
  Position,
  ReactFlow,
  getBezierPath,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type FinalConnectionState,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  IconFocusCentered,
  IconMinus,
  IconPlus,
  IconZoomScan,
} from "@tabler/icons-react";
import { CalendarPlus, ChevronRight, Copy, MailOpen, Mails, Megaphone, Milestone, Pin, PinOff, Trash2 } from "lucide-react";
import { readableOnHex, StorylinePill } from "@/components/pills";
import { IconDisplay } from "@/components/icon-display";
import { useConfirm } from "@/components/confirm-dialog";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import {
  extractActiveImpacts,
  type ActiveImpact,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import {
  addActionFromTemplate,
  batchMoveToDay,
  createInspectionLettersInGroup,
  createLetterGroupInStoryline,
  createNextDay,
  createReportSegmentsForGroupAtDay,
  deleteActionRow,
  deleteGroup,
  deleteInspectionLetter,
  deleteReportSegment,
  duplicateInspectionLetter,
  duplicateReportSegment,
  moveInspectionLetterToDay,
  moveLetterGroupToDay,
  moveLetterToGroup,
  moveReportSegmentToDay,
  pinInspectionLetterToDay,
  pinReportSegmentToDay,
  setActionNextLetterByLetterId,
  setActionReportSegment,
} from "../inspection/letters/actions";
import { useLocalStorage } from "@/lib/use-local-storage";
import { ActionIconEdge, type ActionIconEdgeData } from "./edges/action-icon-edge";
import ColumnBandNode from "./nodes/column-band";
import ConnectionSourceNode from "./nodes/connection-source";
import {
  GraphContextMenu,
  type GraphContextMenuItem,
} from "./graph-context-menu";
import LetterGroupNode from "./nodes/letter-group";
import LetterNode from "./nodes/letter-node";
import ReportNode from "./nodes/report-node";
import ReportClusterNode from "./nodes/report-cluster";
import StubTargetNode from "./nodes/stub-target";
import EndpointTargetNode from "./nodes/endpoint-target";

/**
 * Selection on the graph. Mirrors the inspector panel's drill-down levels so
 * a single value drives both the highlighted node and the panel state.
 *   - "group": just the group is selected (panel opens to group detail).
 *   - "letter": a specific variant within a group (panel → letter detail).
 *   - "segment": a report segment (panel → segment detail).
 *   - "actions": the actions list for a letter; optional actionId to scroll
 *     the panel to that action.
 */
export type GraphSelection =
  | { kind: "group"; groupId: string }
  | { kind: "letter"; groupId: string; variantKey: string }
  | { kind: "segment"; segmentId: string }
  | {
      kind: "actions";
      groupId: string;
      variantKey: string;
      actionId?: string;
    };

/**
 * Inverse of a single graph mutation, captured at dispatch time so the
 * Undo button / Cmd+Z can revert without round-tripping fresh state. The
 * client only stores ids + previous values — applying an entry calls the
 * same server action that produced the change in reverse.
 */
export type UndoEntry =
  | { kind: "moveLetterGroup"; groupId: string; previousDayId: string | null }
  | { kind: "moveLetter"; letterId: string; previousGroupId: string }
  | {
      kind: "moveReport";
      segmentId: string;
      previousOverrideId: string | null;
      previousOffset: number | null;
    }
  | {
      kind: "setNextLetter";
      actionId: string;
      previousLetterId: string | null;
    }
  | {
      kind: "setReport";
      actionId: string;
      previousReportSegmentId: string | null;
    }
  | { kind: "batch"; entries: UndoEntry[] };

type Props = {
  storylines: Storyline[];
  letterGroups: LetterGroup[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  actionTemplates: ActionTemplate[];
  days: Day[];
  segments: ReportSegmentView[];
  nations: Nation[];
  endingAssignments: InspectionActionEndingAssignment[];
  impactFilter: ImpactFilter;
  /**
   * When false, the graph is locked: nodes don't drag, edges don't
   * reconnect, no new connections start. Pan/zoom + node click still
   * work. Header toggle in graph-surface flips this.
   */
  editingEnabled?: boolean;
  /**
   * Capture an inverse op before each mutating dispatch so the surface's
   * Undo button can replay it. Optional — when omitted, mutations still
   * happen, just without an undo entry.
   */
  recordUndo?: (entry: UndoEntry) => void;
  selection?: GraphSelection | null;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  /**
   * Avatar color of the current user. When set, the selection ring on
   * any graph node the user has selected renders in this color instead
   * of the generic `var(--ring)`.
   */
  selfRingColor?: string | null;
  /**
   * Peer co-selection colors, bucketed by node type. Each entry is the
   * avatar color of a peer currently selecting that node — multiple
   * peers stack as concentric outer rings.
   *   • groups: keyed by groupId
   *   • letters: keyed by `${groupId}:${variantKey}` (matches GraphSelection.letter)
   *   • segments: keyed by segmentId
   *   • actions: keyed by actionId
   */
  peerRings?: PeerRingMap;
};

export type PeerRingMap = {
  groups: Map<string, string[]>;
  letters: Map<string, string[]>;
  segments: Map<string, string[]>;
  actions: Map<string, string[]>;
};

// ------------------------------------------------------------------
// Layout constants — vertical orientation
//   rows = days (Y axis), columns = storylines (X axis), flow goes top→down.
// ------------------------------------------------------------------
const GUTTER_W = 44; // left gutter for day labels
const HEADER_H = 33; // top header for storyline labels — visually matches the inspector PanelHeader (the panel's min-h-10 plus border-b reads thicker than its CSS height because of the body bg contrast; the scrim's bg-card/80 has no such contrast, so a smaller height matches the perceived weight)
const CELL_GAP = 60; // gap between sibling groups/reports inside a cell — matches VARIANT_GAP so reports and letter variants use the same horizontal pitch within a row
const CELL_VGAP = 40; // vertical gap between reports half and groups half
const ROW_TOP_PAD = 56;
const ROW_BOTTOM_PAD = 32;
const MIN_ROW_CONTENT_H = 80;

// Storyline columns size to their content; this is the floor.
const STORYLINE_COL_MIN_W = 320;
const STORYLINE_COL_PAD_X = 16;

// Report and letter pills share a fixed width so cells line up cleanly.
const PILL_W = 110;

const GROUP_PAD_LEADING = 56; // horizontal padding inside the group outline
const GROUP_PAD_TRAILING = 56;
const GROUP_PAD_TOP = 14; // vertical padding inside the group outline
const GROUP_PAD_BOTTOM = 14;
const VARIANT_GAP = 60; // horizontal gap between sibling variants in a group — wide enough that impact-overlay badges between adjacent variants don't collide

// Card geometry — must match the PillCard layout in components/pills.tsx.
const PILL_H = 24; // h-6
const CARD_BORDER_V = 3; // border-[1.5px] top + bottom
const HEADING_ONLY_H = CARD_BORDER_V + PILL_H; // 27
// Card width including the 1.5px borders on both sides.
const CARD_W = PILL_W + CARD_BORDER_V;

// Body text uses text-xs leading-snug (12px × 1.375 ≈ 16.5px per line).
const BODY_LINE_H = 17;
const BODY_PAD_V = 8; // py-1 top + bottom
const MAX_BODY_LINES = 3; // line-clamped in the card
const CHARS_PER_LINE = 18; // rough sans chars at width = PILL_W

function summaryLines(summary: string | null | undefined): number {
  if (!summary) return 0;
  const trimmed = summary.trim();
  if (!trimmed) return 0;
  return Math.min(
    MAX_BODY_LINES,
    Math.max(1, Math.ceil(trimmed.length / CHARS_PER_LINE))
  );
}

function cardHeight(summary: string | null | undefined): number {
  const lines = summaryLines(summary);
  if (lines === 0) return HEADING_ONLY_H;
  return HEADING_ONLY_H + lines * BODY_LINE_H + BODY_PAD_V;
}

// Action chip geometry — chips on cross-row edges all share one Y axis
// (row boundary) and stack horizontally with at least CHIP_PITCH between
// adjacent chip centers, so they never overlap.
const CHIP_H = 20;
const CHIP_GAP = 4;
const CHIP_PITCH = 36;

// Impact-overlay badge geometry — badges stack to the RIGHT of the chip when
// the overlay is on. The bucket collision pass grows the chip-to-chip pitch
// along X so badge stacks never spill onto an adjacent chip's path. Up to 4
// badges wrap at 2 per row; 5+ wrap at 3 per row.
const BADGE_W = 36;
const BADGE_H_GAP = 2;
const CHIP_TO_BADGES_GAP = 3;

export function badgeColsFor(n: number): number {
  return n <= 4 ? 2 : 3;
}

/**
 * Horizontal extent of the badge stack drawn to the RIGHT of the chip, in
 * px. World status and demerits share a top row; class and nation
 * affinities wrap beneath at badgeColsFor(). The stack width is the widest
 * row.
 */
function badgeStackExtentRight(impacts: ActiveImpact[]): number {
  if (impacts.length === 0) return 0;
  const worldCount = impacts.filter((i) => i.key.startsWith("world:")).length;
  const others = impacts.length - worldCount;
  const worldRowW =
    worldCount > 0
      ? worldCount * BADGE_W + Math.max(0, worldCount - 1) * BADGE_H_GAP
      : 0;
  const otherCols = others === 0 ? 0 : Math.min(others, badgeColsFor(others));
  const othersRowW =
    otherCols > 0
      ? otherCols * BADGE_W + Math.max(0, otherCols - 1) * BADGE_H_GAP
      : 0;
  const rowW = Math.max(worldRowW, othersRowW);
  return rowW > 0 ? CHIP_TO_BADGES_GAP + rowW : 0;
}

function groupWidth(variantCount: number): number {
  return (
    GROUP_PAD_LEADING +
    variantCount * CARD_W +
    Math.max(0, variantCount - 1) * VARIANT_GAP +
    GROUP_PAD_TRAILING
  );
}

function groupHeight(maxCardH: number): number {
  return GROUP_PAD_TOP + maxCardH + GROUP_PAD_BOTTOM;
}

const nodeTypes = {
  columnBand: ColumnBandNode,
  letterGroup: LetterGroupNode,
  letter: LetterNode,
  report: ReportNode,
  reportCluster: ReportClusterNode,
  stubTarget: StubTargetNode,
  endpointTarget: EndpointTargetNode,
  connectionSource: ConnectionSourceNode,
};

const edgeTypes = {
  actionIcon: ActionIconEdge,
};

// Variant key for a letter row. Null variants collapse to "".
/**
 * Convert a lowercase roman numeral ("i", "ii", "iii", "iv", "ix", …) to its
 * integer value. Returns `Number.MAX_SAFE_INTEGER` for unrecognized input so
 * sorts push it to the end rather than collapsing it to 0.
 */
function romanToInt(v: string | null | undefined): number {
  if (!v) return Number.MAX_SAFE_INTEGER;
  const map: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  const s = v.toLowerCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    if (cur == null) return Number.MAX_SAFE_INTEGER;
    if (next != null && cur < next) {
      total -= cur;
    } else {
      total += cur;
    }
  }
  return total;
}

function variantKey(v: string | null): string {
  return v ?? "";
}

// Compact lowercase roman-numeral encoder — used to pre-pick variants on
// optimistic-ghost report segments before the server returns. Limited to
// the small integer range we actually need on the graph.
function toRoman(n: number): string {
  if (n <= 0) return String(n);
  const pairs: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rem = n;
  for (const [v, ch] of pairs) {
    while (rem >= v) {
      out += ch;
      rem -= v;
    }
  }
  return out;
}

/** Signed display text for a relative delivery offset, e.g. 3 → "+3". */
function formatDeliveryOffset(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function letterDisplayId(
  abbr: string,
  sequence: number,
  variant: string | null,
  onlyVariantInGroup: boolean
): string {
  if (!variant || onlyVariantInGroup) return `L-${abbr}${sequence}`;
  return `L-${abbr}${sequence}/${variant}`;
}

/**
 * Group / letter node IDs encode a (groupId, optional dayKey) tuple so the
 * same logical group can render multiple instances on the canvas (one per
 * day where its letters effectively land). The primary instance keeps the
 * historical bare-groupId format so drag/undo/selection handlers that only
 * need the groupId continue to work unchanged.
 *
 *   Primary instance — letters on the group's own delivery day:
 *     group:GID                  letter:GID:VARIANT
 *   Secondary instance — letters with overrides that put them on a different
 *   day from the group:
 *     group:GID@DAY              letter:GID:VARIANT@DAY
 */
function makeGroupNodeId(groupId: string, dayKey: string | null): string {
  return dayKey ? `group:${groupId}@${dayKey}` : `group:${groupId}`;
}
function makeLetterNodeId(
  groupId: string,
  variantKey: string,
  dayKey: string | null
): string {
  return dayKey
    ? `letter:${groupId}:${variantKey}@${dayKey}`
    : `letter:${groupId}:${variantKey}`;
}
function parseGroupNodeId(
  id: string
): { groupId: string; dayKey: string | null } | null {
  if (!id.startsWith("group:")) return null;
  const rest = id.slice("group:".length);
  const at = rest.indexOf("@");
  if (at === -1) return { groupId: rest, dayKey: null };
  return { groupId: rest.slice(0, at), dayKey: rest.slice(at + 1) };
}
function parseLetterNodeId(
  id: string
): { groupId: string; variantKey: string; dayKey: string | null } | null {
  if (!id.startsWith("letter:")) return null;
  const rest = id.slice("letter:".length);
  const colon = rest.indexOf(":");
  if (colon === -1) return null;
  const groupId = rest.slice(0, colon);
  const tail = rest.slice(colon + 1);
  const at = tail.indexOf("@");
  if (at === -1) return { groupId, variantKey: tail, dayKey: null };
  return {
    groupId,
    variantKey: tail.slice(0, at),
    dayKey: tail.slice(at + 1),
  };
}

export function GraphView({
  storylines,
  letterGroups,
  letters,
  actions,
  actionTemplates,
  days,
  segments,
  nations,
  endingAssignments,
  impactFilter,
  editingEnabled = false,
  recordUndo,
  selection = null,
  onSelectionChange,
  selfRingColor = null,
  peerRings,
}: Props) {
  // Fallback empty maps so call sites don't crash when presence is
  // disabled or when no peers are co-selecting any nodes.
  const peerGroups = peerRings?.groups;
  const peerLetters = peerRings?.letters;
  const peerSegments = peerRings?.segments;
  const peerActions = peerRings?.actions;
  const select = useCallback(
    (sel: GraphSelection | null) => onSelectionChange?.(sel),
    [onSelectionChange]
  );

  // Optimistic add tracking. When the user triggers a create on a
  // letter group or report segment, we synthesize a fully-shaped
  // "ghost" entity here and the layout treats it as a normal row —
  // so the new card appears in its target cell immediately (pulsing
  // + greyed via the pendingAdd flag). After the server returns the
  // real id we stamp `resolvedRealId`; the cleanup effect drops the
  // ghost the moment the matching real entity lands in server data.
  // Errors clear the ghost immediately so the UI reverts to truth.
  type PendingAdd<T extends { id: string }> = {
    tempId: string;
    ghost: T;
    resolvedRealId: string | null;
  };
  const [pendingAdds, setPendingAdds] = useState<{
    groups: PendingAdd<LetterGroup>[];
    segments: PendingAdd<ReportSegmentView>[];
    letters: PendingAdd<InspectionLetterView>[];
    days: PendingAdd<Day>[];
  }>({ groups: [], segments: [], letters: [], days: [] });
  const nextGhostIdRef = useRef(0);
  const makeGhostId = useCallback((prefix: string) => {
    const n = ++nextGhostIdRef.current;
    return `ghost-${prefix}-${Date.now()}-${n}`;
  }, []);
  const removePendingGroup = useCallback((tempId: string) => {
    setPendingAdds((prev) => ({
      ...prev,
      groups: prev.groups.filter((p) => p.tempId !== tempId),
    }));
  }, []);
  const removePendingSegment = useCallback((tempId: string) => {
    setPendingAdds((prev) => ({
      ...prev,
      segments: prev.segments.filter((p) => p.tempId !== tempId),
    }));
  }, []);
  const resolvePendingGroup = useCallback(
    (tempId: string, realId: string) => {
      setPendingAdds((prev) => ({
        ...prev,
        groups: prev.groups.map((p) =>
          p.tempId === tempId ? { ...p, resolvedRealId: realId } : p
        ),
      }));
    },
    []
  );
  const resolvePendingSegment = useCallback(
    (tempId: string, realId: string) => {
      setPendingAdds((prev) => ({
        ...prev,
        segments: prev.segments.map((p) =>
          p.tempId === tempId ? { ...p, resolvedRealId: realId } : p
        ),
      }));
    },
    []
  );
  const removePendingLetter = useCallback((tempId: string) => {
    setPendingAdds((prev) => ({
      ...prev,
      letters: prev.letters.filter((p) => p.tempId !== tempId),
    }));
  }, []);
  const resolvePendingLetter = useCallback(
    (tempId: string, realId: string) => {
      setPendingAdds((prev) => ({
        ...prev,
        letters: prev.letters.map((p) =>
          p.tempId === tempId ? { ...p, resolvedRealId: realId } : p
        ),
      }));
    },
    []
  );
  const removePendingDay = useCallback((tempId: string) => {
    setPendingAdds((prev) => ({
      ...prev,
      days: prev.days.filter((p) => p.tempId !== tempId),
    }));
  }, []);
  const resolvePendingDay = useCallback((tempId: string, realId: string) => {
    setPendingAdds((prev) => ({
      ...prev,
      days: prev.days.map((p) =>
        p.tempId === tempId ? { ...p, resolvedRealId: realId } : p
      ),
    }));
  }, []);

  // Drop resolved ghosts once the matching real entity has landed.
  useEffect(() => {
    setPendingAdds((prev) => {
      const realGroupIds = new Set(letterGroups.map((g) => g.id));
      const realSegIds = new Set(segments.map((s) => s.id));
      const realLetterIds = new Set(letters.map((l) => l.id));
      const realDayIds = new Set(days.map((d) => d.id));
      const stayed = <T extends { id: string }>(real: Set<string>) =>
        (p: PendingAdd<T>) =>
          p.resolvedRealId == null || !real.has(p.resolvedRealId);
      const nextGroups = prev.groups.filter(stayed<LetterGroup>(realGroupIds));
      const nextSegments = prev.segments.filter(
        stayed<ReportSegmentView>(realSegIds)
      );
      const nextLetters = prev.letters.filter(
        stayed<InspectionLetterView>(realLetterIds)
      );
      const nextDays = prev.days.filter(stayed<Day>(realDayIds));
      if (
        nextGroups.length === prev.groups.length &&
        nextSegments.length === prev.segments.length &&
        nextLetters.length === prev.letters.length &&
        nextDays.length === prev.days.length
      ) {
        return prev;
      }
      return {
        groups: nextGroups,
        segments: nextSegments,
        letters: nextLetters,
        days: nextDays,
      };
    });
  }, [letterGroups, segments, letters, days]);

  // Optimistic delete tracking. When the user confirms a delete on a
  // letter / report / group / action, we add its id to the matching
  // bucket so the layout can render it greyed-out + pulsing for the
  // brief moment between dispatch and revalidation. Entries are auto-
  // dropped by the useEffect below once the entity disappears from the
  // server data.
  type PendingDeleteBuckets = {
    letters: Record<string, true>;
    segments: Record<string, true>;
    groups: Record<string, true>;
    actions: Record<string, true>;
  };
  const [pendingDeletes, setPendingDeletes] = useState<PendingDeleteBuckets>({
    letters: {},
    segments: {},
    groups: {},
    actions: {},
  });
  const markPendingDelete = useCallback(
    (kind: keyof PendingDeleteBuckets, id: string) => {
      setPendingDeletes((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], [id]: true },
      }));
    },
    []
  );
  // Drop pending-delete ids the moment the entity is no longer in the
  // server-side list (i.e. revalidation has caught up).
  useEffect(() => {
    setPendingDeletes((prev) => {
      const letterIds = new Set(letters.map((l) => l.id));
      const segmentIds = new Set(segments.map((s) => s.id));
      const groupIds = new Set(letterGroups.map((g) => g.id));
      const actionIds = new Set(actions.map((a) => a.id));
      let changed = false;
      const cleanup = (
        kind: keyof PendingDeleteBuckets,
        liveIds: Set<string>
      ): Record<string, true> => {
        const out: Record<string, true> = {};
        let kindChanged = false;
        for (const id of Object.keys(prev[kind])) {
          if (liveIds.has(id)) out[id] = true;
          else kindChanged = true;
        }
        if (kindChanged) changed = true;
        return kindChanged ? out : prev[kind];
      };
      const next: PendingDeleteBuckets = {
        letters: cleanup("letters", letterIds),
        segments: cleanup("segments", segmentIds),
        groups: cleanup("groups", groupIds),
        actions: cleanup("actions", actionIds),
      };
      return changed ? next : prev;
    });
  }, [letters, segments, letterGroups, actions]);

  // Optimistic overrides for in-flight edge reconnects. The layout
  // useMemo reads from these maps first, so the dragged edge snaps to
  // the new target the instant the user drops — no flash of the old
  // edge between drop and server revalidation.
  //
  // Entries are NOT cleared in the server-action's finally{} (that
  // races the RSC re-render and produces a brief flash to the old
  // state). Instead, the useEffect below watches `actions` and drops
  // each entry once server state matches the optimistic value.
  // Server-error paths clear immediately so the UI reverts to truth.
  const [optimisticNextByAction, setOptimisticNextByAction] = useState<
    Record<string, string | null>
  >({});
  const [optimisticReportByAction, setOptimisticReportByAction] = useState<
    Record<string, string | null>
  >({});

  // Drop optimistic entries once the server-side actions list has caught
  // up. Looking at one `actions` snapshot at a time means we never strand
  // a stale optimistic value visually past the revalidation.
  useEffect(() => {
    setOptimisticNextByAction((prev) => {
      let changed = false;
      const next: Record<string, string | null> = {};
      for (const [aid, opt] of Object.entries(prev)) {
        const action = actions.find((a) => a.id === aid);
        if (action && (action.next_letter_variant ?? null) === opt) {
          changed = true;
        } else {
          next[aid] = opt;
        }
      }
      return changed ? next : prev;
    });
    setOptimisticReportByAction((prev) => {
      let changed = false;
      const next: Record<string, string | null> = {};
      for (const [aid, opt] of Object.entries(prev)) {
        const action = actions.find((a) => a.id === aid);
        if (action && (action.report_segment_id ?? null) === opt) {
          changed = true;
        } else {
          next[aid] = opt;
        }
      }
      return changed ? next : prev;
    });
  }, [actions]);

  // Wrap the next-letter / report-segment server calls in an optimistic
  // overlay + error-recovery clear. On success, the overlay sticks until
  // the actions effect above lands the matching server state. On error,
  // we drop the overlay immediately so the UI reverts to truth.
  const dispatchNextLetter = useCallback(
    async (
      actionId: string,
      letterId: string | null,
      optimisticVariant: string | null
    ): Promise<void> => {
      setOptimisticNextByAction((prev) => ({
        ...prev,
        [actionId]: optimisticVariant,
      }));
      try {
        await setActionNextLetterByLetterId(actionId, letterId);
      } catch (err) {
        setOptimisticNextByAction((prev) => {
          if (!(actionId in prev)) return prev;
          const n = { ...prev };
          delete n[actionId];
          return n;
        });
        throw err;
      }
    },
    []
  );
  const dispatchReportSegment = useCallback(
    async (
      actionId: string,
      segmentId: string | null
    ): Promise<void> => {
      setOptimisticReportByAction((prev) => ({
        ...prev,
        [actionId]: segmentId,
      }));
      try {
        await setActionReportSegment(actionId, segmentId);
      } catch (err) {
        setOptimisticReportByAction((prev) => {
          if (!(actionId in prev)) return prev;
          const n = { ...prev };
          delete n[actionId];
          return n;
        });
        throw err;
      }
    },
    []
  );
  const {
    nodes,
    edges,
    labelRows,
    labelCols,
    selectionCenter,
    rowMeta,
    groupMeta,
  } = useMemo(() => {
    // -------------------------------------------------------------
    // Augment server data with optimistic-add ghosts. Each ghost is
    // a full LetterGroup / ReportSegmentView so the rest of the
    // layout code treats it as a normal entity (positioned in its
    // cell, styled by id). A ghost whose `resolvedRealId` has landed
    // in real server data is filtered out here so we never render the
    // real + ghost simultaneously.
    // -------------------------------------------------------------
    const realGroupIds = new Set(letterGroups.map((g) => g.id));
    const realSegmentIds = new Set(segments.map((s) => s.id));
    const ghostGroupIdSet = new Set<string>();
    const ghostSegmentIdSet = new Set<string>();
    const augmentedLetterGroups: LetterGroup[] = letterGroups.slice();
    for (const p of pendingAdds.groups) {
      if (p.resolvedRealId && realGroupIds.has(p.resolvedRealId)) continue;
      augmentedLetterGroups.push(p.ghost);
      ghostGroupIdSet.add(p.ghost.id);
    }
    const augmentedSegments: ReportSegmentView[] = segments.slice();
    for (const p of pendingAdds.segments) {
      if (p.resolvedRealId && realSegmentIds.has(p.resolvedRealId)) continue;
      augmentedSegments.push(p.ghost);
      ghostSegmentIdSet.add(p.ghost.id);
    }
    const realLetterIds = new Set(letters.map((l) => l.id));
    const realDayIds = new Set(days.map((d) => d.id));
    const ghostLetterIdSet = new Set<string>();
    const ghostDayIdSet = new Set<string>();
    const augmentedLetters: InspectionLetterView[] = letters.slice();
    for (const p of pendingAdds.letters) {
      if (p.resolvedRealId && realLetterIds.has(p.resolvedRealId)) continue;
      augmentedLetters.push(p.ghost);
      ghostLetterIdSet.add(p.ghost.id);
    }
    const augmentedDays: Day[] = days.slice();
    for (const p of pendingAdds.days) {
      if (p.resolvedRealId && realDayIds.has(p.resolvedRealId)) continue;
      augmentedDays.push(p.ghost);
      ghostDayIdSet.add(p.ghost.id);
    }
    augmentedDays.sort((a, b) => a.number - b.number);

    // -------------------------------------------------------------
    // Rows (days + unscheduled bucket) — flow top→down
    // -------------------------------------------------------------
    const rowIds: string[] = [...augmentedDays.map((d) => d.id), "unscheduled"];
    const dayById = new Map(augmentedDays.map((d) => [d.id, d]));
    const rowIndex = new Map<string, number>();
    rowIds.forEach((id, i) => rowIndex.set(id, i));

    // -------------------------------------------------------------
    // Storyline → column
    // -------------------------------------------------------------
    const orderedStorylines = storylines.slice().sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const colIndex = new Map<string, number>();
    orderedStorylines.forEach((s, i) => colIndex.set(s.id, i));
    const storylineById = new Map(storylines.map((s) => [s.id, s]));

    // -------------------------------------------------------------
    // Group → variants (variants stack horizontally inside the group)
    // -------------------------------------------------------------
    // A "group instance" is a (group, day) pair: the same group renders an
    // additional pill on every day where one of its letters effectively
    // lands (via delivery_day_offset / delivery_day_override_id). The
    // primary instance sits on the group's own delivery_day_id; secondary
    // instances are keyed by the override day. Edge endpoints, drag
    // targets, and selection all reference instance node ids so each pill
    // is independently click-/drop-able.
    type GroupInstance = {
      nodeId: string;
      instanceKey: string; // for cells: same as nodeId minus "group:" prefix
      groupId: string;
      group: LetterGroup;
      storyline: Storyline;
      rowId: string;
      dayKey: string | null; // null = primary
      variants: string[]; // variant keys this instance contains
      variantHeights: number[];
      width: number;
      height: number;
    };

    // For each (group, variant), the primary letter is the lowest-piece one.
    // Summary shown in the card comes from this primary letter.
    const primaryLetterByGroupVariant = new Map<string, InspectionLetterView>();
    for (const l of augmentedLetters) {
      const key = `${l.letter_group_id}:${variantKey(l.variant)}`;
      const existing = primaryLetterByGroupVariant.get(key);
      if (!existing || (l.piece ?? 0) < (existing.piece ?? 0)) {
        primaryLetterByGroupVariant.set(key, l);
      }
    }

    // Each letter's effective day → which group instance houses it.
    const letterEffectiveDayKey = (l: InspectionLetterView): string =>
      l.effective_day_id ?? "unscheduled";

    // groupInstancesById indexed by instance node id ("group:GID" or
    // "group:GID@DAY"). instancesByGroup gives all instances for a group.
    const groupInstancesById = new Map<string, GroupInstance>();
    const instancesByGroup = new Map<string, GroupInstance[]>();
    for (const g of augmentedLetterGroups) {
      const storyline = storylineById.get(g.storyline_id);
      if (!storyline) continue;
      const groupLetters = augmentedLetters.filter(
        (l) => l.letter_group_id === g.id
      );
      const gDayKey = g.delivery_day_id ?? "unscheduled";

      // Partition variants by their effective day. A variant can have
      // multiple letters (different pieces); they should always share an
      // effective_day_id since override is set per letter row, but if for
      // some reason they diverge we follow the primary letter's day.
      const variantByLetter: Array<{ variant: string; dayKey: string }> = [];
      const seen = new Set<string>();
      for (const l of groupLetters
        .slice()
        .sort((a, b) => {
          const va = a.variant ?? "";
          const vb = b.variant ?? "";
          if (va !== vb) return va.localeCompare(vb);
          return (a.piece ?? 0) - (b.piece ?? 0);
        })) {
        const vk = variantKey(l.variant);
        if (seen.has(vk)) continue;
        seen.add(vk);
        const primary = primaryLetterByGroupVariant.get(`${g.id}:${vk}`);
        variantByLetter.push({
          variant: vk,
          dayKey: letterEffectiveDayKey(primary ?? l),
        });
      }

      // Per-day bucket of variants. Always include the primary day bucket
      // (gDayKey) even if empty so the group's "home" pill still renders.
      const variantsByDay = new Map<string, string[]>();
      variantsByDay.set(gDayKey, []);
      for (const { variant, dayKey } of variantByLetter) {
        const list = variantsByDay.get(dayKey) ?? [];
        list.push(variant);
        variantsByDay.set(dayKey, list);
      }

      const instances: GroupInstance[] = [];
      for (const [dayKey, vs] of variantsByDay) {
        const isPrimary = dayKey === gDayKey;
        const instanceDayKey = isPrimary ? null : dayKey;
        const variantHeights =
          vs.length === 0
            ? [HEADING_ONLY_H]
            : vs.map((vk) => {
                const primary = primaryLetterByGroupVariant.get(
                  `${g.id}:${vk}`
                );
                return cardHeight(primary?.summary);
              });
        const maxCardH = variantHeights.reduce((a, b) => Math.max(a, b), 0);
        const width = groupWidth(Math.max(1, vs.length));
        const height = groupHeight(maxCardH);
        const nodeId = makeGroupNodeId(g.id, instanceDayKey);
        const inst: GroupInstance = {
          nodeId,
          instanceKey: nodeId.slice("group:".length),
          groupId: g.id,
          group: g,
          storyline,
          rowId: dayKey,
          dayKey: instanceDayKey,
          variants: vs,
          variantHeights,
          width,
          height,
        };
        groupInstancesById.set(nodeId, inst);
        instances.push(inst);
      }
      instancesByGroup.set(g.id, instances);
    }

    // -------------------------------------------------------------
    // Per-cell stacks
    //   Top half: reports stacked horizontally.
    //   Bottom half: groups stacked horizontally.
    // -------------------------------------------------------------
    type Cell = {
      rowId: string;
      storylineId: string;
      groupIds: string[];
      segmentIds: string[];
      width: number;
      height: number;
      topHalfH: number; // max(report cardHeight) across cell
      bottomHalfH: number; // max(group height) across cell
      topHalfW: number; // sum(report cardW) + gaps
      bottomHalfW: number; // sum(group width) + gaps
    };
    const cellKey = (rowId: string, storylineId: string) =>
      `${rowId}:${storylineId}`;
    const cells = new Map<string, Cell>();

    function getCell(rowId: string, storylineId: string): Cell {
      const k = cellKey(rowId, storylineId);
      const existing = cells.get(k);
      if (existing) return existing;
      const cell: Cell = {
        rowId,
        storylineId,
        groupIds: [],
        segmentIds: [],
        width: 0,
        height: 0,
        topHalfH: 0,
        bottomHalfH: 0,
        topHalfW: 0,
        bottomHalfW: 0,
      };
      cells.set(k, cell);
      return cell;
    }

    // Stable group order inside cell: by sequence, then primary instance
    // first followed by override-day instances. `cell.groupIds` actually
    // holds GROUP INSTANCE node ids ("group:GID" or "group:GID@DAY"), not
    // raw group ids — same key the placement and edge logic looks up.
    const orderedGroups = augmentedLetterGroups
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
    for (const g of orderedGroups) {
      const instances = instancesByGroup.get(g.id) ?? [];
      for (const inst of instances) {
        const cell = getCell(inst.rowId, g.storyline_id);
        cell.groupIds.push(inst.nodeId);
      }
    }

    // Segments into cells, clustered by letter-group sequence first
    // (so reports of the same letter group are always contiguous and
    // can be wrapped in a single outline box), then L→R by report
    // variant (i, ii, iii, …) within each cluster.
    const segmentById = new Map(augmentedSegments.map((s) => [s.id, s]));
    const orderedSegments = augmentedSegments
      .slice()
      .sort(
        (a, b) =>
          a.group_sequence - b.group_sequence ||
          romanToInt(a.variant) - romanToInt(b.variant) ||
          a.variant.localeCompare(b.variant)
      );
    for (const s of orderedSegments) {
      const rowId = s.effective_day_id ?? "unscheduled";
      const cell = getCell(rowId, s.storyline_id);
      cell.segmentIds.push(s.id);
    }

    // Cell dimensions: top half = reports horizontally, bottom half = groups
    // horizontally. Cell width is max(topHalfW, bottomHalfW); cell height is
    // top + bottom + (both nonempty ? CELL_VGAP : 0).
    for (const cell of cells.values()) {
      let bottomW = 0;
      let bottomH = 0;
      for (const instId of cell.groupIds) {
        const gi = groupInstancesById.get(instId);
        if (!gi) continue;
        if (bottomW > 0) bottomW += CELL_GAP;
        bottomW += gi.width;
        if (gi.height > bottomH) bottomH = gi.height;
      }
      let topW = 0;
      let topH = 0;
      cell.segmentIds.forEach((sid, i) => {
        const seg = segmentById.get(sid);
        if (!seg) return;
        if (i > 0) topW += CELL_GAP;
        topW += CARD_W;
        const ch = cardHeight(seg.summary);
        if (ch > topH) topH = ch;
      });
      cell.topHalfW = topW;
      cell.topHalfH = topH;
      cell.bottomHalfW = bottomW;
      cell.bottomHalfH = bottomH;
      cell.width = Math.max(topW, bottomW);
      const both = topH > 0 && bottomH > 0;
      cell.height = topH + bottomH + (both ? CELL_VGAP : 0);
    }

    // -------------------------------------------------------------
    // Row half heights — per row, the top half is the max report-card
    // height across all storyline columns in that row, and the bottom half
    // is the max group height. This locks reports to the top half and
    // groups to the bottom half across the entire row, even in cells where
    // one half is empty.
    // -------------------------------------------------------------
    const rowTopHalfHs = new Map<string, number>();
    const rowBottomHalfHs = new Map<string, number>();
    for (const rowId of rowIds) {
      rowTopHalfHs.set(rowId, 0);
      rowBottomHalfHs.set(rowId, 0);
    }
    for (const cell of cells.values()) {
      const t = rowTopHalfHs.get(cell.rowId) ?? 0;
      if (cell.topHalfH > t) rowTopHalfHs.set(cell.rowId, cell.topHalfH);
      const b = rowBottomHalfHs.get(cell.rowId) ?? 0;
      if (cell.bottomHalfH > b) rowBottomHalfHs.set(cell.rowId, cell.bottomHalfH);
    }
    const rowHeights = new Map<string, number>();
    for (const rowId of rowIds) {
      const topH = rowTopHalfHs.get(rowId) ?? 0;
      const bottomH = rowBottomHalfHs.get(rowId) ?? 0;
      const both = topH > 0 && bottomH > 0;
      const content = Math.max(
        topH + bottomH + (both ? CELL_VGAP : 0),
        MIN_ROW_CONTENT_H
      );
      rowHeights.set(rowId, content + ROW_TOP_PAD + ROW_BOTTOM_PAD);
    }
    const rowBaseY = new Map<string, number>();
    {
      let y = HEADER_H;
      for (const rowId of rowIds) {
        rowBaseY.set(rowId, y);
        y += rowHeights.get(rowId) ?? 0;
      }
    }
    // -------------------------------------------------------------
    // Storyline column widths (max cell content across that column, by row)
    // -------------------------------------------------------------
    const colContentWidths = new Map<string, number>();
    for (const s of orderedStorylines) colContentWidths.set(s.id, 0);
    for (const cell of cells.values()) {
      const cur = colContentWidths.get(cell.storylineId) ?? 0;
      if (cell.width > cur) colContentWidths.set(cell.storylineId, cell.width);
    }
    const colWidths = new Map<string, number>();
    for (const s of orderedStorylines) {
      const content = Math.max(
        colContentWidths.get(s.id) ?? 0,
        STORYLINE_COL_MIN_W
      );
      colWidths.set(s.id, content + STORYLINE_COL_PAD_X * 2);
    }
    // Shift content right by GUTTER_W so the sticky day-label overlay (which
    // sits at left:0 of the surface, regardless of pan) doesn't cover the
    // first storyline column at zoom 1 / pan 0.
    const colBaseX = new Map<string, number>();
    {
      let x = GUTTER_W;
      for (const s of orderedStorylines) {
        colBaseX.set(s.id, x);
        x += colWidths.get(s.id) ?? 0;
      }
    }
    const gridWidth = (() => {
      let x = GUTTER_W;
      for (const s of orderedStorylines) x += colWidths.get(s.id) ?? 0;
      return x;
    })();

    // -------------------------------------------------------------
    // Build nodes — order matters: bands first, then headers/labels,
    // then groups (parents), then letters (children), then segments.
    // -------------------------------------------------------------
    const n: Node[] = [];

    // Row bands (alternating tint), spanning full grid width.
    rowIds.forEach((rowId, i) => {
      n.push({
        id: `band:${rowId}`,
        type: "columnBand",
        position: { x: 0, y: rowBaseY.get(rowId) ?? 0 },
        data: {
          width: gridWidth,
          height: rowHeights.get(rowId) ?? 0,
          tinted: i % 2 === 1,
          isUnscheduled: rowId === "unscheduled",
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -10,
      });
    });

    // Day and storyline labels are rendered as sticky overlays outside of
    // ReactFlow (see StickyDayGutter / StickyStorylineHeader below) so they
    // remain pinned to the canvas edges as the user pans and zooms.

    // Absolute (x, y, h) for each card, keyed by node id, used later to
    // anchor chips and stub terminators. (x, y) is the card's TOP-LEFT
    // corner; h is the card's height so consumers can compute the bottom
    // edge for source-target midpoint chip placement.
    const letterAbsPos = new Map<string, { x: number; y: number; h: number }>();
    const segmentAbsPos = new Map<string, { x: number; y: number; h: number }>();

    // Groups + letters + segments per cell. Reports center horizontally in
    // the top half, letter-groups center horizontally in the bottom half.
    // The half boundaries are row-wide so groups always sit in the bottom
    // half across the entire row, even in cells where one half is empty.
    for (const rowId of rowIds) {
      const rowY = (rowBaseY.get(rowId) ?? 0) + ROW_TOP_PAD;
      const rowTopH = rowTopHalfHs.get(rowId) ?? 0;
      const rowBothHalves = rowTopH > 0 && (rowBottomHalfHs.get(rowId) ?? 0) > 0;
      for (const s of orderedStorylines) {
        const cell = cells.get(cellKey(rowId, s.id));
        if (!cell) continue;
        const colX = colBaseX.get(s.id) ?? 0;
        const colW = colWidths.get(s.id) ?? STORYLINE_COL_MIN_W;
        const colCenterX = colX + colW / 2;

        const topY = rowY;
        const bottomY = rowY + rowTopH + (rowBothHalves ? CELL_VGAP : 0);

        // Reports row in top half — stacked horizontally, centered in
        // column. Reports of the same letter group are contiguous (see
        // the group-sequence sort above); we track each contiguous run
        // so a cluster outline box can be drawn around it.
        let reportsX = colCenterX - cell.topHalfW / 2;
        const reportClusters: Array<{
          groupId: string;
          minX: number;
          maxX: number;
        }> = [];
        let curReportCluster: {
          groupId: string;
          minX: number;
          maxX: number;
        } | null = null;
        for (const sid of cell.segmentIds) {
          const seg = segmentById.get(sid);
          if (!seg) continue;
          const storyline = storylineById.get(seg.storyline_id);
          if (!storyline) continue;
          const segNodeId = `report:${sid}`;
          if (
            !curReportCluster ||
            curReportCluster.groupId !== seg.letter_group_id
          ) {
            curReportCluster = {
              groupId: seg.letter_group_id,
              minX: reportsX,
              maxX: reportsX + CARD_W,
            };
            reportClusters.push(curReportCluster);
          } else {
            curReportCluster.maxX = reportsX + CARD_W;
          }
          segmentAbsPos.set(segNodeId, {
            x: reportsX,
            y: topY,
            h: cardHeight(seg.summary),
          });
          const segSelected =
            selection?.kind === "segment" && selection.segmentId === sid;
          n.push({
            id: segNodeId,
            type: "report",
            position: { x: reportsX, y: topY },
            data: {
              reportId: seg.report_id,
              storyline,
              summary: seg.summary,
              widthPx: PILL_W,
              selected: segSelected,
              selfRingColor: segSelected ? selfRingColor ?? undefined : undefined,
              peerRingColors: peerSegments?.get(sid),
              pendingDelete: pendingDeletes.segments[sid] === true,
              pendingAdd: ghostSegmentIdSet.has(sid),
              pinned: seg.delivery_day_override_id != null,
              offsetText:
                seg.delivery_day_offset != null
                  ? formatDeliveryOffset(seg.delivery_day_offset)
                  : null,
              onSelect: () => select({ kind: "segment", segmentId: sid }),
            },
            // Per-node `draggable` overrides ReactFlow's global
            // `nodesDraggable` flag, so we must gate it on editingEnabled
            // here too — otherwise the lock toggle doesn't actually
            // disable day-moving drags.
            draggable: editingEnabled,
            selectable: false,
            focusable: false,
          });
          reportsX += CARD_W + CELL_GAP;
        }

        // Cluster outline boxes: one per contiguous same-letter-group run
        // of reports. Sits behind the report cards (zIndex -5, above the
        // row band) and uses the row's top-half height so every box in a
        // row reads at a uniform height.
        const REPORT_CLUSTER_PAD = 8;
        for (const cl of reportClusters) {
          n.push({
            id: `reportcluster:${rowId}:${cl.groupId}`,
            type: "reportCluster",
            position: {
              x: cl.minX - REPORT_CLUSTER_PAD,
              y: topY - REPORT_CLUSTER_PAD,
            },
            data: {
              width: cl.maxX - cl.minX + REPORT_CLUSTER_PAD * 2,
              height: rowTopH + REPORT_CLUSTER_PAD * 2,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: -5,
          });
        }

        // Groups row in bottom half — stacked horizontally, centered in column.
        let groupsX = colCenterX - cell.bottomHalfW / 2;
        for (const instId of cell.groupIds) {
          const gi = groupInstancesById.get(instId);
          if (!gi) continue;
          const gid = gi.groupId;
          const abbr = gi.storyline.abbreviation;
          const groupNodeId = gi.nodeId;
          const groupSelected =
            selection?.kind === "group" && selection.groupId === gid;
          n.push({
            id: groupNodeId,
            type: "letterGroup",
            position: { x: groupsX, y: bottomY },
            data: {
              width: gi.width,
              height: gi.height,
              abbr,
              sequence: gi.group.sequence,
              name: gi.group.name,
              color: gi.storyline.color_hex,
              selected: groupSelected,
              selfRingColor: groupSelected ? selfRingColor ?? undefined : undefined,
              peerRingColors: peerGroups?.get(gid),
              pendingDelete: pendingDeletes.groups[gid] === true,
              pendingAdd: ghostGroupIdSet.has(gid),
              // Pin only the group's primary (home-day) instance — faux
              // instances render letters pulled away by overrides, so the
              // group-delivery pin doesn't belong on them.
              pinned: gi.dayKey == null && gi.group.delivery_day_id != null,
              onSelect: () => select({ kind: "group", groupId: gid }),
            },
            draggable: editingEnabled,
            // Limit the drag origin to the pill — the group's background
            // is otherwise unclickable empty space, so dragging from it
            // is more accidental than intentional.
            dragHandle: ".group-drag-handle",
            selectable: false,
            focusable: false,
            style: { width: gi.width, height: gi.height },
          });

          const onlyVariant = gi.variants.length === 1;
          let relX = GROUP_PAD_LEADING;
          gi.variants.forEach((vk, i) => {
            const letterNodeId = makeLetterNodeId(gid, vk, gi.dayKey);
            const contentId = letterDisplayId(
              abbr,
              gi.group.sequence,
              vk || null,
              onlyVariant
            );
            const cardH = gi.variantHeights[i];
            // Align variant cards by their TOP edge inside the group so
            // rows of variants read consistently even when summary lengths
            // produce different card heights.
            const relY = GROUP_PAD_TOP;
            const primary = primaryLetterByGroupVariant.get(`${gid}:${vk}`);
            const summary = primary?.summary ?? null;
            letterAbsPos.set(letterNodeId, {
              x: groupsX + relX,
              y: bottomY + relY,
              h: cardH,
            });
            const letterSelected =
              selection?.kind === "letter" &&
              selection.groupId === gid &&
              selection.variantKey === vk;
            n.push({
              id: letterNodeId,
              type: "letter",
              parentId: groupNodeId,
              // extent stays unconstrained so the letter can be dragged out
              // of its group and dropped onto a different one.
              position: { x: relX, y: relY },
              data: {
                contentId,
                storyline: gi.storyline,
                summary,
                widthPx: PILL_W,
                selected: letterSelected,
                selfRingColor: letterSelected
                  ? selfRingColor ?? undefined
                  : undefined,
                peerRingColors: peerLetters?.get(`${gid}:${vk}`),
                pendingDelete: (() => {
                  // A letter's primary instance is also marked pending
                  // when its parent group is being deleted (server
                  // cascades). Cover both so the whole group reads as
                  // greyed out during the delete.
                  const lid = primaryLetterByGroupVariant.get(`${gid}:${vk}`)
                    ?.id;
                  if (lid && pendingDeletes.letters[lid] === true) return true;
                  return pendingDeletes.groups[gid] === true;
                })(),
                pendingAdd: !!primary && ghostLetterIdSet.has(primary.id),
                pinned: primary?.delivery_day_override_id != null,
                offsetText:
                  primary?.delivery_day_offset != null
                    ? formatDeliveryOffset(primary.delivery_day_offset)
                    : null,
                onSelect: () =>
                  select({ kind: "letter", groupId: gid, variantKey: vk }),
              },
              draggable: editingEnabled,
              selectable: false,
              focusable: false,
            });
            relX += CARD_W + VARIANT_GAP;
          });

          groupsX += gi.width + CELL_GAP;
        }
      }
    }

    // -------------------------------------------------------------
    // Edges
    // -------------------------------------------------------------
    const e: Edge[] = [];

    // Index: letter id → instance info needed to build edge node ids.
    // dayKey is null when the letter is in its group's primary (home) day.
    const letterIndex = new Map<
      string,
      {
        groupId: string;
        variantKey: string;
        storylineId: string;
        groupSequence: number;
        dayKey: string | null;
      }
    >();
    {
      const groupHomeDayKey = new Map<string, string>(
        letterGroups.map((g) => [g.id, g.delivery_day_id ?? "unscheduled"])
      );
      for (const l of letters) {
        const home = groupHomeDayKey.get(l.letter_group_id) ?? "unscheduled";
        const effective = l.effective_day_id ?? "unscheduled";
        const dayKey = effective === home ? null : effective;
        letterIndex.set(l.id, {
          groupId: l.letter_group_id,
          variantKey: variantKey(l.variant),
          storylineId: l.storyline_id,
          groupSequence: l.group_sequence,
          dayKey,
        });
      }
    }

    // Index: (storyline_id, sequence) → group id
    const groupByStorySeq = new Map<string, string>();
    for (const g of letterGroups) {
      groupByStorySeq.set(`${g.storyline_id}:${g.sequence}`, g.id);
    }

    // Variant keys that exist in each group (across every instance) for
    // next-letter validation, plus a (groupId, variantKey) → letter map so
    // edges can route to the right instance node when the target letter
    // has been moved to a different day.
    const variantsInGroup = new Map<string, Set<string>>();
    const letterByGroupVariant = new Map<string, InspectionLetterView>();
    for (const l of letters) {
      const vk = variantKey(l.variant);
      const set =
        variantsInGroup.get(l.letter_group_id) ?? new Set<string>();
      set.add(vk);
      variantsInGroup.set(l.letter_group_id, set);
      letterByGroupVariant.set(`${l.letter_group_id}:${vk}`, l);
    }

    // Build the effective (post-template-override) display fields for
    // actions so template edits (color, icon) flow through live.
    const templateById = new Map(actionTemplates.map((t) => [t.id, t]));
    function resolveAction(a: ActionRow) {
      const tpl = a.action_template_id ? templateById.get(a.action_template_id) : undefined;
      return {
        color: tpl?.color_hex ?? a.color_hex ?? "",
        iconType: tpl?.icon_type ?? a.icon_type,
        iconValue: tpl?.icon_value ?? a.icon_value,
        name: tpl?.name ?? a.name,
      };
    }

    // Collect candidate edges (source, target, action). Stub-target nodes
    // for dangling actions are minted later, once chip positions are known,
    // so the line can terminate exactly at the chip.
    type Candidate = {
      id: string;
      source: string;
      target: string;
      action: ActionRow;
      terminator: "arrow" | "circle";
      /**
       * Edge subtype, used to decide which arrowhead is reconnectable:
       *   - "ls": letter → segment (intrinsic; not reconnectable)
       *   - "sn": segment → next-letter (reconnect to retarget the next letter)
       *   - "ln": letter → next-letter direct, no segment (reconnect to retarget)
       *   - "stub": dangling action with no real target (reconnect to attach)
       */
      kind: "ls" | "sn" | "ln" | "stub";
      /** Synthetic id used to mint the stub-target node for dangling edges. */
      stubNodeId?: string;
      /**
       * True when the trigger letter's effective day is the same as or
       * after the report's effective day — the report can't actually
       * include that letter's outcome (letters sort end-of-day, reports
       * run start-of-day). Renders the edge as a destructive dashed line.
       */
      invalid?: boolean;
    };
    const candidates: Candidate[] = [];

    // Set of action ids that set at least one ending variable. Used to paint
    // an indicator on the chip when the ending overlay is on.
    const endingActionIds = new Set<string>();
    for (const ea of endingAssignments) endingActionIds.add(ea.action_id);

    for (const a of actions) {
      const src = letterIndex.get(a.inspection_letter_id);
      if (!src) continue;
      const sourceId = makeLetterNodeId(src.groupId, src.variantKey, src.dayKey);

      // Optimistic overrides win over server state during in-flight
      // reconnects so the edge follows the drop without round-tripping.
      const effectiveReportId =
        a.id in optimisticReportByAction
          ? optimisticReportByAction[a.id]
          : a.report_segment_id;
      const segmentNodeId = effectiveReportId
        ? `report:${effectiveReportId}`
        : null;
      const segmentExists = segmentNodeId
        ? segmentAbsPos.has(segmentNodeId)
        : false;

      const effectiveNextVariant =
        a.id in optimisticNextByAction
          ? optimisticNextByAction[a.id]
          : a.next_letter_variant;
      let nextLetterId: string | null = null;
      if (effectiveNextVariant !== null && effectiveNextVariant !== undefined) {
        const nextGroupId = groupByStorySeq.get(
          `${src.storylineId}:${src.groupSequence + 1}`
        );
        if (nextGroupId) {
          const vset = variantsInGroup.get(nextGroupId);
          if (vset?.has(effectiveNextVariant)) {
            // Target letter may sit in a non-primary instance if it carries
            // its own override; look it up so the edge terminates at the
            // right card on the canvas.
            const targetLetter = letterByGroupVariant.get(
              `${nextGroupId}:${effectiveNextVariant}`
            );
            const targetGroupHome =
              letterGroups.find((g) => g.id === nextGroupId)?.delivery_day_id ??
              "unscheduled";
            const targetEffective =
              targetLetter?.effective_day_id ?? "unscheduled";
            const targetDayKey =
              targetEffective === targetGroupHome ? null : targetEffective;
            nextLetterId = makeLetterNodeId(
              nextGroupId,
              effectiveNextVariant,
              targetDayKey
            );
          }
        }
      }

      // Timing check for trigger → report edges: the trigger letter must
      // deliver BEFORE the report runs. Compare day numbers via the days[]
      // index (we already have a Map<dayId, Day>).
      const triggerInvalid = (() => {
        if (!segmentExists || !segmentNodeId) return false;
        const segId = segmentNodeId.slice("report:".length);
        const seg = segmentById.get(segId);
        if (!seg?.effective_day_id) return false;
        const letterId = a.inspection_letter_id;
        const letter = letters.find((l) => l.id === letterId);
        if (!letter?.effective_day_id) return false;
        const letterDay = dayById.get(letter.effective_day_id);
        const segDay = dayById.get(seg.effective_day_id);
        if (!letterDay || !segDay) return false;
        return letterDay.number >= segDay.number;
      })();

      if (segmentExists && nextLetterId) {
        candidates.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentNodeId!,
          action: a,
          terminator: "arrow",
          kind: "ls",
          invalid: triggerInvalid,
        });
        candidates.push({
          id: `a:${a.id}:sn`,
          source: segmentNodeId!,
          target: nextLetterId,
          action: a,
          terminator: "arrow",
          kind: "sn",
        });
      } else if (segmentExists) {
        candidates.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentNodeId!,
          action: a,
          terminator: "arrow",
          kind: "ls",
          invalid: triggerInvalid,
        });
      } else if (nextLetterId) {
        candidates.push({
          id: `a:${a.id}:ln`,
          source: sourceId,
          target: nextLetterId,
          action: a,
          terminator: "arrow",
          kind: "ln",
        });
      } else {
        const stubNodeId = `stub:${a.id}`;
        candidates.push({
          id: `a:${a.id}:stub`,
          source: sourceId,
          target: stubNodeId,
          action: a,
          terminator: "circle",
          kind: "stub",
          stubNodeId,
        });
      }
    }

    // -------------------------------------------------------------
    // Chip placement
    // -------------------------------------------------------------
    // chipY rule:
    //   chipY is the literal vertical midpoint between the source card's
    //   bottom edge and the target card's top edge, so each chip sits halfway
    //   between the two artifacts it connects regardless of row geometry.
    //   For dangling actions (no real target), the chip drops a fixed
    //   distance below the source.
    // chipX rule:
    //   preferred X is centered on the source's mid-X, with siblings spaced
    //   ±CHIP_PITCH apart. Chips at near-equal Y (within COLLISION_Y_QUANTUM
    //   px) are bucketed together; per-bucket they sort by preferred X and
    //   the walk pushes later chips right so the previous chip's footprint
    //   (chip + badge stack to its right) plus CHIP_GAP fits before the next.
    const COLLISION_Y_QUANTUM = 8; // px — coarse Y bucket key for collision
    const DANGLING_DROP = 60; // px — virtual target distance below dangling source
    // The day row that contains a given source node — letter sources
    // resolve to their group's delivery day; report sources resolve to
    // the segment's effective day.
    function nodeRowId(nodeId: string): string | null {
      const parsedLetter = parseLetterNodeId(nodeId);
      if (parsedLetter) {
        // Each letter instance lives on its own row; dayKey === null means
        // it sits on the group's home day.
        if (parsedLetter.dayKey) return parsedLetter.dayKey;
        const inst = groupInstancesById.get(
          makeGroupNodeId(parsedLetter.groupId, null)
        );
        return inst?.rowId ?? null;
      }
      if (nodeId.startsWith("report:")) {
        const segId = nodeId.slice("report:".length);
        return segmentById.get(segId)?.effective_day_id ?? "unscheduled";
      }
      return null;
    }
    // Anchor chips / edge endpoints to the horizontal center of the card's
    // top-edge handle (target enters from top, source exits from bottom; both
    // are pinned at left: 50% of the card width by xyflow defaults).
    function nodeCenterX(nodeId: string): number | null {
      if (nodeId.startsWith("letter:")) {
        const p = letterAbsPos.get(nodeId);
        return p ? p.x + CARD_W / 2 : null;
      }
      if (nodeId.startsWith("report:")) {
        const p = segmentAbsPos.get(nodeId);
        return p ? p.x + CARD_W / 2 : null;
      }
      return null;
    }
    function nodeBottomY(nodeId: string): number | null {
      if (nodeId.startsWith("letter:")) {
        const p = letterAbsPos.get(nodeId);
        return p ? p.y + p.h : null;
      }
      if (nodeId.startsWith("report:")) {
        const p = segmentAbsPos.get(nodeId);
        return p ? p.y + p.h : null;
      }
      return null;
    }
    function nodeTopY(nodeId: string): number | null {
      if (nodeId.startsWith("letter:")) {
        const p = letterAbsPos.get(nodeId);
        return p ? p.y : null;
      }
      if (nodeId.startsWith("report:")) {
        const p = segmentAbsPos.get(nodeId);
        return p ? p.y : null;
      }
      return null;
    }

    type ChipPlacement = {
      candidate: Candidate;
      chipY: number;
      preferredX: number;
      chipX: number;
      impacts: ActiveImpact[];
      // Left-half siblings render their impact-overlay badges to the
      // LEFT of the chip; right-half siblings to the RIGHT. With 4
      // chips, indices 0–1 are left-side, 2–3 are right-side.
      badgeSide: "left" | "right";
      extentLeft: number;
      extentRight: number;
    };
    const placements: ChipPlacement[] = [];

    const candidatesBySource = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const list = candidatesBySource.get(c.source) ?? [];
      list.push(c);
      candidatesBySource.set(c.source, list);
    }

    for (const [sourceId, list] of candidatesBySource) {
      const isLetterSource = sourceId.startsWith("letter:");
      const srcBottomY = nodeBottomY(sourceId);
      const srcCenterX = nodeCenterX(sourceId);
      if (srcBottomY == null || srcCenterX == null) continue;

      // All chips for letter sources in the same day row share a single Y
      // so they align horizontally at the row's bottom margin. Report
      // sources (hideChip=true) use a midpoint Y — that value doesn't
      // render a chip, but feeds the path via-point.
      const sourceRowId = nodeRowId(sourceId);
      const rowY = sourceRowId ? rowBaseY.get(sourceRowId) ?? 0 : 0;
      const rowH = sourceRowId ? rowHeights.get(sourceRowId) ?? 0 : 0;
      const uniformRowChipY = rowY + rowH - ROW_BOTTOM_PAD / 2;

      list.sort((a, b) => {
        const sa = a.action.sort_order ?? 0;
        const sb = b.action.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return a.id.localeCompare(b.id);
      });

      const N = list.length;
      list.forEach((c, i) => {
        const offset = (i - (N - 1) / 2) * CHIP_PITCH;
        const x = srcCenterX + offset;
        let chipY: number;
        if (isLetterSource) {
          chipY = uniformRowChipY;
        } else {
          const targetTopY =
            c.terminator === "circle"
              ? srcBottomY + DANGLING_DROP
              : (nodeTopY(c.target) ?? srcBottomY + DANGLING_DROP);
          chipY = (srcBottomY + targetTopY) / 2;
        }
        // Impact badges live only on chips leading OUT of a letter. The
        // follow-up chip from segment → next letter represents the same
        // action but should not duplicate its impact badges.
        const impacts = isLetterSource
          ? extractActiveImpacts(c.action, impactFilter, nations)
          : [];
        // Left-half siblings push their badge stack outward (left of the
        // chip); right-half siblings push outward to the right. With one
        // chip, default to right.
        const badgeSide: "left" | "right" =
          N >= 2 && i < Math.ceil(N / 2) ? "left" : "right";
        const stackWidth = badgeStackExtentRight(impacts);
        placements.push({
          candidate: c,
          chipY,
          preferredX: x,
          chipX: x,
          impacts,
          badgeSide,
          extentLeft: badgeSide === "left" ? stackWidth : 0,
          extentRight: badgeSide === "right" ? stackWidth : 0,
        });
      });
    }

    // Collision pass: chips with near-equal Y are bucketed via a coarse
    // Y-quantum and pushed apart along X. Chips at materially different Ys
    // don't collide and stay at their preferred X.
    const placementsByY = new Map<number, ChipPlacement[]>();
    for (const p of placements) {
      const key = Math.round(p.chipY / COLLISION_Y_QUANTUM);
      const list = placementsByY.get(key) ?? [];
      list.push(p);
      placementsByY.set(key, list);
    }
    for (const list of placementsByY.values()) {
      list.sort((a, b) => a.preferredX - b.preferredX);
      let prevRight = -Infinity;
      for (const p of list) {
        // Account for the next chip's LEFT badge extent: a left-side
        // chip needs room to the left of its chip center too.
        const minChipX = prevRight + CHIP_GAP + CHIP_H / 2 + p.extentLeft;
        p.chipX = Math.max(p.preferredX, minChipX);
        prevRight = p.chipX + CHIP_H / 2 + p.extentRight;
      }
    }

    // Mint stub-target nodes at the final chip coordinates so the line
    // terminates exactly at the chip for dangling actions.
    for (const p of placements) {
      if (p.candidate.terminator !== "circle") continue;
      const stubNodeId = p.candidate.stubNodeId;
      if (!stubNodeId) continue;
      n.push({
        id: stubNodeId,
        type: "stubTarget",
        position: { x: p.chipX, y: p.chipY },
        data: {},
        draggable: false,
        selectable: false,
        focusable: false,
      });
    }

    // Arrowhead spread is needed BEFORE the connection-source loop so the
    // "continue this chain" handle can sit on the chip's actual landing X
    // when multiple arrows share a target.
    const arrowsByTarget = new Map<string, ChipPlacement[]>();
    for (const p of placements) {
      if (p.candidate.terminator !== "arrow") continue;
      const list = arrowsByTarget.get(p.candidate.target) ?? [];
      list.push(p);
      arrowsByTarget.set(p.candidate.target, list);
    }
    for (const list of arrowsByTarget.values()) {
      list.sort((a, b) => a.chipX - b.chipX);
    }
    const ARROW_TARGET_PITCH = 20;
    const targetOffsetByEdgeId = new Map<string, number>();
    for (const list of arrowsByTarget.values()) {
      const N = list.length;
      list.forEach((p, i) => {
        const offset = N > 1 ? (i - (N - 1) / 2) * ARROW_TARGET_PITCH : 0;
        targetOffsetByEdgeId.set(p.candidate.id, offset);
      });
    }

    // In edit mode, mint a per-edge endpoint node at each arrow target
    // position. The edge then targets that endpoint instead of the
    // letter/report directly — which lets two arrows converging on the
    // same target sit at distinct X positions AND each remain
    // independently grabbable for drag-to-reconnect. (The letter/report
    // node's own target Handle is 8px wide, so only one of the converging
    // hit zones is reachable when the spread is purely visual.) The
    // letter/report's own Handle remains a drop target so reconnect drops
    // still land where the user expects.
    const endpointNodeIdByEdgeId = new Map<string, string>();
    if (editingEnabled) {
      for (const p of placements) {
        if (p.candidate.terminator !== "arrow") continue;
        const targetId = p.candidate.target;
        const tgtPos =
          letterAbsPos.get(targetId) ?? segmentAbsPos.get(targetId);
        if (!tgtPos) continue;
        const offset = targetOffsetByEdgeId.get(p.candidate.id) ?? 0;
        const baseX = tgtPos.x + CARD_W / 2 + offset;
        const baseY = tgtPos.y;
        const endpointId = `endpoint:${p.candidate.id}`;
        endpointNodeIdByEdgeId.set(p.candidate.id, endpointId);
        n.push({
          id: endpointId,
          type: "endpointTarget",
          position: { x: baseX, y: baseY },
          data: {},
          draggable: false,
          selectable: false,
          focusable: false,
          // Above letter/report nodes so the hit zone wins pointer events
          // when it overlaps the card's top edge.
          zIndex: 12,
        });
      }
    }

    // For every letter with multiple outgoing edges (one per action that
    // starts there), spread the source X to match each action's chip X.
    // Without this, both lines emerge from the letter's bottom-center
    // and diverge into a "V" — the user wants each line to drop
    // straight from under its chip.
    const letterSourceBySource = new Map<string, ChipPlacement[]>();
    for (const p of placements) {
      if (!p.candidate.source.startsWith("letter:")) continue;
      const list = letterSourceBySource.get(p.candidate.source) ?? [];
      list.push(p);
      letterSourceBySource.set(p.candidate.source, list);
    }
    const sourceXOffsetByEdgeId = new Map<string, number>();
    for (const [sourceId, list] of letterSourceBySource) {
      if (list.length < 2) continue;
      const letterPos = letterAbsPos.get(sourceId);
      if (!letterPos) continue;
      const letterCenterX = letterPos.x + CARD_W / 2;
      for (const p of list) {
        // Source offset = chip X relative to the letter's center, so
        // the bezier exits the letter directly under the chip.
        sourceXOffsetByEdgeId.set(p.candidate.id, p.chipX - letterCenterX);
      }
    }

    // Mirror the arrowhead spread on the EXIT side: for every report
    // segment with multiple outgoing `sn` lines (one per triggering
    // action), each line should depart from a distinct X on the report's
    // bottom edge. Ordering follows the line's NEXT-LETTER X so
    // outgoing lines don't cross when sources and targets disagree on
    // order — trace from the bottom of the report to the next letter
    // is always non-crossing.
    const snBySource = new Map<string, ChipPlacement[]>();
    for (const p of placements) {
      if (p.candidate.kind !== "sn") continue;
      const list = snBySource.get(p.candidate.source) ?? [];
      list.push(p);
      snBySource.set(p.candidate.source, list);
    }
    for (const list of snBySource.values()) {
      if (list.length === 1) {
        // Single departure: align under the matching ls arrival on the
        // top edge of the report so the chain reads as a continuous
        // letter→report→next-letter. (Reports can have multiple ls
        // arrows in from different actions even when only one of those
        // actions has a next letter; centering the lone sn at the
        // report's mid-x would visually disconnect it from its source
        // chip.)
        const p = list[0];
        const lsCandidate = placements.find(
          (q) =>
            q.candidate.kind === "ls" &&
            q.candidate.action.id === p.candidate.action.id
        );
        const lsOffset = lsCandidate
          ? targetOffsetByEdgeId.get(lsCandidate.candidate.id) ?? 0
          : 0;
        sourceXOffsetByEdgeId.set(p.candidate.id, lsOffset);
        continue;
      }
      // Multiple departures: sort by target X (where the line lands at
      // the next letter) so departures on the report's bottom mirror
      // that left-to-right order and the bezier paths don't cross.
      list.sort((a, b) => {
        const ta = letterAbsPos.get(a.candidate.target);
        const tb = letterAbsPos.get(b.candidate.target);
        const ax = ta ? ta.x : 0;
        const bx = tb ? tb.x : 0;
        return ax - bx;
      });
      const N = list.length;
      list.forEach((p, i) => {
        const offset = (i - (N - 1) / 2) * ARROW_TARGET_PITCH;
        sourceXOffsetByEdgeId.set(p.candidate.id, offset);
      });
    }

    // Mint connection-source nodes (Phase 4 followup): tiny draggable
    // circles that the user can drag to create or retarget links. Only
    // emitted when editing is unlocked, and only on chips whose source is
    // a letter (one chip per action — sn continuation chips skip this).
    //
    // Placement rules:
    //   - Action has NEITHER report NOR next-letter → one circle below
    //     the chip in the action's color. Dropping on a letter sets the
    //     next-letter; dropping on a report sets the report. (The chip
    //     itself recolors as appropriate when the connection lands.)
    //   - Action has a report but no next-letter → the "next" circle
    //     sits BELOW the report segment, where the next-letter line
    //     would land if it existed. Rendered grey since next-letter
    //     edges are grey.
    //   - Action has a next-letter but no report → the "report" circle
    //     sits below the chip in the action's color.
    if (editingEnabled) {
      const CONNECT_BELOW_GAP = 14; // chip half-height (10) + gap below
      for (const p of placements) {
        if (!p.candidate.source.startsWith("letter:")) continue;
        const a = p.candidate.action;
        const resolved = resolveAction(a);
        // Use the optimistic-overlaid values so connector positioning
        // matches the visible edge state during in-flight reconnects.
        const effectiveReportIdForA =
          a.id in optimisticReportByAction
            ? optimisticReportByAction[a.id]
            : a.report_segment_id;
        const effectiveNextForA =
          a.id in optimisticNextByAction
            ? optimisticNextByAction[a.id]
            : a.next_letter_variant;
        const hasReport = !!effectiveReportIdForA;
        const hasNext = !!effectiveNextForA;
        if (!hasReport && !hasNext) {
          // Single combined connector: drag-anywhere. The kind is "any"
          // and the drop handler resolves to report or next based on the
          // target node type.
          n.push({
            id: `connect:${a.id}:any`,
            type: "connectionSource",
            position: {
              x: p.chipX - 6,
              y: p.chipY + CONNECT_BELOW_GAP - 6,
            },
            data: { kind: "any", color: resolved.color || "#ffffff" },
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: 11,
          });
          continue;
        }
        if (!hasReport) {
          // Action has a next-letter but no report — drag from below the
          // chip to attach a report segment.
          n.push({
            id: `connect:${a.id}:report`,
            type: "connectionSource",
            position: {
              x: p.chipX - 6,
              y: p.chipY + CONNECT_BELOW_GAP - 6,
            },
            data: { kind: "report", color: resolved.color || "#ffffff" },
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: 11,
          });
        }
        if (!hasNext) {
          // Action has a report but no next-letter — surface the "next"
          // pickup point directly below the report segment, where the
          // next-letter line would meet the next group. Rendered grey
          // (next-letter edges are grey). Aligned horizontally with the
          // SAME action's arrival point on top so you can trace the
          // chain through the report card.
          let nextX = p.chipX - 6;
          let nextY = p.chipY + CONNECT_BELOW_GAP - 6;
          if (hasReport && p.candidate.kind === "ls") {
            const reportPos = segmentAbsPos.get(
              `report:${effectiveReportIdForA}`
            );
            if (reportPos) {
              const lsOffset =
                targetOffsetByEdgeId.get(`a:${a.id}:ls`) ?? 0;
              nextX = reportPos.x + CARD_W / 2 + lsOffset - 6;
              nextY = reportPos.y + reportPos.h + 6 - 6;
            }
          }
          n.push({
            id: `connect:${a.id}:next`,
            type: "connectionSource",
            position: { x: nextX, y: nextY },
            data: { kind: "next", color: "#9ca3af" },
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: 11,
          });
        }
      }
    }

    // Arrow color rule:
    //   - multiple arrows converging on one target → white, so the stacked
    //     arrowheads read as a single unified arrow
    //   - single arrow → the action's own color
    // (Arrowhead spacing / targetOffsetByEdgeId computed earlier so the
    // connection-source minting loop can use it.)

    for (const p of placements) {
      const c = p.candidate;
      const resolved = resolveAction(c.action);
      // Edges that lead INTO a letter (segment→next-letter or
      // letter→next-letter direct) render in muted grey on the
      // chip→letter segment. The letter→chip leg of an `ln` edge stays
      // in the action's color (only the post-chip segment is muted).
      const isReportSource = c.source.startsWith("report:");
      const isLetterTargetForChip = c.target.startsWith("letter:");
      const isSegmentToNextLetter = isReportSource && isLetterTargetForChip;
      const isLetterToNextLetter = c.kind === "ln";
      const baseColor = resolved.color || "#ffffff";
      const color = isSegmentToNextLetter ? "#5e5e5e" : baseColor;
      const path2Color = isLetterToNextLetter ? "#5e5e5e" : undefined;
      // Arrowhead always matches the line that draws into it — no
      // override for converging targets or muted segment-source lines.
      const arrowColor = color;
      // Ending marker only on chips leading OUT of a letter (same rule as
      // impact badges) so the segment → next-letter follow-up doesn't
      // duplicate the indicator.
      const isLetterSource = c.source.startsWith("letter:");
      const isLetterTarget = c.target.startsWith("letter:");
      const hasEnding =
        impactFilter.masterEnabled !== false &&
        impactFilter.showEndings &&
        isLetterSource &&
        endingActionIds.has(c.action.id);
      // Each chip click selects the action (panel opens to the source
      // letter's actions view, scrolled to this action). Resolve the source
      // letter's group + variant so the selection carries that breadcrumb.
      const srcLetter = letterIndex.get(c.action.inspection_letter_id);
      const chipSelected =
        selection?.kind === "actions" &&
        selection.actionId === c.action.id;
      const onChipSelect = srcLetter
        ? () =>
            select({
              kind: "actions",
              groupId: srcLetter.groupId,
              variantKey: srcLetter.variantKey,
              actionId: c.action.id,
            })
        : undefined;
      const onChipContextMenu = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (!srcLetter) return;
        const aId = c.action.id;
        const groupId = srcLetter.groupId;
        setContextMenu({
          anchor: { x: event.clientX, y: event.clientY },
          items: [
            {
              label: "Delete Action",
              icon: <Trash2 size={12} aria-hidden />,
              intent: "destructive",
              onClick: () =>
                void (async () => {
                  const ok = await confirm({
                    title: "Delete action?",
                    message:
                      "The action will be removed from this letter. This cannot be undone.",
                    confirmLabel: "Delete",
                    intent: "destructive",
                  });
                  if (!ok) return;
                  markPendingDelete("actions", aId);
                  await deleteActionRow(groupId, aId);
                  if (
                    selection?.kind === "actions" &&
                    selection.actionId === aId
                  ) {
                    select(null);
                  }
                })(),
            },
          ],
        });
      };
      // Every reconnectable edge in edit mode lets the user drag the
      // target endpoint to retarget the underlying link, or drop on
      // empty space to clear it. When the graph is locked (read-only),
      // no edge accepts reconnect drags.
      //   - "ls" (letter → report)    → retargets `report_segment_id`
      //   - "sn" (report → next letter) → retargets `next_letter_variant`
      //   - "ln" (letter → next letter direct) → retargets `next_letter_variant`
      //   - "stub" (dangling)         → attaches the first missing link
      const reconnectable: boolean | "target" = editingEnabled
        ? "target"
        : false;
      // In edit mode, route the edge through a dedicated per-edge
      // endpoint node so each converging terminator has its own grab
      // handle. The endpoint sits at the spread X already, so the edge
      // data's targetXOffset is zeroed in that mode.
      const endpointId = endpointNodeIdByEdgeId.get(c.id);
      const edgeTarget = endpointId ?? c.target;
      const targetXOffset =
        endpointId !== undefined ? 0 : targetOffsetByEdgeId.get(c.id) ?? 0;
      e.push({
        id: c.id,
        source: c.source,
        target: edgeTarget,
        type: "actionIcon",
        reconnectable,
        data: {
          color,
          path2Color,
          // When the line is muted grey (segment→next-letter) we still
          // want the action chip itself to read in the action's own
          // color. ln edges already paint chip with `color` (= baseColor).
          chipColor: isSegmentToNextLetter ? baseColor : undefined,
          iconType: resolved.iconType,
          iconValue: resolved.iconValue,
          actionName: resolved.name,
          chipX: p.chipX,
          chipY: p.chipY,
          terminator: c.terminator,
          impacts: p.impacts,
          badgeSide: p.badgeSide,
          targetXOffset,
          sourceXOffset: sourceXOffsetByEdgeId.get(c.id) ?? 0,
          hasEnding,
          selected: chipSelected,
          selfRingColor: chipSelected ? selfRingColor ?? undefined : undefined,
          peerRingColors: peerActions?.get(c.action.id),
          pendingDelete: pendingDeletes.actions[c.action.id] === true,
          // Pulse the chip + line while a reconnect overlay is in
          // flight for this action — the layout already snaps to the
          // optimistic target, so this is the only "something is
          // happening" signal until revalidation lands.
          optimisticPending:
            c.action.id in optimisticNextByAction ||
            c.action.id in optimisticReportByAction,
          onSelect: onChipSelect,
          onContextMenu: onChipContextMenu,
          // The chip only appears on letter → report segment connections
          // (and on the letter → stub dangling terminator). Report →
          // next-letter continuations AND letter → next-letter direct
          // connections (no report) render as a colored line only — UNLESS
          // we're in edit mode and the action is missing a report or
          // next-letter, in which case we surface the chip so the
          // connection-source circles have something to anchor to.
          hideChip:
            (!isLetterSource || isLetterTarget) &&
            !(
              editingEnabled &&
              isLetterSource &&
              (() => {
                const effReport =
                  c.action.id in optimisticReportByAction
                    ? optimisticReportByAction[c.action.id]
                    : c.action.report_segment_id;
                const effNext =
                  c.action.id in optimisticNextByAction
                    ? optimisticNextByAction[c.action.id]
                    : c.action.next_letter_variant;
                return !effReport || !effNext;
              })()
            ),
          invalid: !!c.invalid,
          editingEnabled,
          reconnectable: !!reconnectable,
        },
        markerEnd:
          c.terminator === "arrow" && !editingEnabled
            ? {
                type: MarkerType.ArrowClosed,
                color: c.invalid ? "#ef4444" : arrowColor,
              }
            : undefined,
      });
    }

    const labelRows = rowIds.map((rowId) => {
      const day = rowId === "unscheduled" ? null : dayById.get(rowId);
      return {
        rowId,
        baseY: rowBaseY.get(rowId) ?? 0,
        height: rowHeights.get(rowId) ?? 0,
        identifier: day?.identifier ?? null,
        label: day?.name ?? null,
        isUnscheduled: rowId === "unscheduled",
        pendingAdd: ghostDayIdSet.has(rowId),
      };
    });
    const labelCols = orderedStorylines.map((s) => ({
      id: s.id,
      baseX: colBaseX.get(s.id) ?? 0,
      width: colWidths.get(s.id) ?? 0,
      storyline: s,
    }));

    // Center coordinates (graph coords) for each selectable entity, used
    // to auto-pan the canvas when the selection changes.
    function selectionCenter(sel: GraphSelection | null): {
      x: number;
      y: number;
    } | null {
      if (!sel) return null;
      if (sel.kind === "group") {
        // Center on the group's primary instance (its home day), even if a
        // shadow instance exists on an override day.
        const gi = groupInstancesById.get(makeGroupNodeId(sel.groupId, null));
        if (!gi) return null;
        const firstVariant = gi.variants[0] ?? "";
        const lp = letterAbsPos.get(
          makeLetterNodeId(sel.groupId, firstVariant, null)
        );
        if (!lp) return null;
        const groupX = lp.x - GROUP_PAD_LEADING;
        const groupY = lp.y - (gi.height - lp.h) / 2;
        return { x: groupX + gi.width / 2, y: groupY + gi.height / 2 };
      }
      if (sel.kind === "letter" || sel.kind === "actions") {
        // The selected variant may live in either the primary instance or an
        // override-day instance; check both.
        const primaryPos = letterAbsPos.get(
          makeLetterNodeId(sel.groupId, sel.variantKey, null)
        );
        let p = primaryPos;
        if (!p) {
          for (const inst of instancesByGroup.get(sel.groupId) ?? []) {
            if (inst.dayKey == null) continue;
            const lp = letterAbsPos.get(
              makeLetterNodeId(sel.groupId, sel.variantKey, inst.dayKey)
            );
            if (lp) {
              p = lp;
              break;
            }
          }
        }
        if (!p) return null;
        return { x: p.x + CARD_W / 2, y: p.y + p.h / 2 };
      }
      if (sel.kind === "segment") {
        const p = segmentAbsPos.get(`report:${sel.segmentId}`);
        if (!p) return null;
        return { x: p.x + CARD_W / 2, y: p.y + p.h / 2 };
      }
      return null;
    }

    // Compact metadata maps used by drag-drop handlers so they can
    // translate a dropped node's position back to row / group ids.
    const rowMeta = rowIds.map((rowId) => ({
      rowId,
      baseY: rowBaseY.get(rowId) ?? 0,
      height: rowHeights.get(rowId) ?? 0,
    }));
    // groupMeta lists one entry per group (using the group's home rowId),
    // not per instance — drag handlers only care about the underlying group.
    const groupMeta = letterGroups.map((g) => ({
      gid: g.id,
      rowId: g.delivery_day_id ?? "unscheduled",
      storylineId: g.storyline_id,
    }));

    return {
      nodes: n,
      edges: e,
      labelRows,
      labelCols,
      selectionCenter,
      rowMeta,
      groupMeta,
    };
  }, [
    storylines,
    letterGroups,
    letters,
    actions,
    actionTemplates,
    days,
    segments,
    nations,
    endingAssignments,
    impactFilter,
    selection,
    select,
    optimisticNextByAction,
    optimisticReportByAction,
    editingEnabled,
    selfRingColor,
    peerGroups,
    peerLetters,
    peerSegments,
    peerActions,
    pendingDeletes,
    pendingAdds,
  ]);

  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const rfRef = useRef<ReactFlowInstance | null>(null);
  // Per-user preference: auto-pan/zoom the canvas onto the selected
  // entity when the selection changes. Toggled from the zoom-to-
  // selection button (double-click or click-and-hold). Default on.
  const [autozoomEnabled, setAutozoomEnabled] = useLocalStorage(
    "graph:autozoom",
    true
  );

  // Phase 6 — drag-pointer feedback:
  //   hoveredRowId  → tints the day-row band currently under the pointer.
  //   hoveredGroupId → rings the letter-group a letter is being dragged onto.
  //   isDragging     → forces grabbing cursor on the whole canvas.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Live drag preview: the node being dragged + the vertical delta from
  // its layout position. decoratedNodes reads this to ghost the dragged
  // node and shadow-shift items that move relative to it (e.g. a letter
  // group's relative-dated reports follow the group as it's dragged).
  const [dragPreview, setDragPreview] = useState<{
    nodeId: string;
    dy: number;
  } | null>(null);
  const dragOriginRef = useRef<{ nodeId: string; y: number } | null>(null);
  // Escape pressed mid-drag flips this; onNodeDragStop reads it and skips
  // the server-side move so the layout snaps back to the original
  // positions on the next render. Cleared on drag start.
  const dragCanceledRef = useRef(false);
  useEffect(() => {
    if (!isDragging) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dragCanceledRef.current = true;
        // Force ReactFlow's pointer-drag to release so onNodeDragStop
        // fires and our cancel branch runs.
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true })
        );
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDragging]);
  const [contextMenu, setContextMenu] = useState<{
    anchor: { x: number; y: number };
    items: GraphContextMenuItem[];
  } | null>(null);
  /**
   * After a server-side create completes, we want to select the newly
   * created entity and re-center the canvas on it — but the node won't be
   * in the layout until the data refresh propagates. This ref stashes the
   * "to-be-focused" id; a useEffect below watches the data and, when the
   * id materializes, calls onSelectionChange (which triggers the existing
   * auto-pan).
   */
  const pendingFocusRef = useRef<GraphSelection | null>(null);
  const queueFocus = useCallback((sel: GraphSelection) => {
    pendingFocusRef.current = sel;
  }, []);

  // Add the next day, with an optimistic muted ghost row. The ghost's
  // identifier (`D{n}`) is synthetic — the real one is DB-generated — so
  // the ghost is dropped the moment the real day lands in server data.
  const createNextDayWithGhost = useCallback(() => {
    const number = days.reduce((m, d) => Math.max(m, d.number), 0) + 1;
    const tempId = makeGhostId("day");
    const ghost: Day = {
      id: tempId,
      number,
      identifier: `D${number}`,
      name: null,
      notes: null,
      until_qup: null,
      month: null,
      day_of_month: null,
      year: null,
      day_of_week: null,
      sort_phase_length_seconds: null,
      inspection_phase_length_seconds: null,
      base_report: null,
      report_sign_off: null,
      end_of_day_sign_off: null,
    };
    setPendingAdds((prev) => ({
      ...prev,
      days: [...prev.days, { tempId, ghost, resolvedRealId: null }],
    }));
    void (async () => {
      try {
        const { newDayId } = await createNextDay();
        resolvePendingDay(tempId, newDayId);
      } catch (err) {
        removePendingDay(tempId);
        throw err;
      }
    })();
  }, [days, makeGhostId, resolvePendingDay, removePendingDay]);

  // Create N report segments under a letter group, with optimistic
  // ghosts. Reports created on the graph carry NO delivery override —
  // their day is computed from the letter group (group day + 1) until
  // a triggering letter is wired up. Shared by the pane right-click
  // menu and the report-cluster right-click menu.
  const createReportsForGroup = useCallback(
    (group: LetterGroup, n: number) => {
      const sameGroupSegs = segments.filter(
        (s) => s.letter_group_id === group.id
      );
      const existingMax = Math.max(
        0,
        ...sameGroupSegs.map((s) => romanToInt(s.variant))
      );
      const storyline = storylines.find((s) => s.id === group.storyline_id);
      // A fresh report with no triggers delivers on (group day + 1).
      const groupDay = days.find((d) => d.id === group.delivery_day_id);
      const reportDay =
        groupDay != null
          ? days.find((d) => d.number === groupDay.number + 1) ?? null
          : null;
      const ghostTempIds: string[] = [];
      const ghosts: PendingAdd<ReportSegmentView>[] = [];
      for (let i = 1; i <= n; i++) {
        const tempId = makeGhostId("seg");
        ghostTempIds.push(tempId);
        ghosts.push({
          tempId,
          ghost: {
            id: tempId,
            report_group_id: "",
            variant: toRoman(existingMax + i),
            summary: null,
            content: null,
            delivery_day_override_id: null,
            delivery_day_offset: null,
            sort_order: existingMax + i,
            updated_at: new Date(0).toISOString(),
            updated_by: null,
            letter_group_id: group.id,
            storyline_id: group.storyline_id,
            storyline_abbreviation: storyline?.abbreviation ?? "",
            group_sequence: group.sequence,
            report_id: "R-?",
            effective_day_id: reportDay?.id ?? null,
          },
          resolvedRealId: null,
        });
      }
      setPendingAdds((prev) => ({
        ...prev,
        segments: [...prev.segments, ...ghosts],
      }));
      void (async () => {
        try {
          // null day → no delivery override; the report computes its
          // day relative to the letter group.
          const { segmentIds } = await createReportSegmentsForGroupAtDay(
            group.id,
            n,
            null
          );
          ghostTempIds.forEach((tempId, idx) => {
            const realId = segmentIds[idx];
            if (realId) resolvePendingSegment(tempId, realId);
            else removePendingSegment(tempId);
          });
          if (segmentIds[0]) {
            queueFocus({ kind: "segment", segmentId: segmentIds[0] });
          }
        } catch (err) {
          ghostTempIds.forEach(removePendingSegment);
          throw err;
        }
      })();
    },
    [
      segments,
      storylines,
      days,
      makeGhostId,
      resolvePendingSegment,
      removePendingSegment,
      queueFocus,
    ]
  );

  // Custom overlay confirm() used by every destructive context-menu item.
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Helpers used by drag-drop handlers. They close over the current
  // memoized layout — recomputed on every render, which is fine because
  // drag handlers are also recreated per render.
  function rowAtFlowY(y: number): string | null {
    for (const r of rowMeta) {
      if (y >= r.baseY && y < r.baseY + r.height) return r.rowId;
    }
    return null;
  }
  function storylineAtFlowX(x: number): string | null {
    let best: { id: string; baseX: number; width: number } | null = null;
    for (const c of labelCols) {
      if (x >= c.baseX && x < c.baseX + c.width) return c.id;
      // Track nearest column as a fallback in case the click is in a gap.
      if (
        !best ||
        Math.abs(x - (c.baseX + c.width / 2)) <
          Math.abs(x - (best.baseX + best.width / 2))
      ) {
        best = { id: c.id, baseX: c.baseX, width: c.width };
      }
    }
    return best?.id ?? null;
  }

  function openPaneMenu(e: MouseEvent) {
    const rf = rfRef.current;
    if (!rf) return;
    const flowPt = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const rowId = rowAtFlowY(flowPt.y);
    const storylineId = storylineAtFlowX(flowPt.x);
    if (!rowId || !storylineId) return;
    const targetDayId = rowId === "unscheduled" ? null : rowId;
    const anchor = { x: e.clientX, y: e.clientY };
    // The unscheduled row is a holding bucket, not a real day —
    // creating letter groups / report segments there isn't allowed.
    // The only thing you can do is add a new day.
    if (rowId === "unscheduled") {
      setContextMenu({
        anchor,
        items: [
          {
            label: "Add Day",
            icon: <CalendarPlus size={12} aria-hidden />,
            onClick: () => createNextDayWithGhost(),
          },
        ],
      });
      return;
    }
    // Resolve the candidate letter group(s) to anchor new segments to:
    // always the group(s) in the closest preceding day of this
    // storyline. The current selection is intentionally NOT consulted —
    // report-create is purely positional. When that preceding day holds
    // more than one group, the report rows fan out to a submenu.
    const clickedDayNumber =
      rowId === "unscheduled"
        ? null
        : days.find((d) => d.id === rowId)?.number ?? null;
    const storylineGroups = letterGroups
      .filter((g) => g.storyline_id === storylineId)
      .sort((a, b) => a.sequence - b.sequence);
    const dayNumberById = new Map(days.map((d) => [d.id, d.number]));

    let candidates: LetterGroup[];
    if (clickedDayNumber == null) {
      candidates = storylineGroups;
    } else {
      // Closest preceding day that has any group.
      const withDay = storylineGroups
        .map((g) => ({
          g,
          n: g.delivery_day_id
            ? dayNumberById.get(g.delivery_day_id) ?? null
            : null,
        }))
        .filter((x) => x.n != null && (x.n as number) < clickedDayNumber);
      if (withDay.length === 0) {
        candidates = storylineGroups; // fallback when no group precedes
      } else {
        const maxN = Math.max(...withDay.map((x) => x.n as number));
        candidates = withDay
          .filter((x) => x.n === maxN)
          .sort((a, b) => a.g.sequence - b.g.sequence)
          .map((x) => x.g);
      }
    }

    const reportIcon = (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden>+</span>
        <Megaphone size={11} aria-hidden />
      </span>
    );
    const groupIcon = (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden>+</span>
        <Mails size={11} aria-hidden />
      </span>
    );
    const createLetterGroupHere = () => {
      // Optimistic ghost: shaped like a real LetterGroup so the layout
      // drops it into the (storyline, day) cell immediately. Sequence
      // picks the next available so the ghost sorts at the tail (where
      // the real one will land server-side).
      const sameStorylineGroups = letterGroups.filter(
        (g) => g.storyline_id === storylineId
      );
      const nextSeq =
        sameStorylineGroups.length === 0
          ? 1
          : Math.max(...sameStorylineGroups.map((g) => g.sequence)) + 1;
      const tempId = makeGhostId("group");
      const ghost: LetterGroup = {
        id: tempId,
        storyline_id: storylineId,
        name: "New Group",
        notes: null,
        sequence: nextSeq,
        delivery_day_id: targetDayId,
      };
      setPendingAdds((prev) => ({
        ...prev,
        groups: [
          ...prev.groups,
          { tempId, ghost, resolvedRealId: null },
        ],
      }));
      void (async () => {
        try {
          const { group } = await createLetterGroupInStoryline(
            storylineId,
            targetDayId
          );
          // Pre-seed the new group with one letter so it has content on the
          // graph; the user can add more via the inspector.
          await createInspectionLettersInGroup(group.id, 1);
          resolvePendingGroup(tempId, group.id);
          queueFocus({ kind: "group", groupId: group.id });
        } catch (err) {
          removePendingGroup(tempId);
          throw err;
        }
      })();
    };
    const makeCreator = (n: number, group: LetterGroup) => () =>
      createReportsForGroup(group, n);

    // Group display id, e.g. "W2" (storyline abbreviation + sequence).
    const storylineAbbr =
      storylines.find((s) => s.id === storylineId)?.abbreviation ?? "";
    const groupLabel = (g: LetterGroup) =>
      `${storylineAbbr}${g.sequence}`;
    // Plain letter-group icon for submenu rows (no leading "+").
    const groupRowIcon = <Mails size={12} aria-hidden />;

    // One report-segment menu row. With a single candidate group it's a
    // direct click; with several, it fans out to a submenu where each
    // row reads "<W2>: <Group name>" (name truncates if long).
    const reportItem = (n: number, label: string): GraphContextMenuItem => {
      if (candidates.length === 0) {
        return { label, icon: reportIcon, disabled: true, onClick: () => {} };
      }
      if (candidates.length === 1) {
        return { label, icon: reportIcon, onClick: makeCreator(n, candidates[0]) };
      }
      return {
        label: `${label} in`,
        icon: reportIcon,
        trailing: <ChevronRight size={12} aria-hidden />,
        submenu: candidates.map((g) => ({
          label: g.name ? `${groupLabel(g)} - ${g.name}` : groupLabel(g),
          icon: groupRowIcon,
          onClick: makeCreator(n, g),
        })),
      };
    };

    setContextMenu({
      anchor,
      items: [
        {
          label: "Letter Group",
          icon: groupIcon,
          onClick: createLetterGroupHere,
        },
        { divider: true },
        reportItem(1, "Report Segment"),
        reportItem(2, "2 Report Segments"),
        reportItem(3, "3 Report Segments"),
      ],
    });
  }

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setIsDragging(true);
      setHoveredRowId(null);
      setHoveredGroupId(null);
      dragCanceledRef.current = false;
      dragOriginRef.current = { nodeId: node.id, y: node.position.y };
      setDragPreview({ nodeId: node.id, dy: 0 });
    },
    []
  );

  // Update hovered row + (for letter drags) hovered target group on every
  // pointer move during drag. Both lookups are cheap closures over rowMeta
  // / groupMeta and reuse xyflow's intersection probe; React only
  // re-renders when the resolved id actually changes (state setter dedupe).
  const onNodeDrag = useCallback(
    (event: React.MouseEvent | MouseEvent, node: Node) => {
      const rf = rfRef.current;
      if (!rf) return;
      const flowPt = rf.screenToFlowPosition({
        x: (event as MouseEvent).clientX,
        y: (event as MouseEvent).clientY,
      });
      setHoveredRowId(rowAtFlowY(flowPt.y));
      // Track the drag delta so decoratedNodes can shadow-shift the
      // items that move relative to the dragged node.
      const origin = dragOriginRef.current;
      if (origin && origin.nodeId === node.id) {
        const dy = node.position.y - origin.y;
        setDragPreview((prev) =>
          prev && prev.nodeId === node.id && prev.dy === dy
            ? prev
            : { nodeId: node.id, dy }
        );
      }
      if (node.id.startsWith("letter:")) {
        const parsed = parseLetterNodeId(node.id);
        if (parsed) {
          const sourceGid = parsed.groupId;
          const sourceStoryline = groupMeta.find(
            (g) => g.gid === sourceGid
          )?.storylineId;
          const intersecting = rf
            .getIntersectingNodes(node)
            .filter((nn) => {
              if (nn.type !== "letterGroup") return false;
              const pg = parseGroupNodeId(nn.id);
              return pg?.groupId !== sourceGid;
            });
          if (intersecting.length > 0) {
            const targetGid =
              parseGroupNodeId(intersecting[0].id)?.groupId ?? "";
            const targetStoryline = groupMeta.find(
              (g) => g.gid === targetGid
            )?.storylineId;
            if (sourceStoryline && sourceStoryline === targetStoryline) {
              setHoveredGroupId(targetGid);
              return;
            }
          }
        }
      }
      setHoveredGroupId(null);
    },
    [groupMeta]
  );

  const onNodeDragStop = useCallback(
    (
      event: React.MouseEvent | MouseEvent,
      node: Node,
      draggedNodes: Node[]
    ) => {
      setIsDragging(false);
      setHoveredRowId(null);
      setHoveredGroupId(null);
      setDragPreview(null);
      dragOriginRef.current = null;
      const rf = rfRef.current;
      if (!rf) return;
      // Escape-cancel: skip the server-side move and snap nodes back to
      // their pre-drag positions via the memoized layout.
      if (dragCanceledRef.current) {
        dragCanceledRef.current = false;
        rf.setNodes(nodes);
        return;
      }
      // Batch move: when the user drags more than one selected node,
      // dispatch a single batchMoveToDay covering each entity's new day.
      if (draggedNodes.length > 1) {
        const flowPt = rf.screenToFlowPosition({
          x: (event as MouseEvent).clientX,
          y: (event as MouseEvent).clientY,
        });
        const targetRowId = rowAtFlowY(flowPt.y);
        if (!targetRowId) return;
        const moves: Parameters<typeof batchMoveToDay>[0] = [];
        const undoEntries: UndoEntry[] = [];
        const seenGroups = new Set<string>();
        const recordGroupMove = (gid: string) => {
          if (seenGroups.has(gid)) return;
          seenGroups.add(gid);
          const meta = groupMeta.find((g) => g.gid === gid);
          const previousDayId =
            !meta || meta.rowId === "unscheduled" ? null : meta.rowId;
          moves.push({
            kind: "group",
            id: gid,
            targetDayId: targetRowId === "unscheduled" ? null : targetRowId,
          });
          undoEntries.push({
            kind: "moveLetterGroup",
            groupId: gid,
            previousDayId,
          });
        };
        for (const dn of draggedNodes) {
          if (dn.id.startsWith("group:")) {
            const pg = parseGroupNodeId(dn.id);
            if (pg) recordGroupMove(pg.groupId);
          } else if (dn.id.startsWith("report:")) {
            const sid = dn.id.slice("report:".length);
            const seg = segments.find((s) => s.id === sid);
            moves.push({
              kind: "report",
              id: sid,
              targetDayId: targetRowId === "unscheduled" ? null : targetRowId,
            });
            undoEntries.push({
              kind: "moveReport",
              segmentId: sid,
              previousOverrideId: seg?.delivery_day_override_id ?? null,
              previousOffset: seg?.delivery_day_offset ?? null,
            });
          } else if (dn.id.startsWith("letter:")) {
            // Letters follow their group; collapse to the group move.
            const parsed = parseLetterNodeId(dn.id);
            if (!parsed) continue;
            recordGroupMove(parsed.groupId);
          }
        }
        if (moves.length > 0) {
          if (undoEntries.length > 0) {
            recordUndo?.({ kind: "batch", entries: undoEntries });
          }
          void batchMoveToDay(moves);
        }
        return;
      }

      // Single-node drag.
      if (node.id.startsWith("group:")) {
        const pg = parseGroupNodeId(node.id);
        const gid = pg?.groupId ?? "";
        // Find the target row by asking where the pointer released.
        const flowPt = rf.screenToFlowPosition({
          x: (event as MouseEvent).clientX,
          y: (event as MouseEvent).clientY,
        });
        const targetRowId = rowAtFlowY(flowPt.y);
        if (!targetRowId) return;
        // Faux instance (`group:GID@DAY`): the outline box that gathers a
        // group's letters which were pulled to an override day. Dragging
        // it re-targets THOSE letters' delivery overrides — the group's
        // own delivery day is untouched.
        if (pg?.dayKey != null) {
          if (targetRowId === pg.dayKey) return;
          const instanceLetters = letters.filter(
            (l) =>
              l.letter_group_id === gid &&
              (l.effective_day_id ?? "unscheduled") === pg.dayKey
          );
          const targetDayId =
            targetRowId === "unscheduled" ? null : targetRowId;
          void (async () => {
            for (const l of instanceLetters) {
              await moveInspectionLetterToDay(l.id, targetDayId);
            }
          })();
          return;
        }
        const entry = groupMeta.find((g) => g.gid === gid);
        if (!entry) return;
        if (targetRowId === entry.rowId) return;
        const previousDayId =
          entry.rowId === "unscheduled" ? null : entry.rowId;
        recordUndo?.({
          kind: "moveLetterGroup",
          groupId: gid,
          previousDayId,
        });
        void moveLetterGroupToDay(
          gid,
          targetRowId === "unscheduled" ? null : targetRowId
        );
      } else if (node.id.startsWith("report:")) {
        const sid = node.id.slice("report:".length);
        const flowPt = rf.screenToFlowPosition({
          x: (event as MouseEvent).clientX,
          y: (event as MouseEvent).clientY,
        });
        const targetRowId = rowAtFlowY(flowPt.y);
        if (!targetRowId) return;
        const seg = segments.find((s) => s.id === sid);
        recordUndo?.({
          kind: "moveReport",
          segmentId: sid,
          previousOverrideId: seg?.delivery_day_override_id ?? null,
          previousOffset: seg?.delivery_day_offset ?? null,
        });
        void moveReportSegmentToDay(
          sid,
          targetRowId === "unscheduled" ? null : targetRowId
        );
      } else if (node.id.startsWith("letter:")) {
        // Drop target: the letter-group node the pointer is over.
        const parsed = parseLetterNodeId(node.id);
        if (!parsed) return;
        const sourceGid = parsed.groupId;
        const sourceStoryline = groupMeta.find(
          (g) => g.gid === sourceGid
        )?.storylineId;
        const intersecting = rf
          .getIntersectingNodes(node)
          .filter((nn) => {
            if (nn.type !== "letterGroup") return false;
            const pg = parseGroupNodeId(nn.id);
            return pg?.groupId !== sourceGid;
          });
        if (intersecting.length === 0) {
          // Dropped on empty space, not onto another group. When the
          // letter is the ONLY letter in its group, the drag reads as
          // moving the whole group to that day — the group has no other
          // content, so a per-letter override would just desync the
          // (now-empty) group pill from its sole letter.
          const sourceGroupLetters = letters.filter(
            (l) => l.letter_group_id === sourceGid
          );
          if (sourceGroupLetters.length !== 1) return;
          const flowPt = rf.screenToFlowPosition({
            x: (event as MouseEvent).clientX,
            y: (event as MouseEvent).clientY,
          });
          const targetRowId = rowAtFlowY(flowPt.y);
          if (!targetRowId) return;
          const meta = groupMeta.find((g) => g.gid === sourceGid);
          if (!meta || meta.rowId === targetRowId) return;
          const previousDayId =
            meta.rowId === "unscheduled" ? null : meta.rowId;
          recordUndo?.({
            kind: "moveLetterGroup",
            groupId: sourceGid,
            previousDayId,
          });
          void moveLetterGroupToDay(
            sourceGid,
            targetRowId === "unscheduled" ? null : targetRowId
          );
          return;
        }
        const targetGroupNode = intersecting[0];
        const targetGid = parseGroupNodeId(targetGroupNode.id)?.groupId ?? "";
        const targetStoryline = groupMeta.find(
          (g) => g.gid === targetGid
        )?.storylineId;
        if (
          !sourceStoryline ||
          !targetStoryline ||
          sourceStoryline !== targetStoryline
        ) {
          return; // cross-storyline drops are silently ignored
        }
        const letterId = (node.data as { letterId?: string } | undefined)
          ?.letterId;
        // We don't have the letter row id in the node data yet; we get
        // it from the letters prop by matching group + variant.
        const droppedVariantKey = parsed.variantKey;
        const letter = letters.find(
          (l) =>
            l.letter_group_id === sourceGid &&
            (l.variant ?? "") === droppedVariantKey
        );
        const resolvedLetterId = letterId ?? letter?.id;
        if (!resolvedLetterId) return;
        recordUndo?.({
          kind: "moveLetter",
          letterId: resolvedLetterId,
          previousGroupId: sourceGid,
        });
        void moveLetterToGroup(resolvedLetterId, targetGid);
      }
    },
    [rowMeta, groupMeta, letters, segments, recordUndo, nodes]
  );

  // -----------------------------------------------------------------
  // Edge reconnect (Phase 4) — drag the arrowhead end of an action's
  // next-letter edge to retarget it (drop on a letter card) or clear it
  // (drop on empty space). xyflow fires onReconnect for valid drops and
  // always fires onReconnectEnd; the boolean ref distinguishes the two
  // cases so a retarget doesn't also clear.
  // -----------------------------------------------------------------
  const edgeReconnectSuccessful = useRef(true);

  // During an `ln` (letter→next-letter direct) reconnect the original
  // edge is hidden by ReactFlow while the user drags. To preserve the
  // letter→chip half of the path visually, we capture the in-flight
  // edge's chip + color metadata here, and the custom connectionLine
  // component below reads from it to redraw the static half plus a
  // live chip→cursor segment. Same trick for `ls` (letter→report) and
  // `stub` (dangling letter) so retargeting feels consistent.
  type ReconnectVisual = {
    chipX: number;
    chipY: number;
    /** Horizontal nudge applied to the path's source-side endpoint so
     *  the letter→chip half lines up identically to the static edge
     *  (it emerges directly under its chip even when the letter has
     *  multiple outgoing actions). */
    sourceXOffset: number;
    color: string;
    path2Color: string;
    chipColor: string;
    iconType: import("@/lib/db/enums").IconType;
    iconValue: string | null;
    actionName: string;
    hideChip: boolean;
  };
  const reconnectVisualRef = useRef<ReconnectVisual | null>(null);
  // Forces the connection-line component to re-render when the ref
  // flips on/off — the line's `toX`/`toY` updates cover cursor moves,
  // but the initial chip-overlay paint needs an explicit nudge.
  const [reconnectActive, setReconnectActive] = useState(false);

  const onReconnectStart = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      edgeReconnectSuccessful.current = false;
      const m = edge.id.match(/^a:[^:]+:(ls|sn|ln|stub)$/);
      if (!m) return;
      const edgeKind = m[1];
      // sn source is a report, not a letter — no chip to preserve.
      if (edgeKind === "sn") return;
      const data = edge.data as ActionIconEdgeData | undefined;
      if (!data || data.hideChip) return;
      reconnectVisualRef.current = {
        chipX: data.chipX,
        chipY: data.chipY,
        sourceXOffset: data.sourceXOffset ?? 0,
        color: data.color,
        path2Color: data.path2Color ?? data.color,
        chipColor: data.chipColor ?? data.color,
        iconType: data.iconType,
        iconValue: data.iconValue,
        actionName: data.actionName,
        hideChip: false,
      };
      setReconnectActive(true);
    },
    []
  );

  // Resolve the current letter id an action's next_letter_variant points
  // at, walking through the source action's storyline/group_sequence to
  // find the adjacent group. Returns null when the action has no next
  // letter linked or the variant doesn't resolve cleanly. Used to
  // capture undo entries before mutating the link.
  const resolveCurrentNextLetterId = useCallback(
    (actionId: string): string | null => {
      const action = actions.find((a) => a.id === actionId);
      if (!action || !action.next_letter_variant) return null;
      const srcLetter = letters.find(
        (l) => l.id === action.inspection_letter_id
      );
      if (!srcLetter) return null;
      const adjacentGroup = letterGroups.find(
        (g) =>
          g.storyline_id === srcLetter.storyline_id &&
          g.sequence === srcLetter.group_sequence + 1
      );
      if (!adjacentGroup) return null;
      const prev = letters.find(
        (l) =>
          l.letter_group_id === adjacentGroup.id &&
          l.variant === action.next_letter_variant
      );
      return prev?.id ?? null;
    },
    [actions, letters, letterGroups]
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const m = oldEdge.id.match(/^a:([^:]+):(ls|sn|ln|stub)$/);
      if (!m) return;
      const [, actionId, edgeKind] = m;
      const target = newConnection.target;
      if (!target) return;
      const action = actions.find((a) => a.id === actionId);
      const hadReport = !!action?.report_segment_id;
      const hadNext = !!action?.next_letter_variant;

      // -----------------------------------------------------------------
      // Drop on a REPORT card.
      // -----------------------------------------------------------------
      if (target.startsWith("report:")) {
        // sn (report → next-letter) — action already has a report and a
        // next letter. Dragging the next-letter terminator onto a report
        // is meaningless (no second report slot), so revert.
        if (edgeKind === "sn") {
          edgeReconnectSuccessful.current = true;
          return;
        }
        const segmentId = target.slice("report:".length);
        edgeReconnectSuccessful.current = true;
        recordUndo?.({
          kind: "setReport",
          actionId,
          previousReportSegmentId: action?.report_segment_id ?? null,
        });
        void dispatchReportSegment(actionId, segmentId);
        // Dropping any non-sn edge on a report retargets the report. If
        // the action ALSO had a next letter (either via ln retarget or
        // ls retarget on a complete chain), clear it: the chain is now
        // visually broken and the user picked the new report as the
        // chain's terminus.
        if (hadNext) void dispatchNextLetter(actionId, null, null);
        return;
      }

      // -----------------------------------------------------------------
      // Drop on a LETTER card.
      // -----------------------------------------------------------------
      if (!target.startsWith("letter:")) return;
      const tm = parseLetterNodeId(target);
      if (!tm) return;
      const targetGid = tm.groupId;
      const targetVariantKey = tm.variantKey;
      const tgtLetter = letters.find(
        (l) =>
          l.letter_group_id === targetGid &&
          (l.variant ?? "") === targetVariantKey
      );
      if (!tgtLetter) return;
      // Mirror the server-side same-storyline + adjacent-group check so
      // we don't paint an optimistic edge for drops the server will
      // silently reject.
      const tgtGroup = letterGroups.find((g) => g.id === targetGid);
      const srcLetter = action
        ? letters.find((l) => l.id === action.inspection_letter_id)
        : null;
      if (!tgtGroup || !srcLetter) return;
      if (tgtGroup.storyline_id !== srcLetter.storyline_id) return;
      if (Number(tgtGroup.sequence) !== Number(srcLetter.group_sequence) + 1)
        return;

      edgeReconnectSuccessful.current = true;
      const previousLetterId = resolveCurrentNextLetterId(actionId);
      recordUndo?.({
        kind: "setNextLetter",
        actionId,
        previousLetterId,
      });
      const optimisticVariant = tgtLetter.variant ?? "";
      void dispatchNextLetter(actionId, tgtLetter.id, optimisticVariant);

      // ls (letter → report) dragged to a letter: the user dropped the
      // report-end onto a letter, converting the action from
      // letter→report into a direct letter→next-letter. Clear the
      // existing report so the action becomes a clean ln. (For sn/ln/
      // stub edges the action either had no report or kept its report;
      // no clear needed.)
      if (edgeKind === "ls" && hadReport) {
        recordUndo?.({
          kind: "setReport",
          actionId,
          previousReportSegmentId: action?.report_segment_id ?? null,
        });
        void dispatchReportSegment(actionId, null);
      }
    },
    [
      letters,
      letterGroups,
      actions,
      recordUndo,
      resolveCurrentNextLetterId,
      dispatchNextLetter,
      dispatchReportSegment,
    ]
  );

  const onReconnectEnd = useCallback(
    (
      _evt: MouseEvent | TouchEvent,
      edge: Edge,
      _handleType: "source" | "target",
      _state: FinalConnectionState
    ) => {
      if (!edgeReconnectSuccessful.current) {
        const m = edge.id.match(/^a:([^:]+):(ls|sn|ln|stub)$/);
        if (m) {
          const actionId = m[1];
          const edgeKind = m[2];
          // Drop on empty space: clear the underlying link.
          //   - ls → clear `report_segment_id`
          //   - sn/ln/stub → clear `next_letter_variant`
          if (edgeKind === "ls") {
            const action = actions.find((a) => a.id === actionId);
            recordUndo?.({
              kind: "setReport",
              actionId,
              previousReportSegmentId: action?.report_segment_id ?? null,
            });
            void dispatchReportSegment(actionId, null);
          } else {
            const previousLetterId = resolveCurrentNextLetterId(actionId);
            recordUndo?.({
              kind: "setNextLetter",
              actionId,
              previousLetterId,
            });
            void dispatchNextLetter(actionId, null, null);
          }
        }
      }
      edgeReconnectSuccessful.current = true;
      reconnectVisualRef.current = null;
      setReconnectActive(false);
    },
    [
      actions,
      recordUndo,
      resolveCurrentNextLetterId,
      dispatchNextLetter,
      dispatchReportSegment,
    ]
  );

  // Live drop-target validation. Three reconnect/connect flows share
  // this filter:
  //   • reconnect of an action edge (source = letter:* or report:*) → must drop on a letter card
  //   • new connection from a "next" connect-source handle           → must drop on a letter card
  //   • new connection from a "report" connect-source handle         → must drop on a report card
  // The strict same-storyline / adjacent-group / same-report-group
  // validations run server-side; invalid drops are silent no-ops.
  const isValidConnection = useCallback((conn: Edge | Connection) => {
    const src = conn.source;
    const tgt = conn.target;
    if (!src || !tgt) return false;
    if (src.startsWith("connect:")) {
      const m = src.match(/^connect:[^:]+:(report|next|any)$/);
      if (m?.[1] === "report") return tgt.startsWith("report:");
      if (m?.[1] === "next") return tgt.startsWith("letter:");
      if (m?.[1] === "any")
        return tgt.startsWith("letter:") || tgt.startsWith("report:");
      return false;
    }
    // Edge reconnects:
    //   - letter source → either retargeting next-letter (letter target)
    //     or retargeting report (report target)
    //   - report source → segment→next-letter retargets to letters; we
    //     also accept report drops so the sn→report case lands in
    //     onReconnect (which no-ops it) instead of being treated as a
    //     drop-on-empty-space and clearing the link.
    if (src.startsWith("letter:")) {
      return tgt.startsWith("letter:") || tgt.startsWith("report:");
    }
    return tgt.startsWith("letter:") || tgt.startsWith("report:");
  }, []);

  // New connection (from a connect-source handle): create a brand-new
  // report or next-letter link on an action that didn't have one.
  const onConnect = useCallback(
    (conn: Connection) => {
      const src = conn.source;
      const tgt = conn.target;
      if (!src || !tgt) return;
      const m = src.match(/^connect:([^:]+):(report|next|any)$/);
      if (!m) return;
      const [, actionId, srcKind] = m;
      // "any" handle: figure out the kind from the drop target type.
      // Letter target → next-letter; report target → report.
      let kind: "report" | "next" | null = null;
      if (srcKind === "any") {
        if (tgt.startsWith("report:")) kind = "report";
        else if (tgt.startsWith("letter:")) kind = "next";
      } else {
        kind = srcKind as "report" | "next";
      }
      if (!kind) return;
      if (kind === "report") {
        if (!tgt.startsWith("report:")) return;
        const segmentId = tgt.slice("report:".length);
        const action = actions.find((a) => a.id === actionId);
        recordUndo?.({
          kind: "setReport",
          actionId,
          previousReportSegmentId: action?.report_segment_id ?? null,
        });
        void dispatchReportSegment(actionId, segmentId);
        return;
      }
      // kind === "next"
      if (!tgt.startsWith("letter:")) return;
      const tm = parseLetterNodeId(tgt);
      if (!tm) return;
      const targetGid = tm.groupId;
      const targetVariantKey = tm.variantKey;
      const tgtLetter = letters.find(
        (l) =>
          l.letter_group_id === targetGid &&
          (l.variant ?? "") === targetVariantKey
      );
      if (!tgtLetter) return;
      // Same client-side adjacency guard as onReconnect so we paint an
      // optimistic edge only for moves the server will accept.
      const tgtGroup = letterGroups.find((g) => g.id === targetGid);
      const action = actions.find((a) => a.id === actionId);
      const srcLetter = action
        ? letters.find((l) => l.id === action.inspection_letter_id)
        : null;
      if (!tgtGroup || !srcLetter) return;
      if (tgtGroup.storyline_id !== srcLetter.storyline_id) return;
      if (Number(tgtGroup.sequence) !== Number(srcLetter.group_sequence) + 1)
        return;
      const previousLetterId = resolveCurrentNextLetterId(actionId);
      recordUndo?.({
        kind: "setNextLetter",
        actionId,
        previousLetterId,
      });
      const optimisticVariant = tgtLetter.variant ?? "";
      void dispatchNextLetter(actionId, tgtLetter.id, optimisticVariant);
    },
    [
      letters,
      letterGroups,
      actions,
      recordUndo,
      resolveCurrentNextLetterId,
      dispatchNextLetter,
      dispatchReportSegment,
    ]
  );

  // Decorate the static layout with the current drag-pointer feedback
  // (hovered row band + hovered drop-target group). Kept as a thin map
  // outside the layout useMemo so per-frame hover updates don't trigger
  // the heavy O(nodes+edges) recompute.
  const decoratedNodes = useMemo<Node[]>(() => {
    if (!hoveredRowId && !hoveredGroupId && !dragPreview) return nodes;

    // Drag preview: ghost the dragged node + its children, and shadow-
    // shift the items that move relative to it. For a letter-group drag
    // that means the group's relative-dated reports (no absolute
    // override) and their cluster boxes follow the group by the same
    // vertical delta — reports pinned to an absolute day stay put.
    let draggedGroupId: string | null = null;
    const linkedReportNodeIds = new Set<string>();
    if (dragPreview && dragPreview.nodeId.startsWith("group:")) {
      draggedGroupId = parseGroupNodeId(dragPreview.nodeId)?.groupId ?? null;
      if (draggedGroupId) {
        for (const s of segments) {
          if (
            s.letter_group_id === draggedGroupId &&
            s.delivery_day_override_id == null
          ) {
            linkedReportNodeIds.add(`report:${s.id}`);
          }
        }
      }
    }

    return nodes.map((n) => {
      let next = n;
      if (hoveredRowId && n.id === `band:${hoveredRowId}`) {
        next = { ...next, data: { ...next.data, hovered: true } };
      }
      if (hoveredGroupId && n.id === `group:${hoveredGroupId}`) {
        next = { ...next, data: { ...next.data, hovered: true } };
      }
      if (dragPreview) {
        const isDragged = n.id === dragPreview.nodeId;
        const isChildOfDragged = n.parentId === dragPreview.nodeId;
        const isLinkedReport = linkedReportNodeIds.has(n.id);
        const isLinkedCluster =
          draggedGroupId != null &&
          n.id.startsWith("reportcluster:") &&
          n.id.endsWith(`:${draggedGroupId}`);
        if (isDragged || isChildOfDragged) {
          // ReactFlow already moves these (the dragged node + its
          // children); we just ghost them.
          next = { ...next, data: { ...next.data, dragGhost: true } };
        } else if (isLinkedReport) {
          next = {
            ...next,
            position: {
              ...next.position,
              y: next.position.y + dragPreview.dy,
            },
            data: { ...next.data, dragGhost: true },
          };
        } else if (isLinkedCluster) {
          next = {
            ...next,
            position: {
              ...next.position,
              y: next.position.y + dragPreview.dy,
            },
          };
        }
      }
      return next;
    });
  }, [nodes, hoveredRowId, hoveredGroupId, dragPreview, segments]);

  // Auto-pan to the selected entity so it's visible after a click on the
  // panel's storylines list moves the selection somewhere off-screen. Use
  // two RAFs so the graph container has reflowed (the inspector aside
  // makes it narrower) before we recenter — otherwise setCenter centers
  // in the old viewport and the target lands off-screen.
  //
  // Only re-fires when the SELECTION IDENTITY changes (not on every
  // layout recompute / postgres_changes refresh). Otherwise a single
  // remote edit by a peer would re-center the canvas for everyone with
  // a selection, which is jarring.
  const selectionCenterRef = useRef(selectionCenter);
  selectionCenterRef.current = selectionCenter;
  const selectionKey = selection
    ? selection.kind === "letter" || selection.kind === "actions"
      ? `${selection.kind}:${selection.groupId}:${selection.variantKey}${
          selection.kind === "actions" ? `:${selection.actionId}` : ""
        }`
      : selection.kind === "group"
        ? `group:${selection.groupId}`
        : selection.kind === "segment"
          ? `segment:${selection.segmentId}`
          : "other"
    : null;
  const autozoomEnabledRef = useRef(autozoomEnabled);
  autozoomEnabledRef.current = autozoomEnabled;
  useEffect(() => {
    const rf = rfRef.current;
    if (!rf) return;
    if (!selectionKey) return;
    // Gated on the per-user auto-zoom preference. The button below
    // still recenters on demand even when this is off.
    if (!autozoomEnabledRef.current) return;
    const c = selectionCenterRef.current(selection);
    if (!c) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        rf.setCenter(c.x, c.y, { zoom: 1, duration: 350 });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // Flush queueFocus once the freshly created entity appears in our data.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    let exists = false;
    if (pending.kind === "letter" || pending.kind === "actions") {
      exists = letters.some(
        (l) =>
          l.letter_group_id === pending.groupId &&
          variantKey(l.variant) === pending.variantKey
      );
    } else if (pending.kind === "segment") {
      exists = segments.some((s) => s.id === pending.segmentId);
    } else if (pending.kind === "group") {
      exists = letterGroups.some((g) => g.id === pending.groupId);
    }
    if (exists) {
      pendingFocusRef.current = null;
      select(pending);
    }
  }, [letters, segments, letterGroups, select]);

  // Custom connection line for in-flight edge reconnects. Default
  // behavior draws a single line from source to cursor, which erases
  // the letter→chip half of an ln/ls/stub edge mid-drag. By reading
  // the captured chip position from the ref, we redraw that static
  // half plus a live chip→cursor segment so the chain reads as
  // continuous while the user retargets.
  const ConnectionLine = useCallback(
    (props: ConnectionLineComponentProps) => {
      const v = reconnectVisualRef.current;
      // Fallback for non-captured drags (e.g. sn or fresh
      // connection-source drags): plain straight line.
      if (!v || !reconnectActive) {
        return (
          <path
            d={`M${props.fromX},${props.fromY} L${props.toX},${props.toY}`}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={1.75}
          />
        );
      }
      const CURVATURE = 0.5;
      // Apply the same source-X nudge the static edge uses so the
      // letter→chip half stays pixel-identical when the user grabs
      // the endpoint — it emerges right under the chip rather than
      // from the letter's bottom-center.
      const adjustedSourceX = props.fromX + v.sourceXOffset;
      const [path1] = getBezierPath({
        sourceX: adjustedSourceX,
        sourceY: props.fromY,
        targetX: v.chipX,
        targetY: v.chipY,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        curvature: CURVATURE,
      });
      const [path2] = getBezierPath({
        sourceX: v.chipX,
        sourceY: v.chipY,
        targetX: props.toX,
        targetY: props.toY,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        curvature: CURVATURE,
      });
      return (
        <>
          <path
            d={path1}
            fill="none"
            stroke={v.color}
            strokeWidth={1.75}
          />
          <path
            d={path2}
            fill="none"
            stroke={v.path2Color}
            strokeWidth={1.75}
          />
          {/* Chip portaled into ReactFlow's edge-label-renderer
              container — same DOM tree as live-edge chips, so we
              avoid the sub-pixel jitter that comes from re-rendering
              a foreignObject every time the path's d-attribute
              updates. The connection-line SVG has z-index 1001 in
              the xyflow base CSS, so the chip's z-index is bumped
              above that to keep it on top. */}
          {!v.hideChip ? (
            <EdgeLabelRenderer>
              <div
                className="nodrag nopan"
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${v.chipX}px, ${v.chipY}px)`,
                  pointerEvents: "none",
                  zIndex: 1002,
                }}
                title={v.actionName}
              >
                <div
                  className="relative inline-flex h-5 w-5 items-center justify-center rounded-md border-0"
                  style={{
                    background: v.chipColor,
                    color: readableOnHex(v.chipColor),
                  }}
                >
                  {v.iconValue ? (
                    <IconDisplay
                      type={v.iconType}
                      value={v.iconValue}
                      size={12}
                    />
                  ) : (
                    <span className="text-[10px] font-mono font-semibold">
                      {v.actionName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            </EdgeLabelRenderer>
          ) : null}
        </>
      );
    },
    [reconnectActive]
  );

  // Zoom-to-selection button gestures. A quick tap recenters on the
  // selection; a press-and-hold (≥450ms) or a double-click toggles the
  // per-user auto-zoom preference. holdHandledRef swallows the click
  // that follows a hold so it doesn't also recenter.
  const zoomHoldTimerRef = useRef<number | null>(null);
  const zoomHoldHandledRef = useRef(false);
  const cancelZoomHold = useCallback(() => {
    if (zoomHoldTimerRef.current) {
      clearTimeout(zoomHoldTimerRef.current);
      zoomHoldTimerRef.current = null;
    }
  }, []);
  const onZoomBtnPointerDown = useCallback(() => {
    zoomHoldHandledRef.current = false;
    cancelZoomHold();
    zoomHoldTimerRef.current = window.setTimeout(() => {
      zoomHoldHandledRef.current = true;
      setAutozoomEnabled((v) => !v);
    }, 450);
  }, [cancelZoomHold, setAutozoomEnabled]);
  const onZoomBtnClick = useCallback(() => {
    if (zoomHoldHandledRef.current) {
      zoomHoldHandledRef.current = false;
      return;
    }
    // When auto-zoom is on, a plain click turns it off — the canvas is
    // already following the selection, so the click reads as "stop
    // following". When off, a click does a one-shot recenter.
    if (autozoomEnabled) {
      setAutozoomEnabled(false);
      return;
    }
    const rf = rfRef.current;
    const c = selectionCenter(selection);
    if (!rf || !c) return;
    rf.setCenter(c.x, c.y, { zoom: 1, duration: 350 });
  }, [autozoomEnabled, setAutozoomEnabled, selectionCenter, selection]);

  return (
    <div
      className={
        "relative h-full overflow-hidden rounded-md border border-border bg-background" +
        // While a node drag is in progress, force grabbing on every child
        // so the cursor stays consistent even when xyflow's pointer
        // capture pulls focus away from the dragged node element.
        (isDragging ? " [&_*]:!cursor-grabbing" : "") +
        // When the graph is locked, downgrade the per-node cursor-grab
        // styles to pointer so cards read as click-to-inspect, not
        // drag-to-move.
        (!editingEnabled
          ? " [&_.cursor-grab]:!cursor-pointer [&_.cursor-grab]:active:!cursor-pointer"
          : "")
      }
    >
      <ReactFlow
        nodes={decoratedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={editingEnabled}
        // Required for the reconnect-drag connection line to render. New
        // connections from arbitrary handles are still blocked: every
        // handle is either drop-only (letter targets) or fully
        // unconnectable (letter sources, report nodes, stub targets).
        // When locked, also drop the global flag so even rogue handles
        // can't initiate fresh drags.
        nodesConnectable={editingEnabled}
        elementsSelectable={true}
        // Click-and-drag on empty pane always pans the canvas, including
        // when editing is unlocked. (Rubber-band multi-select is dropped
        // — node-drag still works for moving nodes when unlocked.)
        selectionOnDrag={false}
        edgesFocusable={false}
        isValidConnection={isValidConnection}
        onConnect={editingEnabled ? onConnect : undefined}
        onReconnectStart={editingEnabled ? onReconnectStart : undefined}
        onReconnect={editingEnabled ? onReconnect : undefined}
        onReconnectEnd={editingEnabled ? onReconnectEnd : undefined}
        connectionLineComponent={ConnectionLine}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll
        zoomActivationKeyCode="Meta"
        panOnDrag={true}
        onNodeClick={(_, node) => {
          // Column bands cover the canvas and are purely visual day-row
          // separators — a click on one reads as a click on blank
          // background, so it deselects.
          if (node.type === "columnBand") {
            select(null);
            return;
          }
          const d = node.data as { onSelect?: () => void } | undefined;
          d?.onSelect?.();
        }}
        onEdgeClick={(_, edge) => {
          // Edge IDs encode the action + kind: `a:<actionId>:<ls|sn|ln|stub>`.
          // Clicking any segment selects the underlying action so the
          // inspector opens at the same place the chip click would.
          const m = edge.id.match(/^a:([^:]+):(ls|sn|ln|stub)$/);
          if (!m) return;
          const [, actionId] = m;
          const action = actions.find((a) => a.id === actionId);
          if (!action) return;
          const srcLetter = letters.find(
            (l) => l.id === action.inspection_letter_id
          );
          if (!srcLetter) return;
          select({
            kind: "actions",
            groupId: srcLetter.letter_group_id,
            variantKey: srcLetter.variant ?? "",
            actionId,
          });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          const e = event as unknown as MouseEvent;
          e.stopPropagation();
          const m = edge.id.match(/^a:([^:]+):(ls|sn|ln|stub)$/);
          if (!m) return;
          const [, actionId, edgeKind] = m;
          // Stub edges represent an action with neither report nor
          // next-letter — nothing to disconnect.
          if (edgeKind === "stub") return;
          const action = actions.find((a) => a.id === actionId);
          if (!action) return;
          // ls → clears the report link; sn/ln → clears the next letter.
          const clearsReport = edgeKind === "ls";
          const label = clearsReport
            ? "Disconnect Report"
            : "Disconnect Next Letter";
          const anchor = { x: e.clientX, y: e.clientY };
          setContextMenu({
            anchor,
            items: [
              {
                label,
                icon: <Trash2 size={12} aria-hidden />,
                intent: "destructive",
                onClick: () =>
                  void (async () => {
                    if (clearsReport) {
                      recordUndo?.({
                        kind: "setReport",
                        actionId,
                        previousReportSegmentId:
                          action.report_segment_id ?? null,
                      });
                      await dispatchReportSegment(actionId, null);
                    } else {
                      const previousLetterId =
                        resolveCurrentNextLetterId(actionId);
                      recordUndo?.({
                        kind: "setNextLetter",
                        actionId,
                        previousLetterId,
                      });
                      await dispatchNextLetter(actionId, null, null);
                    }
                  })(),
              },
            ],
          });
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          const e = event as unknown as MouseEvent;
          const anchor = { x: e.clientX, y: e.clientY };
          const trashIcon = <Trash2 size={12} aria-hidden />;
          const copyIcon = <Copy size={12} aria-hidden />;
          // Letter → duplicate + delete (+ Add Actions when empty).
          if (node.id.startsWith("letter:")) {
            const parsed = parseLetterNodeId(node.id);
            if (!parsed) return;
            const letter = letters.find(
              (l) =>
                l.letter_group_id === parsed.groupId &&
                (l.variant ?? "") === parsed.variantKey
            );
            if (!letter) return;
            const hasActions = actions.some(
              (a) => a.inspection_letter_id === letter.id
            );
            // Dedup paired templates to single "A + B" entries (mirrors
            // the inspector's action picker). The lower-sort_order
            // template id is the canonical anchor and
            // addActionFromTemplate inserts both halves server-side.
            const templateById = new Map(
              actionTemplates.map((t) => [t.id, t])
            );
            const templateEntries: Array<{ id: string; label: string }> = [];
            const seenTemplateIds = new Set<string>();
            for (const t of actionTemplates) {
              if (seenTemplateIds.has(t.id)) continue;
              const partner = t.paired_template_id
                ? templateById.get(t.paired_template_id)
                : undefined;
              if (partner) {
                const [a, b] =
                  t.sort_order <= partner.sort_order
                    ? [t, partner]
                    : [partner, t];
                templateEntries.push({
                  id: a.id,
                  label: `${a.name} + ${b.name}`,
                });
                seenTemplateIds.add(a.id);
                seenTemplateIds.add(b.id);
              } else {
                templateEntries.push({ id: t.id, label: t.name });
                seenTemplateIds.add(t.id);
              }
            }
            const items: GraphContextMenuItem[] = [];
            // Pin / Unpin: commit this letter to an absolute day, or release
            // an absolute pin back to a relative offset (cleared when the
            // resulting day matches the group's own delivery day).
            {
              const effDayId = letter.effective_day_id;
              const effDay = effDayId
                ? days.find((d) => d.id === effDayId)
                : undefined;
              if (effDayId && effDay) {
                const variantLetters = letters.filter(
                  (l) =>
                    l.letter_group_id === parsed.groupId &&
                    variantKey(l.variant) === parsed.variantKey
                );
                const dayLabel = effDay.identifier ?? `D${effDay.number}`;
                if (letter.delivery_day_override_id != null) {
                  items.push({
                    label: `Unpin from ${dayLabel}`,
                    icon: <PinOff size={12} aria-hidden />,
                    onClick: () =>
                      void (async () => {
                        for (const l of variantLetters) {
                          await moveInspectionLetterToDay(l.id, effDayId);
                        }
                      })(),
                  });
                } else {
                  items.push({
                    label: `Pin to ${dayLabel}`,
                    icon: <Pin size={12} fill="currentColor" aria-hidden />,
                    onClick: () =>
                      void (async () => {
                        for (const l of variantLetters) {
                          await pinInspectionLetterToDay(l.id, effDayId);
                        }
                      })(),
                  });
                }
                items.push({ divider: true });
              }
            }
            if (!hasActions && templateEntries.length > 0) {
              items.push({
                label: "Add Actions",
                icon: <Milestone size={12} aria-hidden />,
                trailing: <ChevronRight size={12} aria-hidden />,
                submenu: templateEntries.map((entry) => ({
                  label: entry.label,
                  onClick: () =>
                    void (async () => {
                      await addActionFromTemplate(
                        parsed.groupId,
                        letter.id,
                        entry.id
                      );
                    })(),
                })),
              });
              items.push({ divider: true });
            }
            items.push({
              label: "Duplicate Letter",
              icon: copyIcon,
              onClick: () =>
                void (async () => {
                  const { newLetterId } = await duplicateInspectionLetter(
                    letter.id
                  );
                  // Variant is reassigned server-side; we don't know
                  // the variant until the data refreshes. Queue by id
                  // via a one-shot lookup in the focus-flush effect:
                  // store the letter's group + a sentinel variant of
                  // "" and let the effect resolve via id matching.
                  const _ = newLetterId; // for now, no focus until we resolve via id
                })(),
            });
            items.push({ divider: true });
            items.push({
              label: "Delete Letter",
              icon: trashIcon,
              intent: "destructive",
              onClick: () =>
                void (async () => {
                  const ok = await confirm({
                    title: "Delete letter?",
                    message: `${letter.content_id} and its actions will be removed. This cannot be undone.`,
                    confirmLabel: "Delete",
                    intent: "destructive",
                  });
                  if (!ok) return;
                  markPendingDelete("letters", letter.id);
                  await deleteInspectionLetter(parsed.groupId, letter.id);
                  if (
                    selection?.kind === "letter" &&
                    selection.groupId === parsed.groupId &&
                    selection.variantKey === parsed.variantKey
                  ) {
                    select(null);
                  }
                })(),
            });
            setContextMenu({ anchor, items });
            return;
          }
          if (node.id.startsWith("report:")) {
            const segId = node.id.slice("report:".length);
            const reportItems: GraphContextMenuItem[] = [];
            // Pin / Unpin: commit this report to an absolute day, or release
            // an absolute pin back to a relative offset (cleared when the
            // resulting day matches the report's default day).
            {
              const seg = segments.find((s) => s.id === segId);
              const effDayId = seg?.effective_day_id ?? null;
              const effDay = effDayId
                ? days.find((d) => d.id === effDayId)
                : undefined;
              if (seg && effDayId && effDay) {
                const dayLabel = effDay.identifier ?? `D${effDay.number}`;
                if (seg.delivery_day_override_id != null) {
                  reportItems.push({
                    label: `Unpin from ${dayLabel}`,
                    icon: <PinOff size={12} aria-hidden />,
                    onClick: () => void moveReportSegmentToDay(segId, effDayId),
                  });
                } else {
                  reportItems.push({
                    label: `Pin to ${dayLabel}`,
                    icon: <Pin size={12} fill="currentColor" aria-hidden />,
                    onClick: () => void pinReportSegmentToDay(segId, effDayId),
                  });
                }
                reportItems.push({ divider: true });
              }
            }
            setContextMenu({
              anchor,
              items: [
                ...reportItems,
                {
                  label: "Duplicate Report",
                  icon: copyIcon,
                  onClick: () =>
                    void (async () => {
                      // Ghost a sibling segment so the duplicate appears
                      // in the same cell instantly. Variant is picked to
                      // sort at the tail of the report group.
                      const sourceSeg = segments.find((s) => s.id === segId);
                      const tempId = makeGhostId("seg");
                      if (sourceSeg) {
                        const sameGroupSegs = segments.filter(
                          (s) => s.letter_group_id === sourceSeg.letter_group_id
                        );
                        const existingMax = Math.max(
                          0,
                          ...sameGroupSegs.map((s) => romanToInt(s.variant))
                        );
                        const ghost: ReportSegmentView = {
                          ...sourceSeg,
                          id: tempId,
                          variant: toRoman(existingMax + 1),
                          sort_order: existingMax + 1,
                          report_id: "R-?",
                        };
                        setPendingAdds((prev) => ({
                          ...prev,
                          segments: [
                            ...prev.segments,
                            { tempId, ghost, resolvedRealId: null },
                          ],
                        }));
                      }
                      try {
                        const { newSegmentId } = await duplicateReportSegment(
                          segId
                        );
                        if (sourceSeg) resolvePendingSegment(tempId, newSegmentId);
                        queueFocus({ kind: "segment", segmentId: newSegmentId });
                      } catch (err) {
                        if (sourceSeg) removePendingSegment(tempId);
                        throw err;
                      }
                    })(),
                },
                { divider: true },
                {
                  label: "Delete Report",
                  icon: trashIcon,
                  intent: "destructive",
                  onClick: () =>
                    void (async () => {
                      const seg = segments.find((s) => s.id === segId);
                      const ok = await confirm({
                        title: "Delete report segment?",
                        message: `${seg?.report_id ?? "Segment"} will be removed. This cannot be undone.`,
                        confirmLabel: "Delete",
                        intent: "destructive",
                      });
                      if (!ok) return;
                      markPendingDelete("segments", segId);
                      await deleteReportSegment(segId);
                      if (
                        selection?.kind === "segment" &&
                        selection.segmentId === segId
                      ) {
                        select(null);
                      }
                    })(),
                },
              ],
            });
            return;
          }
          // Letter group box → add letters to this group, or delete it.
          if (node.id.startsWith("group:")) {
            const pg = parseGroupNodeId(node.id);
            if (!pg) return;
            const gid = pg.groupId;
            const group = letterGroups.find((g) => g.id === gid);
            const addLetterIcon = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>+</span>
                <MailOpen size={11} aria-hidden />
              </span>
            );
            const makeAddLetters = (n: number) => () => {
              // Optimistic ghosts: synthesize fully-shaped letters so the new
              // cards appear in the group instantly (pulsing + greyed via the
              // pendingAdd flag). Variants are picked to sort past the
              // existing letters — the server reassigns them on insert, and
              // the ghost is dropped once the real letter lands.
              const storyline = group
                ? storylines.find((s) => s.id === group.storyline_id)
                : undefined;
              const groupLetters = letters.filter(
                (l) => l.letter_group_id === gid
              );
              let maxCode = 96; // 'a' - 1
              for (const l of groupLetters) {
                const c = (l.variant ?? "a").charCodeAt(0);
                if (c > maxCode) maxCode = c;
              }
              const baseSort = groupLetters.reduce(
                (m, l) => Math.max(m, l.sort_order),
                0
              );
              const ghostTempIds: string[] = [];
              const ghosts: PendingAdd<InspectionLetterView>[] = [];
              for (let i = 1; i <= n; i++) {
                const tempId = makeGhostId("letter");
                const variant = String.fromCharCode(maxCode + i);
                ghostTempIds.push(tempId);
                ghosts.push({
                  tempId,
                  ghost: {
                    id: tempId,
                    letter_group_id: gid,
                    variant,
                    piece: null,
                    sort_order: baseSort + i,
                    delivery_day_override_id: null,
                    delivery_day_offset: null,
                    summary: null,
                    content: null,
                    sender_citizen_id: null,
                    receiver_citizen_id: null,
                    notes: null,
                    updated_at: new Date(0).toISOString(),
                    updated_by: null,
                    effective_day_id: group?.delivery_day_id ?? null,
                    storyline_abbreviation: storyline?.abbreviation ?? "",
                    group_sequence: group?.sequence ?? 0,
                    storyline_id: group?.storyline_id ?? "",
                    content_id: letterDisplayId(
                      storyline?.abbreviation ?? "?",
                      group?.sequence ?? 0,
                      variant,
                      false
                    ),
                  },
                  resolvedRealId: null,
                });
              }
              setPendingAdds((prev) => ({
                ...prev,
                letters: [...prev.letters, ...ghosts],
              }));
              void (async () => {
                try {
                  const ids = await createInspectionLettersInGroup(gid, n);
                  ghostTempIds.forEach((tempId, idx) => {
                    const realId = ids[idx];
                    if (realId) resolvePendingLetter(tempId, realId);
                    else removePendingLetter(tempId);
                  });
                } catch (err) {
                  ghostTempIds.forEach(removePendingLetter);
                  throw err;
                }
              })();
            };
            setContextMenu({
              anchor,
              items: [
                {
                  label: "Letter",
                  icon: addLetterIcon,
                  onClick: makeAddLetters(1),
                },
                {
                  label: "2 Letters",
                  icon: addLetterIcon,
                  onClick: makeAddLetters(2),
                },
                {
                  label: "3 Letters",
                  icon: addLetterIcon,
                  onClick: makeAddLetters(3),
                },
                { divider: true },
                {
                  label: "Delete Letter Group",
                  icon: trashIcon,
                  intent: "destructive",
                  onClick: () =>
                    void (async () => {
                      const ok = await confirm({
                        title: "Delete letter group?",
                        message: `"${group?.name ?? "This group"}" and everything inside it — all letters, report segments, and actions — will be permanently removed. This cannot be undone.`,
                        confirmLabel: "Delete",
                        intent: "destructive",
                      });
                      if (!ok) return;
                      markPendingDelete("groups", gid);
                      await deleteGroup(gid);
                      if (
                        selection?.kind === "group" &&
                        selection.groupId === gid
                      ) {
                        select(null);
                      }
                    })(),
                },
              ],
            });
            return;
          }
          // Report-cluster box → add report segment(s) directly to this
          // cluster's letter group. No group-picker submenu: the cluster
          // already belongs to exactly one letter group.
          if (node.id.startsWith("reportcluster:")) {
            const parts = node.id.split(":");
            const clusterGroupId = parts[2];
            const group = letterGroups.find((g) => g.id === clusterGroupId);
            if (!group) return;
            const reportIcon = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>+</span>
                <Megaphone size={11} aria-hidden />
              </span>
            );
            setContextMenu({
              anchor,
              items: [
                {
                  label: "Report Segment",
                  icon: reportIcon,
                  onClick: () => createReportsForGroup(group, 1),
                },
                {
                  label: "2 Report Segments",
                  icon: reportIcon,
                  onClick: () => createReportsForGroup(group, 2),
                },
                {
                  label: "3 Report Segments",
                  icon: reportIcon,
                  onClick: () => createReportsForGroup(group, 3),
                },
              ],
            });
            return;
          }
          // Column bands cover the canvas — treat their right-click as a
          // pane right-click and let the pane-menu builder figure out the
          // day + storyline from the event coords.
          if (node.type === "columnBand") {
            openPaneMenu(e);
            return;
          }
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          openPaneMenu(event as unknown as MouseEvent);
        }}
        onPaneClick={() => select(null)}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMove={(_, v) => setVp(v)}
        onMoveEnd={(_, v) => setVp(v)}
        onInit={(rf) => {
          rfRef.current = rf;
          setVp(rf.getViewport());
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} />
        <Panel position="bottom-right">
          <div className="mr-1 overflow-hidden rounded-md border border-border bg-card shadow">
            <div
              className="flex select-none items-center justify-center border-b border-border px-2 py-1 font-mono text-[11px] tabular-nums text-foreground"
              aria-label="Zoom level"
            >
              {Math.round(vp.zoom * 100)}%
            </div>
            <div className="flex">
              <button
                type="button"
                aria-label="Zoom to selection"
                aria-pressed={autozoomEnabled}
                title={
                  autozoomEnabled
                    ? "Zoom to selection · auto-zoom ON — double-click or hold to turn off"
                    : "Zoom to selection · auto-zoom OFF — double-click or hold to turn on"
                }
                className={
                  "flex h-8 w-8 items-center justify-center " +
                  (autozoomEnabled
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-foreground hover:bg-accent")
                }
                onPointerDown={onZoomBtnPointerDown}
                onPointerUp={cancelZoomHold}
                onPointerLeave={cancelZoomHold}
                onClick={onZoomBtnClick}
                onDoubleClick={() => setAutozoomEnabled((v) => !v)}
              >
                <IconZoomScan size={16} stroke={2.4} />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                className="flex h-8 w-8 items-center justify-center border-l border-border text-foreground hover:bg-accent"
                onClick={() => rfRef.current?.zoomIn({ duration: 150 })}
              >
                <IconPlus size={16} stroke={2.4} />
              </button>
            </div>
            <div className="flex border-t border-border">
              <button
                type="button"
                aria-label="Fit view"
                title="Fit view"
                className="flex h-8 w-8 items-center justify-center text-foreground hover:bg-accent"
                onClick={() =>
                  rfRef.current?.fitView({ padding: 0.1, duration: 250 })
                }
              >
                <IconFocusCentered size={16} stroke={2.4} />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                className="flex h-8 w-8 items-center justify-center border-l border-border text-foreground hover:bg-accent"
                onClick={() => rfRef.current?.zoomOut({ duration: 150 })}
              >
                <IconMinus size={16} stroke={2.4} />
              </button>
            </div>
          </div>
        </Panel>
      </ReactFlow>
      {/* dark scrim behind storyline pills, above day-gutter labels —
          matches the inspector PanelHeader's 40px height. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 z-[19] border-b border-border bg-card/80"
        style={{ height: HEADER_H }}
      />
      <StickyStorylineHeader
        cols={labelCols}
        viewport={vp}
        onSelectStoryline={(col) => {
          const rf = rfRef.current;
          if (!rf) return;
          const cx = col.baseX + col.width / 2;
          const cy = 120;
          rf.setCenter(cx, cy, { zoom: 1, duration: 350 });
        }}
      />
      <StickyDayGutter rows={labelRows} viewport={vp} />
      <GraphContextMenu
        anchor={contextMenu?.anchor ?? null}
        items={contextMenu?.items ?? []}
        onClose={() => setContextMenu(null)}
      />
      {confirmDialog}
    </div>
  );
}

type Viewport = { x: number; y: number; zoom: number };

function StickyDayGutter({
  rows,
  viewport,
}: {
  rows: {
    rowId: string;
    baseY: number;
    height: number;
    identifier: string | null;
    label: string | null;
    isUnscheduled: boolean;
    pendingAdd: boolean;
  }[];
  viewport: Viewport;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 bottom-0 z-[22] overflow-hidden"
      style={{
        width: GUTTER_W,
      }}
    >
      {rows.map((r) => {
        const top = r.baseY * viewport.zoom + viewport.y;
        const height = Math.max(0, r.height * viewport.zoom - 6);
        return (
          <div
            key={r.rowId}
            className={
              "absolute flex flex-col items-center justify-center gap-0.5 rounded-r-md border-y border-r border-border bg-card/80 px-0.5" +
              // Ghost day (server create in flight) reads as muted + pulsing.
              (r.pendingAdd ? " animate-pulse opacity-50" : "")
            }
            style={{ top: top + 3, left: 0, right: 2, height }}
          >
            <span className="font-mono text-[11px] font-semibold tracking-widest text-foreground">
              {r.identifier ?? (r.isUnscheduled ? "—" : "")}
            </span>
            {r.label ? (
              <span className="truncate text-[9px] uppercase tracking-widest text-muted-foreground">
                {r.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StickyStorylineHeader({
  cols,
  viewport,
  onSelectStoryline,
}: {
  cols: {
    id: string;
    baseX: number;
    width: number;
    storyline: Storyline;
  }[];
  viewport: Viewport;
  onSelectStoryline?: (col: {
    id: string;
    baseX: number;
    width: number;
  }) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-[21]"
      style={{
        left: GUTTER_W,
        right: 0,
        height: HEADER_H,
        // overflow stays visible so storyline pills (whose icon-square
        // overhangs the pill's left edge) aren't clipped at the gutter
        // boundary when their column happens to align there.
      }}
    >
      {cols.map((c) => {
        const left = c.baseX * viewport.zoom + viewport.x - GUTTER_W;
        const width = c.width * viewport.zoom;
        return (
          <button
            key={c.id}
            type="button"
            className="pointer-events-auto absolute flex cursor-pointer items-center justify-center bg-transparent p-0"
            style={{ left, top: 0, width, height: HEADER_H }}
            onClick={() =>
              onSelectStoryline?.({
                id: c.id,
                baseX: c.baseX,
                width: c.width,
              })
            }
            title={`Focus ${c.storyline.name}`}
          >
            <StorylinePill storyline={c.storyline} />
          </button>
        );
      })}
    </div>
  );
}
