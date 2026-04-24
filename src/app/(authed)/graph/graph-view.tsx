"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
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
import { groupSlug } from "@/lib/letter-groups";
import {
  extractActiveImpacts,
  type ActiveImpact,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import { ActionIconEdge } from "./edges/action-icon-edge";
import ColumnBandNode from "./nodes/column-band";
import DayHeaderNode from "./nodes/day-header";
import LetterGroupNode from "./nodes/letter-group";
import LetterNode from "./nodes/letter-node";
import ReportNode from "./nodes/report-node";
import StorylineRowNode from "./nodes/storyline-row";
import StubTargetNode from "./nodes/stub-target";

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
};

// ------------------------------------------------------------------
// Layout constants
// ------------------------------------------------------------------
const COL_W = 520;
const GUTTER_W = 180;
const HEADER_H = 56;
const CELL_GAP = 22; // single gap used for both reports and letters stacks
const ROW_TOP_PAD = 18;
const ROW_BOTTOM_PAD = 18;
const MIN_ROW_CONTENT_H = 48;

// Report and letter pills share a fixed width so same-day stacks line up.
const PILL_W = 110;
// Group outline is padded generously beyond the card so the faded group
// background gives the letters clear breathing room.
const GROUP_W = PILL_W + 50;

const GROUP_PAD_TOP = 18;
const GROUP_PAD_BOTTOM = 10;
const LETTER_GAP = 35;

// Card geometry — must match the PillCard layout in components/pills.tsx.
// The pill is the card's heading, flush with the top border; there is no
// extra padding or gap between the pill and the body.
const PILL_H = 24; // h-6
const CARD_BORDER_V = 3; // border-[1.5px] top + bottom
const HEADING_ONLY_H = CARD_BORDER_V + PILL_H; // 27
// Distance from card top to heading-row vertical center; used to anchor
// edges and chips at heading center regardless of body height.
const HEADING_CENTER_OFFSET = CARD_BORDER_V / 2 + PILL_H / 2;

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

// Action chip geometry — chips on cross-column edges all share one X axis
// (column boundary) and stack vertically with at least CHIP_PITCH between
// adjacent chip centers, so they never overlap.
const CHIP_H = 20;
const CHIP_GAP = 4;
const CHIP_PITCH = CHIP_H + CHIP_GAP;

// Impact-overlay badge geometry — badges stack below the chip when the
// overlay is on. The bucket collision pass grows the chip-to-chip pitch so
// badge stacks never spill onto an adjacent chip's path. Up to 4 badges
// wrap at 2 per row; 5+ wrap at 3 per row so very long impact lists don't
// grow into a super-tall column.
const BADGE_H = 16;
const BADGE_V_GAP = 2;
const CHIP_TO_BADGES_GAP = 3;

export function badgeColsFor(n: number): number {
  return n <= 4 ? 2 : 3;
}

/**
 * Vertical extent of a badge stack drawn BELOW the chip, in px. World status
 * and demerits share a top row; class and nation affinities wrap beneath at
 * badgeColsFor().
 */
function badgeStackExtent(impacts: ActiveImpact[]): number {
  if (impacts.length === 0) return 0;
  const worldCount = impacts.filter((i) => i.key.startsWith("world:")).length;
  const others = impacts.length - worldCount;
  const worldRow = worldCount > 0 ? 1 : 0;
  const otherRows = others === 0 ? 0 : Math.ceil(others / badgeColsFor(others));
  const rows = worldRow + otherRows;
  if (rows === 0) return 0;
  return CHIP_TO_BADGES_GAP + rows * BADGE_H + (rows - 1) * BADGE_V_GAP;
}

// Reports center in the left half of the day column, letter groups center
// in the right half.
function columnLayout(colBaseX: number): {
  reportX: number;
  groupX: number;
} {
  const half = COL_W / 2;
  const reportCenter = colBaseX + half / 2;
  const groupCenter = colBaseX + half + half / 2;
  return {
    reportX: reportCenter - PILL_W / 2,
    groupX: groupCenter - GROUP_W / 2,
  };
}

