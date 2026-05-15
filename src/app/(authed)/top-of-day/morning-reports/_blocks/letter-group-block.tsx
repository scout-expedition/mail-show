"use client";

// A letter-group block — auto-derived, one per letter group that has at
// least one report segment landing on the selected day. It nests the
// storyline report blocks for that group. The block can be reordered in
// the day's shared order, but never created or deleted by the user; its
// nested report blocks can't be reordered or removed from the group.

import { BlockFrame, HeaderInput, type DragApi } from "./block-shell";
import { ReportBlock, type Trigger } from "./report-block";
import { LetterGroupPill } from "@/components/pills";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { patchLetterGroup } from "@/app/(authed)/inspection/letters/actions";
import { resolveCollapsed, useMorningCollapse } from "../_lib/collapse";
import type { LetterGroup, ReportSegmentView, Storyline } from "@/lib/db/types";

export function LetterGroupBlock({
  dragId,
  drag,
  letterGroup,
  storyline,
  segments,
  triggersBySegment,
}: {
  dragId: string;
  drag: DragApi;
  letterGroup: LetterGroup;
  storyline: Storyline | undefined;
  segments: ReportSegmentView[];
  triggersBySegment: Map<string, Trigger[]>;
}) {
  const collapse = useMorningCollapse();
  const collapseKey = `lg:${letterGroup.id}`;
  const collapsed = resolveCollapsed("letter_group", collapseKey, collapse);

  const name = useInstantField<string>({
    value: letterGroup.name ?? "",
    onCommit: (v) => patchLetterGroup(letterGroup.id, { name: v }),
  });

  return (
    <BlockFrame
      dragId={dragId}
      drag={drag}
      collapsed={collapsed}
      onToggleCollapse={() => collapse.setOverride(collapseKey, !collapsed)}
      leading={
        <LetterGroupPill storyline={storyline} sequence={letterGroup.sequence} />
      }
      headerExtra={
        <HeaderInput
          value={name.value}
          placeholder="Letter group name…"
          aria-label="Letter group name"
          onChange={(e) => name.set(e.target.value)}
          onFocus={name.onFocus}
          onBlur={name.onBlur}
        />
      }
    >
      {segments.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/60">
          No report segments land on this day.
        </p>
      ) : (
        // Nested report blocks sit in a black well, like an endings
        // condition block's rows.
        <div className="flex flex-col gap-2.5 rounded-md bg-[var(--block-result-bg)] p-2">
          {segments.map((seg) => (
            <ReportBlock
              key={seg.id}
              segment={seg}
              storyline={storyline}
              triggers={triggersBySegment.get(seg.id) ?? []}
            />
          ))}
        </div>
      )}
    </BlockFrame>
  );
}
