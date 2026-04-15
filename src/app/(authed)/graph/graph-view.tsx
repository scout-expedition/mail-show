"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  ReactFlow,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo } from "react";
import type {
  ActionRow,
  InspectionLetterView,
  LetterGroup,
  Storyline,
} from "@/lib/db/types";

type Props = {
  storylines: Storyline[];
  letterGroups: LetterGroup[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  activeLetterId?: string | null;
};

/** Node position: column = storyline sort_order, row = group.sequence */
function nodeId(groupId: string) {
  return `g:${groupId}`;
}

export function GraphView({
  storylines,
  letterGroups,
  letters,
  actions,
  activeLetterId,
}: Props) {
  const { nodes, edges } = useMemo(() => {
    const storylineIdx = new Map(storylines.map((s, i) => [s.id, i]));
    const colWidth = 280;
    const rowHeight = 120;

    const n: Node[] = letterGroups.map((g) => {
      const storyline = storylines.find((s) => s.id === g.storyline_id);
      const col = storylineIdx.get(g.storyline_id) ?? 0;
      const row = g.sequence - 1;
      const groupLetters = letters.filter((l) => l.letter_group_id === g.id);
      return {
        id: nodeId(g.id),
        position: { x: col * colWidth, y: row * rowHeight },
        data: {
          label: (
            <div className="flex flex-col gap-1 text-left">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: storyline?.color_hex ?? "#888" }}
                />
                {storyline?.abbreviation}
                {g.sequence}
              </div>
              <div className="text-sm font-semibold">{g.name}</div>
              <div className="text-xs text-muted-foreground">
                {groupLetters.length} letter
                {groupLetters.length === 1 ? "" : "s"}
              </div>
            </div>
          ),
        },
        style: {
          padding: 10,
          borderRadius: 8,
          background: "var(--card)",
          color: "var(--card-foreground)",
          border: `1px solid ${
            groupLetters.some((l) => l.id === activeLetterId)
              ? "var(--primary)"
              : "var(--border)"
          }`,
          width: 240,
        },
      };
    });

    const groupBySeq = new Map<string, Map<number, LetterGroup>>();
    for (const g of letterGroups) {
      const m = groupBySeq.get(g.storyline_id) ?? new Map<number, LetterGroup>();
      m.set(g.sequence, g);
      groupBySeq.set(g.storyline_id, m);
    }

    const e: Edge[] = [];
    for (const a of actions) {
      const fromLetter = letters.find((l) => l.id === a.inspection_letter_id);
      if (!fromLetter) continue;
      // The "next" group is the next-sequence group in the same storyline.
      const groupsInStoryline = groupBySeq.get(fromLetter.storyline_id);
      if (!groupsInStoryline) continue;
      const fromGroup = groupsInStoryline.get(fromLetter.group_sequence);
      const nextGroup = groupsInStoryline.get(fromLetter.group_sequence + 1);
      if (!fromGroup || !nextGroup) continue;
      e.push({
        id: `a:${a.id}`,
        source: nodeId(fromGroup.id),
        target: nodeId(nextGroup.id),
        label: `${a.name}${a.next_letter_variant ? ` → ${a.next_letter_variant}` : ""}`,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
        style: { stroke: a.color_hex },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: a.color_hex,
        },
      });
    }
    return { nodes: n, edges: e };
  }, [storylines, letterGroups, letters, actions, activeLetterId]);

  return (
    <div className="h-[70vh] rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