const nodeTypes = {
  columnBand: ColumnBandNode,
  dayHeader: DayHeaderNode,
  storylineRow: StorylineRowNode,
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
}: Props) {
  const { nodes, edges } = useMemo(() => {
    // -------------------------------------------------------------
    // Columns (days + unscheduled bucket)
    // -------------------------------------------------------------
    const columnIds: string[] = [...days.map((d) => d.id), "unscheduled"];
    const dayById = new Map(days.map((d) => [d.id, d]));
    const columnIndex = new Map<string, number>();
    columnIds.forEach((id, i) => columnIndex.set(id, i));
    function columnX(colId: string): number {
      return (columnIndex.get(colId) ?? columnIds.length - 1) * COL_W;
    }

    // -------------------------------------------------------------
    // Storyline → row
    // -------------------------------------------------------------
    const orderedStorylines = storylines.slice().sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const rowIndex = new Map<string, number>();
    orderedStorylines.forEach((s, i) => rowIndex.set(s.id, i));
    const storylineById = new Map(storylines.map((s) => [s.id, s]));

    // -------------------------------------------------------------
    // Group → variants
    // -------------------------------------------------------------
    type GroupInfo = {
      group: LetterGroup;
      storyline: Storyline;
      colId: string;
      variants: string[]; // variant keys (may include "")
      variantHeights: number[]; // per-variant card height (summary-dependent)
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
      if (variants.length === 0) variants.push(""); // empty group placeholder
      const variantHeights = variants.map((vk) => {
        const primary = primaryLetterByGroupVariant.get(`${g.id}:${vk}`);
        return cardHeight(primary?.summary);
      });
      const sumVariantH = variantHeights.reduce((a, b) => a + b, 0);
      const height =
        GROUP_PAD_TOP +
        sumVariantH +
        Math.max(0, variants.length - 1) * LETTER_GAP +
        GROUP_PAD_BOTTOM;
      const colId = g.delivery_day_id ?? "unscheduled";
      groupsById.set(g.id, {
        group: g,
        storyline,
        colId,
        variants,
        variantHeights,
        height,
      });
    }

    // -------------------------------------------------------------
    // Per-cell stacks
    // -------------------------------------------------------------
    type Cell = {
      colId: string;
      storylineId: string;
      groupIds: string[];
      segmentIds: string[];
      height: number; // content height (groups + segments + gaps)
    };
    const cellKey = (colId: string, storylineId: string) =>
      `${colId}:${storylineId}`;
    const cells = new Map<string, Cell>();

    function getCell(colId: string, storylineId: string): Cell {
      const k = cellKey(colId, storylineId);
      const existing = cells.get(k);
      if (existing) return existing;
      const cell: Cell = {
        colId,
        storylineId,
        groupIds: [],
        segmentIds: [],
        height: 0,
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
      const cell = getCell(info.colId, g.storyline_id);
      cell.groupIds.push(g.id);
    }

    // Segments into cells.
    const segmentById = new Map(segments.map((s) => [s.id, s]));
    for (const s of segments) {
      const colId = s.effective_day_id ?? "unscheduled";
      const cell = getCell(colId, s.storyline_id);
      cell.segmentIds.push(s.id);
    }

    // Cell height: reports stack in the left sub-column, groups stack in
    // the right sub-column. Cell height is the max of the two stacks.
    for (const cell of cells.values()) {
      let groupsH = 0;
      for (const gid of cell.groupIds) {
        const gi = groupsById.get(gid);
        if (!gi) continue;
        if (groupsH > 0) groupsH += CELL_GAP;
        groupsH += gi.height;
      }
      let reportsH = 0;
      cell.segmentIds.forEach((sid, i) => {
        const seg = segmentById.get(sid);
        if (!seg) return;
        if (i > 0) reportsH += CELL_GAP;
        reportsH += cardHeight(seg.summary);
      });
      cell.height = Math.max(groupsH, reportsH);
    }

    // -------------------------------------------------------------
    // Row heights (max cell content across that row)
    // -------------------------------------------------------------
    const rowContentHeights = new Map<string, number>();
    for (const s of orderedStorylines) rowContentHeights.set(s.id, 0);
    for (const cell of cells.values()) {
      const cur = rowContentHeights.get(cell.storylineId) ?? 0;
      if (cell.height > cur) rowContentHeights.set(cell.storylineId, cell.height);
    }
    const rowHeights = new Map<string, number>();
    for (const s of orderedStorylines) {
      const content = Math.max(
        rowContentHeights.get(s.id) ?? 0,
        MIN_ROW_CONTENT_H
      );
      rowHeights.set(s.id, content + ROW_TOP_PAD + ROW_BOTTOM_PAD);
    }
    const rowBaseY = new Map<string, number>();
    {
      let y = HEADER_H;
      for (const s of orderedStorylines) {
        rowBaseY.set(s.id, y);
        y += rowHeights.get(s.id) ?? 0;
      }
    }
    const gridHeight = (() => {
      let y = HEADER_H;
      for (const s of orderedStorylines) y += rowHeights.get(s.id) ?? 0;
      return y;
    })();

    // -------------------------------------------------------------
    // Build nodes — order matters: bands first, then headers/labels,
    // then groups (parents), then letters (children), then segments.
    // -------------------------------------------------------------
    const n: Node[] = [];

    // Column bands (alternating tint).
    columnIds.forEach((colId, i) => {
      n.push({
        id: `band:${colId}`,
        type: "columnBand",
        position: { x: columnX(colId), y: 0 },
        data: {
          width: COL_W,
          height: gridHeight,
          tinted: i % 2 === 1,
          isUnscheduled: colId === "unscheduled",
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -10,
      });
    });

    // Day headers.
    for (const colId of columnIds) {
      const day = colId === "unscheduled" ? null : dayById.get(colId);
      n.push({
        id: `head:${colId}`,
        type: "dayHeader",
        position: { x: columnX(colId) + 8, y: 4 },
        data: {
          width: COL_W - 16,
          height: HEADER_H - 12,
          identifier: day?.identifier ?? null,
          label: day?.name ?? null,
          isUnscheduled: colId === "unscheduled",
        },
        draggable: false,
        selectable: false,
        focusable: false,
      });
    }

    // Storyline row labels in the left gutter.
    for (const s of orderedStorylines) {
      n.push({
        id: `row:${s.id}`,
        type: "storylineRow",
        position: {
          x: -GUTTER_W,
          y: rowBaseY.get(s.id) ?? 0,
        },
        data: {
          width: GUTTER_W,
          height: rowHeights.get(s.id) ?? 0,
          storyline: s,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      });
    }

    // Absolute (x, y) positions keyed by node id, used later to anchor chips
    // and stub terminators. Stored as the node's TOP-LEFT corner.
    const letterAbsPos = new Map<string, { x: number; y: number }>();
    const segmentAbsPos = new Map<string, { x: number; y: number }>();

    // Groups + letters + segments per cell. Reports center in the left
    // half, letter-groups center in the right half.
    for (const s of orderedStorylines) {
      const rowY = (rowBaseY.get(s.id) ?? 0) + ROW_TOP_PAD;
      for (const colId of columnIds) {
        const cell = cells.get(cellKey(colId, s.id));
        if (!cell) continue;
        const colBaseX = columnX(colId);
        const { reportX, groupX } = columnLayout(colBaseX);

        // Groups stack on the right.
        let groupsY = rowY;
        for (const gid of cell.groupIds) {
          const gi = groupsById.get(gid);
          if (!gi) continue;
          const abbr = gi.storyline.abbreviation;
          const groupNodeId = `group:${gid}`;
          n.push({
            id: groupNodeId,
            type: "letterGroup",
            position: { x: groupX, y: groupsY },
            data: {
              width: GROUP_W,
              height: gi.height,
              abbr,
              sequence: gi.group.sequence,
              color: gi.storyline.color_hex,
              href: `/inspection/letters?group=${groupSlug(abbr, gi.group.sequence)}`,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            style: { width: GROUP_W, height: gi.height },
          });

          const onlyVariant = gi.variants.length === 1;
          // Center the card (pill + border, no internal padding) horizontally
          // inside the group outline. Card width = PILL_W + border.
          const cardW = PILL_W + CARD_BORDER_V;
          const letterLeftInsideGroup = (GROUP_W - cardW) / 2;
          let relY = GROUP_PAD_TOP;
          gi.variants.forEach((vk, i) => {
            const letterNodeId = `letter:${gid}:${vk}`;
            const contentId = letterDisplayId(
              abbr,
              gi.group.sequence,
              vk || null,
              onlyVariant
            );
            const relX = letterLeftInsideGroup;
            const primary = primaryLetterByGroupVariant.get(`${gid}:${vk}`);
            const summary = primary?.summary ?? null;
            const letterH = gi.variantHeights[i];
            letterAbsPos.set(letterNodeId, {
              x: groupX + relX,
              y: groupsY + relY,
            });
            n.push({
              id: letterNodeId,
              type: "letter",
              parentId: groupNodeId,
              extent: "parent",
              position: { x: relX, y: relY },
              data: {
                contentId,
                href: vk
                  ? `/inspection/letters?letter=${groupSlug(abbr, gi.group.sequence)}/${vk}`
                  : `/inspection/letters?group=${groupSlug(abbr, gi.group.sequence)}`,
                storyline: gi.storyline,
                summary,
                widthPx: PILL_W,
              },
              draggable: false,
              selectable: false,
              focusable: false,
            });
            relY += letterH + LETTER_GAP;
          });

          groupsY += gi.height + CELL_GAP;
        }

        // Reports stack on the left.
        let reportsY = rowY;
        for (const sid of cell.segmentIds) {
          const seg = segmentById.get(sid);
          if (!seg) continue;
          const storyline = storylineById.get(seg.storyline_id);
          if (!storyline) continue;
          const abbr = storyline.abbreviation;
          const segNodeId = `report:${sid}`;
          segmentAbsPos.set(segNodeId, { x: reportX, y: reportsY });
          n.push({
            id: segNodeId,
            type: "report",
            position: { x: reportX, y: reportsY },
            data: {
              reportId: seg.report_id,
              href: `/inspection/letters?report=${groupSlug(abbr, seg.group_sequence)}/${seg.variant}`,
              storyline,
              summary: seg.summary,
              widthPx: PILL_W,
            },
            draggable: false,
            selectable: false,
            focusable: false,
          });
          reportsY += cardHeight(seg.summary) + CELL_GAP;
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
    // chipX rule:
    //   letter source → next column boundary (colX + COL_W)
    //   report source → midpoint of the source's column (colX + COL_W/2)
    // chipY rule:
    //   preferred Y is centered on the source's mid-Y, with siblings spaced
    //   ±CHIP_PITCH apart. Then within each chipX bucket the chips are sorted
    //   by preferred Y and walked forward, pushing later chips down to keep
    //   ≥CHIP_PITCH between adjacent centers.
    function nodeColumnId(nodeId: string): string | null {
      if (nodeId.startsWith("letter:")) {
        const m = nodeId.match(/^letter:([^:]+):/);
        if (!m) return null;
        return groupsById.get(m[1])?.colId ?? null;
      }
      if (nodeId.startsWith("report:")) {
        const segId = nodeId.slice("report:".length);
        return segmentById.get(segId)?.effective_day_id ?? "unscheduled";
      }
      return null;
    }
    // Anchor chips / edge endpoints to the HEADING-row center of the card,
    // not the card's vertical middle, so chips sit next to the pill even when
    // the body box makes the card taller.
    function nodeCenterY(nodeId: string): number | null {
      if (nodeId.startsWith("letter:")) {
        const p = letterAbsPos.get(nodeId);
        return p ? p.y + HEADING_CENTER_OFFSET : null;
      }
      if (nodeId.startsWith("report:")) {
        const p = segmentAbsPos.get(nodeId);
        return p ? p.y + HEADING_CENTER_OFFSET : null;
      }
      return null;
    }

    type ChipPlacement = {
      candidate: Candidate;
      chipX: number;
      preferredY: number;
      chipY: number;
      impacts: ActiveImpact[];
      extentBelow: number;
    };
    const placements: ChipPlacement[] = [];

    const candidatesBySource = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const list = candidatesBySource.get(c.source) ?? [];
      list.push(c);
      candidatesBySource.set(c.source, list);
    }

    for (const [sourceId, list] of candidatesBySource) {
      const colId = nodeColumnId(sourceId);
      if (!colId) continue;
      const colBaseX = columnX(colId);
      const isLetterSource = sourceId.startsWith("letter:");
      const chipX = isLetterSource
        ? colBaseX + COL_W
        : colBaseX + COL_W / 2;
      const srcCenterY = nodeCenterY(sourceId);
      if (srcCenterY == null) continue;

      list.sort((a, b) => {
        const sa = a.action.sort_order ?? 0;
        const sb = b.action.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return a.id.localeCompare(b.id);
      });

      const N = list.length;
      list.forEach((c, i) => {
        const offset = (i - (N - 1) / 2) * CHIP_PITCH;
        const y = srcCenterY + offset;
        // Impact badges live only on chips leading OUT of a letter. The
        // follow-up chip from segment → next letter represents the same
        // action but should not duplicate its impact badges.
        const impacts = isLetterSource
          ? extractActiveImpacts(c.action, impactFilter, nations)
          : [];
        placements.push({
          candidate: c,
          chipX,
          preferredY: y,
          chipY: y,
          impacts,
          extentBelow: badgeStackExtent(impacts),
        });
      });
    }

    // Collision pass: per chipX bucket, push later chips down so that the
    // previous chip's full vertical footprint (chip + badge stack below it)
    // plus a gap fits before the next chip starts. With no impacts showing,
    // this reduces to enforcing CHIP_PITCH between adjacent chip centers.
    const placementsByX = new Map<number, ChipPlacement[]>();
    for (const p of placements) {
      const list = placementsByX.get(p.chipX) ?? [];
      list.push(p);
      placementsByX.set(p.chipX, list);
    }
    for (const list of placementsByX.values()) {
      list.sort((a, b) => a.preferredY - b.preferredY);
      let prevBottom = -Infinity;
      for (const p of list) {
        const minChipY = prevBottom + CHIP_GAP + CHIP_H / 2;
        p.chipY = Math.max(p.preferredY, minChipY);
        prevBottom = p.chipY + CHIP_H / 2 + p.extentBelow;
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
    const incomingByTarget = new Map<string, number>();
    for (const p of placements) {
      if (p.candidate.terminator !== "arrow") continue;
      incomingByTarget.set(
        p.candidate.target,
        (incomingByTarget.get(p.candidate.target) ?? 0) + 1
      );
    }

    for (const p of placements) {
      const c = p.candidate;
      const resolved = resolveAction(c.action);
      const color = resolved.color || "#ffffff";
      const converges = (incomingByTarget.get(c.target) ?? 0) > 1;
      const arrowColor = converges ? "#ffffff" : color;
      // Ending marker only on chips leading OUT of a letter (same rule as
      // impact badges) so the segment → next-letter follow-up doesn't
      // duplicate the indicator.
      const isLetterSource = c.source.startsWith("letter:");
      const hasEnding =
        impactFilter.showEndings &&
        isLetterSource &&
        endingActionIds.has(c.action.id);
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
          hasEnding,
        },
        markerEnd:
          c.terminator === "arrow"
            ? { type: MarkerType.ArrowClosed, color: arrowColor }
            : undefined,
      });
    }

    return { nodes: n, edges: e };
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
  ]);

  return (
    <div className="h-[75vh] rounded-md border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
