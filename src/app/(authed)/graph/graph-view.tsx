"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  PanOnScrollMode,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  IconFocusCentered,
  IconMinus,
  IconPlus,
  IconZoomScan,
} from "@tabler/icons-react";
import { StorylinePill } from "@/components/pills";
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
  batchMoveToDay,
  moveLetterGroupToDay,
  moveLetterToGroup,
  moveReportSegmentToDay,
  setActionNextLetter,
} from "../inspection/letters/actions";
import { ActionIconEdge } from "./edges/action-icon-edge";
import ColumnBandNode from "./nodes/column-band";
import LetterGroupNode from "./nodes/letter-group";
import LetterNode from "./nodes/letter-node";
import ReportNode from "./nodes/report-node";
import StubTargetNode from "./nodes/stub-target";

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
  selection?: GraphSelection | null;
  onSelectionChange?: (sel: GraphSelection | null) => void;
};

// ------------------------------------------------------------------
// Layout constants — vertical orientation
//   rows = days (Y axis), columns = storylines (X axis), flow goes top→down.
// ------------------------------------------------------------------
const GUTTER_W = 44; // left gutter for day labels
const HEADER_H = 40; // top header for storyline labels — matches PanelHeader min-h-10
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

const GROUP_PAD_LEADING = 44; // horizontal padding inside the group outline
const GROUP_PAD_TRAILING = 44;
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
  stubTarget: StubTargetNode,
};

const edgeTypes = {
  actionIcon: ActionIconEdge,
};

