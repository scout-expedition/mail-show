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
  Day,
  InspectionLetterView,
  LetterGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { groupSlug } from "@/lib/letter-groups";
import ColumnBandNode from "./nodes/column-band";
import DayHeaderNode from "./nodes/day-header";
import LetterGroupNode from "./nodes/letter-group";
import LetterNode from "./nodes/letter-node";
import ReportNode from "./nodes/report-node";
import StorylineRowNode from "./nodes/storyline-row";

type Props = {
  storylines: Storyline[];
  letterGroups: LetterGroup[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  days: Day[];
  segments: ReportSegmentView[];
};

// ------------------------------------------------------------------
// Layout constants
// ------------------------------------------------------------------
const COL_W = 220;
const GUTTER_W = 160;
const HEADER_H = 52;
const CELL_GAP = 12;
const ROW_TOP_PAD = 10;
const ROW_BOTTOM_PAD = 10;
const MIN_ROW_CONTENT_H = 40;

const GROUP_PAD_TOP = 18;
const GROUP_PAD_SIDE = 6;
const GROUP_PAD_BOTTOM = 8;
const GROUP_INNER_W = COL_W - 2 * 12; // visual padding within the column
const LETTER_H = 28;
const LETTER_GAP = 4;

const SEGMENT_H = 28;

const nodeTypes = {
  columnBand: ColumnBandNode,
  dayHeader: DayHeaderNode,
  storylineRow: StorylineRowNode,
  letterGroup: LetterGroupNode,
  letter: LetterNode,
  report: ReportNode,
};

// Variant key for a letter row. Null variants collapse to "".
function variantKey(v: string | null): string {
  return v ?? "";
}

function letterDisplayId(
  abbr: string,
  sequence: number,
  variant: string | null
): string {
  return variant ? `L-${abbr}${sequence}/${variant}` : `L-${abbr}${sequence}`;
}

export function GraphView({
  storylines,
  letterGroups,
  letters,
  actions,
  days,
  segments,
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
      height: number; // group outline height
    };

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
      const height =
        GROUP_PAD_TOP +
        variants.length * LETTER_H +
        Math.max(0, variants.length - 1) * LETTER_GAP +
        GROUP_PAD_BOTTOM;
      const colId = g.delivery_day_id ?? "unscheduled";
      groupsById.set(g.id, {
        group: g,
        storyline,
        colId,
        variants,
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

    // Compute cell height.
    for (const cell of cells.values()) {
      let h = 0;
      for (const gid of cell.groupIds) {
        const gi = groupsById.get(gid);
        if (!gi) continue;
        if (h > 0) h += CELL_GAP;
        h += gi.height;
      }
      for (let i = 0; i < cell.segmentIds.length; i++) {
        if (h > 0) h += CELL_GAP;
        h += SEGMENT_H;
      }
      cell.height = h;
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

    // Groups + letters + segments per cell.
    for (const s of orderedStorylines) {
      const rowY = (rowBaseY.get(s.id) ?? 0) + ROW_TOP_PAD;
      for (const colId of columnIds) {
        const cell = cells.get(cellKey(colId, s.id));
        if (!cell) continue;
        let cursorY = rowY;
        const baseX = columnX(colId) + (COL_W - GROUP_INNER_W) / 2;

        for (const gid of cell.groupIds) {
          const gi = groupsById.get(gid);
          if (!gi) continue;
          const groupX = baseX;
          const groupY = cursorY;
          const abbr = gi.storyline.abbreviation;
          const groupLabel = `L-${abbr}${gi.group.sequence} ${gi.group.name}`;
          const groupNodeId = `group:${gid}`;
          n.push({
            id: groupNodeId,
            type: "letterGroup",
            position: { x: groupX, y: groupY },
            data: {
              width: GROUP_INNER_W,
              height: gi.height,
              label: groupLabel,
              color: gi.storyline.color_hex,
              href: `/inspection/letters?group=${groupSlug(abbr, gi.group.sequence)}`,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            style: { width: GROUP_INNER_W, height: gi.height },
          });

          // Child letter nodes (parentId relationship). Positions relative
          // to the group node's origin.
          gi.variants.forEach((vk, i) => {
            const letterNodeId = `letter:${gid}:${vk}`;
            const contentId = letterDisplayId(abbr, gi.group.sequence, vk || null);
            n.push({
              id: letterNodeId,
              type: "letter",
              parentId: groupNodeId,
              extent: "parent",
              position: {
                x: GROUP_PAD_SIDE + 4,
                y: GROUP_PAD_TOP + i * (LETTER_H + LETTER_GAP),
              },
              data: {
                contentId,
                href: vk
                  ? `/inspection/letters?letter=${groupSlug(abbr, gi.group.sequence)}/${vk}`
                  : `/inspection/letters?group=${groupSlug(abbr, gi.group.sequence)}`,
                storyline: gi.storyline,
              },
              draggable: false,
              selectable: false,
              focusable: false,
            });
          });

          cursorY += gi.height + CELL_GAP;
        }

        for (const sid of cell.segmentIds) {
          const seg = segmentById.get(sid);
          if (!seg) continue;
          const storyline = storylineById.get(seg.storyline_id);
          if (!storyline) continue;
          const abbr = storyline.abbreviation;
          n.push({
            id: `report:${sid}`,
            type: "report",
            position: { x: baseX + GROUP_PAD_SIDE + 4, y: cursorY },
            data: {
              reportId: seg.report_id,
              href: `/inspection/letters?report=${groupSlug(abbr, seg.group_sequence)}/${seg.variant}`,
              storyline,
            },
            draggable: false,
            selectable: false,
            focusable: false,
          });
          cursorY += SEGMENT_H + CELL_GAP;
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

    for (const a of actions) {
      const src = letterIndex.get(a.inspection_letter_id);
      if (!src) continue;
      const sourceId = `letter:${src.groupId}:${src.variantKey}`;

      const segmentId = a.report_segment_id
        ? `report:${a.report_segment_id}`
        : null;
      // Only render the segment leg when the segment actually rendered.
      const segmentExists = segmentId
        ? n.some((node) => node.id === segmentId)
        : false;

      // Resolve "next letter" target.
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

      const color = a.color_hex;
      const common = {
        style: { stroke: color, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)" },
        labelBgPadding: [3, 2] as [number, number],
      };

      if (segmentExists && nextLetterId) {
        e.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentId!,
          label: a.name,
          ...common,
        });
        e.push({
          id: `a:${a.id}:sn`,
          source: segmentId!,
          target: nextLetterId,
          ...common,
        });
      } else if (segmentExists) {
        e.push({
          id: `a:${a.id}:ls`,
          source: sourceId,
          target: segmentId!,
          label: a.name,
          ...common,
        });
      } else if (nextLetterId) {
        e.push({
          id: `a:${a.id}:ln`,
          source: sourceId,
          target: nextLetterId,
          label: a.name,
          ...common,
        });
      }
    }

    return { nodes: n, edges: e };
  }, [storylines, letterGroups, letters, actions, days, segments]);

  return (
    <div className="h-[75vh] rounded-md border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
