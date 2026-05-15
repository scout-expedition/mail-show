"use client";

// A generic report block — a free-standing report attached to the day
// rather than a storyline. Display id R-D{n}/{variant}. User-creatable,
// deletable, and reorderable; it has no Trigger section.

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { OverflowMenu } from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import {
  BLOCK_TEXTAREA_CLASS,
  BlockFrame,
  HeaderInput,
  type DragApi,
} from "./block-shell";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { ReportSegmentPill } from "@/components/pills";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { formatDayReportId } from "@/lib/ids";
import { resolveCollapsed, useMorningCollapse } from "../_lib/collapse";
import {
  deleteGenericReportBlock,
  patchGenericReportBlock,
} from "../actions";
import type { DayReportBlockView } from "@/lib/db/types";

export function GenericReportBlock({
  dragId,
  drag,
  block,
  dayNumber,
}: {
  dragId: string;
  drag: DragApi;
  block: DayReportBlockView;
  dayNumber: number;
}) {
  const collapse = useMorningCollapse();
  const collapsed = resolveCollapsed("generic", block.id, collapse);
  const { confirm, dialog } = useConfirm();
  const [, startTransition] = useTransition();

  const summary = useInstantField<string>({
    value: block.summary ?? "",
    onCommit: (v) =>
      patchGenericReportBlock(block.id, {
        summary: v.trim() === "" ? null : v,
      }),
  });
  const content = useInstantField<string>({
    value: block.content ?? "",
    onCommit: (v) =>
      patchGenericReportBlock(block.id, {
        content: v.trim() === "" ? null : v,
      }),
  });

  const reportId =
    block.report_id ??
    formatDayReportId({ dayNumber, variant: block.variant ?? "" });

  return (
    <>
      <BlockFrame
        dragId={dragId}
        drag={drag}
        collapsed={collapsed}
        onToggleCollapse={() => collapse.setOverride(block.id, !collapsed)}
        leading={<ReportSegmentPill storyline={undefined} reportId={reportId} />}
        headerExtra={
          <HeaderInput
            value={summary.value}
            placeholder="Summary…"
            aria-label="Report summary"
            onChange={(e) => summary.set(e.target.value)}
            onFocus={summary.onFocus}
            onBlur={summary.onBlur}
          />
        }
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete report segment",
                intent: "destructive",
                icon: <Trash2 size={10} aria-hidden />,
                onClick: async () => {
                  const ok = await confirm({
                    title: "Delete report segment?",
                    message: `${reportId} will be removed from this day.`,
                    confirmLabel: "Delete",
                    intent: "destructive",
                  });
                  if (!ok) return;
                  startTransition(() => {
                    const fd = new FormData();
                    fd.set("id", block.id);
                    void deleteGenericReportBlock(fd);
                  });
                },
              },
            ]}
          />
        }
      >
        <div onFocus={content.onFocus} onBlur={content.onBlur}>
          <MarkdownTextarea
            value={content.value}
            onChange={(e) => content.set(e.target.value)}
            minRows={2}
            className={`font-mono ${BLOCK_TEXTAREA_CLASS}`}
          />
        </div>
      </BlockFrame>
      {dialog}
    </>
  );
}