// Variant key for a letter row. Null variants collapse to "".
function variantKey(v: string | null): string {
  return v ?? "";
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
  selection = null,
  onSelectionChange,
}: Props) {
  const select = useCallback(
    (sel: GraphSelection | null) => onSelectionChange?.(sel),
    [onSelectionChange]
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
    // Rows (days + unscheduled bucket) — flow top→down
    // -------------------------------------------------------------
    const rowIds: string[] = [...days.map((d) => d.id), "unscheduled"];
    const dayById = new Map(days.map((d) => [d.id, d]));
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
    type GroupInfo = {
      group: LetterGroup;
      storyline: Storyline;
      rowId: string;
      variants: string[]; // variant keys (may include "")
      variantHeights: number[]; // per-variant card height (summary-dependent)
      width: number; // group outline width (horizontal variant stack)
      height: number; // group outline height
    };

    // For each (group, variant), the primary letter is the lowest-piece one.
    // Summary shown in the card comes from this primary letter.
    const primaryLetterByGroupVariant = new Map<string, InspectionLetterView>();
    for (const l of letters) {
      const key = `${l.letter_group_id}:${variantKey(l.variant)}`;
      const existing = primaryLetterByGroupVariant.get(key);
      if (!existing || (l.piece ?? 0) < (existing.piece ?? 0)) {
        primaryLetterByGroupVariant.set(key, l);
      }
    }

    const groupsById = new Map<string, GroupInfo>();
    for (const g of letterGroups) {
      const storyline = storylineById.get(g.storyline_id);
      if (!storyline) continue;
      const groupLetters = letters.filter((l) => l.letter_group_id === g.id);
      // Distinct variant keys, preserving order (a before b before …, null first).
      const seen = new Set<string>();
      const variants: string[] = [];
      for (const l of groupLetters
        .slice()
        .sort((a, b) => {
          const va = a.variant ?? "";
          const vb = b.variant ?? "";
          if (va !== vb) return va.localeCompare(vb);
          return (a.piece ?? 0) - (b.piece ?? 0);
        })) {
        const k = variantKey(l.variant);
        if (seen.has(k)) continue;
        seen.add(k);
        variants.push(k);
      }
      // Empty groups (no letters yet) keep their slot in the layout but
      // don't render a phantom letter card — earlier code pushed an "" key
      // to size the group, which leaked through letterDisplayId as
      // "L-{abbr}{sequence}". Size as if one variant exists; render zero
      // letter nodes.
      const variantHeights =
        variants.length === 0
          ? [HEADING_ONLY_H]
          : variants.map((vk) => {
              const primary = primaryLetterByGroupVariant.get(`${g.id}:${vk}`);
              return cardHeight(primary?.summary);
            });
      const maxCardH = variantHeights.reduce((a, b) => Math.max(a, b), 0);
      const width = groupWidth(Math.max(1, variants.length));
      const height = groupHeight(maxCardH);
      const rowId = g.delivery_day_id ?? "unscheduled";
      groupsById.set(g.id, {
        group: g,
        storyline,
        rowId,
        variants,
        variantHeights,
        width,
        height,
      });
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

    // Stable group order inside cell: by sequence.
    const orderedGroups = letterGroups
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
    for (const g of orderedGroups) {
      const info = groupsById.get(g.id);
      if (!info) continue;
      const cell = getCell(info.rowId, g.storyline_id);
      cell.groupIds.push(g.id);
    }

    // Segments into cells.
    const segmentById = new Map(segments.map((s) => [s.id, s]));
    for (const s of segments) {
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
      for (const gid of cell.groupIds) {
        const gi = groupsById.get(gid);
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

        // Reports row in top half — stacked horizontally, centered in column.
        let reportsX = colCenterX - cell.topHalfW / 2;
        for (const sid of cell.segmentIds) {
          const seg = segmentById.get(sid);
          if (!seg) continue;
          const storyline = storylineById.get(seg.storyline_id);
          if (!storyline) continue;
          const segNodeId = `report:${sid}`;
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
              onSelect: () => select({ kind: "segment", segmentId: sid }),
            },
            draggable: true,
            selectable: false,
            focusable: false,
          });
          reportsX += CARD_W + CELL_GAP;
        }

        // Groups row in bottom half — stacked horizontally, centered in column.
        let groupsX = colCenterX - cell.bottomHalfW / 2;
        for (const gid of cell.groupIds) {
          const gi = groupsById.get(gid);
          if (!gi) continue;
          const abbr = gi.storyline.abbreviation;
          const groupNodeId = `group:${gid}`;
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
              color: gi.storyline.color_hex,
              selected: groupSelected,
              onSelect: () => select({ kind: "group", groupId: gid }),
            },
            draggable: true,
            selectable: false,
            focusable: false,
            style: { width: gi.width, height: gi.height },
          });

          const onlyVariant = gi.variants.length === 1;
          let relX = GROUP_PAD_LEADING;
          gi.variants.forEach((vk, i) => {
            const letterNodeId = `letter:${gid}:${vk}`;
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
                onSelect: () =>
                  select({ kind: "letter", groupId: gid, variantKey: vk }),
              },
              draggable: true,
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

    // Index: letter id → (groupId, variantKey, storyline_id, group_sequence)
    const letterIndex = new Map<
      string,
      {
        groupId: string;
        variantKey: string;
        storylineId: string;
        groupSequence: number;
      }
    >();
    for (const l of letters) {
      letterIndex.set(l.id, {
        groupId: l.letter_group_id,
        variantKey: variantKey(l.variant),
        storylineId: l.storyline_id,
        groupSequence: l.group_sequence,
      });
    }

    // Index: (storyline_id, sequence) → group id
    const groupByStorySeq = new Map<string, string>();
    for (const g of letterGroups) {
      groupByStorySeq.set(`${g.storyline_id}:${g.sequence}`, g.id);
    }

    // Set of variant keys that actually exist in each group, for next-letter
    // validation.
    const variantsInGroup = new Map<string, Set<string>>();
    for (const [gid, gi] of groupsById)
      variantsInGroup.set(gid, new Set(gi.variants));

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
      /** Synthetic id used to mint the stub-target node for dangling edges. */
      stubNodeId?: string;
    };
    const candidates: Candidate[] = [];

    // Set of action ids that set at least one ending variable. Used to paint
    // an indicator on the chip when the ending overlay is on.
    const endingActionIds = new Set<string>();
    for (const ea of endingAssignments) endingActionIds.add(ea.action_id);

    for (const a of actions) {
      const src = letterIndex.get(a.inspection_letter_id);
      if (!src) continue;
      const sourceId = `letter:${src.groupId}:${src.variantKey}`;

      const segmentNodeId = a.report_segment_id
        ? `report:${a.report_segment_id}`
        : null;
      const segmentExists = segmentNodeId
        ? segmentAbsPos.has(segmentNodeId)
        : false;

      let nextLetterId: string | null = null;
      if (a.next_letter_variant) {
        const nextGroupId = groupByStorySeq.get(
          `${src.storylineId}:${src.groupSequence + 1}`
        );
        if (nextGroupId) {
          const vset = variantsInGroup.get(nextGroupId);
          if (vset?.has(a.next_letter_variant)) {
            nextLetterId = `letter:${nextGroupId}:${a.next_letter_variant}`;
          }
        }
      }

      if (segmentExists && nextLetterId) {
        candidates.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentNodeId!,
          action: a,
          terminator: "arrow",
        });
        candidates.push({
          id: `a:${a.id}:sn`,
          source: segmentNodeId!,
          target: nextLetterId,
          action: a,
          terminator: "arrow",
        });
      } else if (segmentExists) {
        candidates.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentNodeId!,
          action: a,
          terminator: "arrow",
        });
      } else if (nextLetterId) {
        candidates.push({
          id: `a:${a.id}:ln`,
          source: sourceId,
          target: nextLetterId,
          action: a,
          terminator: "arrow",
        });
      } else {
        const stubNodeId = `stub:${a.id}`;
        candidates.push({
          id: `a:${a.id}:stub`,
          source: sourceId,
          target: stubNodeId,
          action: a,
          terminator: "circle",
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
      if (nodeId.startsWith("letter:")) {
        const m = nodeId.match(/^letter:([^:]+):/);
        if (!m) return null;
        return groupsById.get(m[1])?.rowId ?? null;
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

    // Arrow color rule:
    //   - multiple arrows converging on one target → white, so the stacked
    //     arrowheads read as a single unified arrow
    //   - single arrow → the action's own color
    // Arrowhead spacing: when multiple edges land on the same target, give
    // each its own arrowhead spread horizontally across the target's top
    // edge instead of stacking them at the same point.
    const arrowsByTarget = new Map<string, ChipPlacement[]>();
    for (const p of placements) {
      if (p.candidate.terminator !== "arrow") continue;
      const list = arrowsByTarget.get(p.candidate.target) ?? [];
      list.push(p);
      arrowsByTarget.set(p.candidate.target, list);
    }
    for (const list of arrowsByTarget.values()) {
      // Stable left-to-right order keyed by the chip's X position so the
      // visual ordering matches the source layout.
      list.sort((a, b) => a.chipX - b.chipX);
    }
    const ARROW_TARGET_PITCH = 20; // px between arrowheads at the same target
    const targetOffsetByEdgeId = new Map<string, number>();
    for (const list of arrowsByTarget.values()) {
      const N = list.length;
      list.forEach((p, i) => {
        const offset = N > 1 ? (i - (N - 1) / 2) * ARROW_TARGET_PITCH : 0;
        targetOffsetByEdgeId.set(p.candidate.id, offset);
      });
    }

    for (const p of placements) {
      const c = p.candidate;
      const resolved = resolveAction(c.action);
      // Segment → next-letter continuations render in a muted grey so the
      // primary visual energy stays on the action chip → report leg.
      const isReportSource = c.source.startsWith("report:");
      const isLetterTargetForChip = c.target.startsWith("letter:");
      const isSegmentToNextLetter = isReportSource && isLetterTargetForChip;
      const baseColor = resolved.color || "#ffffff";
      const color = isSegmentToNextLetter ? "#5e5e5e" : baseColor;
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
      e.push({
        id: c.id,
        source: c.source,
        target: c.target,
        type: "actionIcon",
        data: {
          color,
          iconType: resolved.iconType,
          iconValue: resolved.iconValue,
          actionName: resolved.name,
          chipX: p.chipX,
          chipY: p.chipY,
          terminator: c.terminator,
          impacts: p.impacts,
          badgeSide: p.badgeSide,
          targetXOffset: targetOffsetByEdgeId.get(c.id) ?? 0,
          hasEnding,
          selected: chipSelected,
          onSelect: onChipSelect,
          // The chip only appears on letter → report segment connections
          // (and on the letter → stub dangling terminator). Report →
          // next-letter continuations AND letter → next-letter direct
          // connections (no report) render as a colored line only.
          hideChip: !isLetterSource || isLetterTarget,
        },
        markerEnd:
          c.terminator === "arrow"
            ? { type: MarkerType.ArrowClosed, color: arrowColor }
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
        const gi = groupsById.get(sel.groupId);
        if (!gi) return null;
        // Group's top-left is the position pushed onto n; recompute by
        // looking up the first variant's letter position and walking back.
        const firstVariant = gi.variants[0] ?? "";
        const lp = letterAbsPos.get(`letter:${sel.groupId}:${firstVariant}`);
        if (!lp) return null;
        // Group spans from groupsX to groupsX + gi.width and from bottomY
        // to bottomY + gi.height. The variant letter sits inside at
        // (groupsX + GROUP_PAD_LEADING, centered Y).
        const groupX = lp.x - GROUP_PAD_LEADING;
        const groupY = lp.y - (gi.height - lp.h) / 2;
        return { x: groupX + gi.width / 2, y: groupY + gi.height / 2 };
      }
      if (sel.kind === "letter" || sel.kind === "actions") {
        const p = letterAbsPos.get(
          `letter:${sel.groupId}:${sel.variantKey}`
        );
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
    const groupMeta = Array.from(groupsById.entries()).map(([gid, gi]) => ({
      gid,
      rowId: gi.rowId,
      storylineId: gi.storyline.id,
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
  ]);

  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const rfRef = useRef<ReactFlowInstance | null>(null);

  // Helpers used by drag-drop handlers. They close over the current
  // memoized layout — recomputed on every render, which is fine because
  // drag handlers are also recreated per render.
  function rowAtFlowY(y: number): string | null {
    for (const r of rowMeta) {
      if (y >= r.baseY && y < r.baseY + r.height) return r.rowId;
    }
    return null;
  }

  const onNodeDragStop = useCallback(
    (
      event: React.MouseEvent | MouseEvent,
      node: Node,
      draggedNodes: Node[]
    ) => {
      const rf = rfRef.current;
      if (!rf) return;
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
        const seenGroups = new Set<string>();
        for (const dn of draggedNodes) {
          if (dn.id.startsWith("group:")) {
            const gid = dn.id.slice("group:".length);
            if (seenGroups.has(gid)) continue;
            seenGroups.add(gid);
            moves.push({
              kind: "group",
              id: gid,
              targetDayId: targetRowId === "unscheduled" ? null : targetRowId,
            });
          } else if (dn.id.startsWith("report:")) {
            const sid = dn.id.slice("report:".length);
            moves.push({
              kind: "report",
              id: sid,
              targetDayId: targetRowId === "unscheduled" ? null : targetRowId,
            });
          } else if (dn.id.startsWith("letter:")) {
            // Letters follow their group; collapse to the group move.
            const m = dn.id.match(/^letter:([^:]+):/);
            if (!m) continue;
            const gid = m[1];
            if (seenGroups.has(gid)) continue;
            seenGroups.add(gid);
            moves.push({
              kind: "group",
              id: gid,
              targetDayId: targetRowId === "unscheduled" ? null : targetRowId,
            });
          }
        }
        if (moves.length > 0) void batchMoveToDay(moves);
        return;
      }

      // Single-node drag.
      if (node.id.startsWith("group:")) {
        const gid = node.id.slice("group:".length);
        const entry = groupMeta.find((g) => g.gid === gid);
        if (!entry) return;
        // Find the target row by asking where the pointer released.
        const flowPt = rf.screenToFlowPosition({
          x: (event as MouseEvent).clientX,
          y: (event as MouseEvent).clientY,
        });
        const targetRowId = rowAtFlowY(flowPt.y);
        if (!targetRowId || targetRowId === entry.rowId) return;
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
        void moveReportSegmentToDay(
          sid,
          targetRowId === "unscheduled" ? null : targetRowId
        );
      } else if (node.id.startsWith("letter:")) {
        // Drop target: the letter-group node the pointer is over.
        const m = node.id.match(/^letter:([^:]+):(.*)$/);
        if (!m) return;
        const sourceGid = m[1];
        const sourceStoryline = groupMeta.find(
          (g) => g.gid === sourceGid
        )?.storylineId;
        const intersecting = rf
          .getIntersectingNodes(node)
          .filter(
            (nn) => nn.type === "letterGroup" && nn.id !== `group:${sourceGid}`
          );
        if (intersecting.length === 0) return;
        const targetGroupNode = intersecting[0];
        const targetGid = targetGroupNode.id.slice("group:".length);
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
        const variantKey = m[2];
        const letter = letters.find(
          (l) =>
            l.letter_group_id === sourceGid &&
            (l.variant ?? "") === variantKey
        );
        const resolvedLetterId = letterId ?? letter?.id;
        if (!resolvedLetterId) return;
        void moveLetterToGroup(resolvedLetterId, targetGid);
      }
    },
    [rowMeta, groupMeta, letters]
  );

  // Auto-pan to the selected entity so it's visible after a click on the
  // panel's storylines list moves the selection somewhere off-screen. Use
  // two RAFs so the graph container has reflowed (the inspector aside
  // makes it narrower) before we recenter — otherwise setCenter centers
  // in the old viewport and the target lands off-screen.
  useEffect(() => {
    const rf = rfRef.current;
    if (!rf) return;
    const c = selectionCenter(selection);
    if (!c) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        rf.setCenter(c.x, c.y, { zoom: 1.2, duration: 350 });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [selection, selectionCenter]);

  return (
    <div className="relative h-full overflow-hidden rounded-md border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectionOnDrag={true}
        edgesFocusable={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll
        zoomActivationKeyCode="Meta"
        panOnDrag={false}
        onNodeClick={(_, node) => {
          const d = node.data as { onSelect?: () => void } | undefined;
          d?.onSelect?.();
        }}
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
                title="Zoom to selection"
                disabled={!selectionCenter(selection)}
                className="flex h-8 w-8 items-center justify-center text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() => {
                  const rf = rfRef.current;
                  const c = selectionCenter(selection);
                  if (!rf || !c) return;
                  rf.setCenter(c.x, c.y, { zoom: 1.2, duration: 350 });
                }}
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
            className="absolute flex flex-col items-center justify-center gap-0.5 rounded-r-md border-y border-r border-border bg-card/80 px-0.5"
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
