"use client";

// A generic report block — a free-standing report attached to the day
// rather than a storyline. Display id R-D{n}/{variant}. User-creatable,
// deletable, and reorderable; it has no Trigger section.

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { OverflowMenu } from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import {
  BlockFrame,
  HeaderInput,
  type DragApi,
} from "./block-shell";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import { ReportSegmentPill } from "@/components/pills";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
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
  const { peers, setFocus } = usePresenceContext();

  const summary = useInstantField<string>({
    value: block.summary ?? "",
    onCommit: (v) =>
      patchGenericReportBlock(block.id, {
        summary: v.trim() === "" ? null : v,
      }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "day_report_blocks", recordId: block.id, field: "summary" }
          : null
      ),
  });
  const content = useInstantField<string>({
    value: block.content ?? "",
    onCommit: (v) =>
      patchGenericReportBlock(block.id, {
        content: v.trim() === "" ? null : v,
      }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "day_report_blocks", recordId: block.id, field: "content" }
          : null
      ),
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
          <FieldHighlight
            peers={peers}
            focusKey={{
              table: "day_report_blocks",
              recordId: block.id,
              field: "summary",
            }}
          >
            <HeaderInput
              value={summary.value}
              placeholder="Summary…"
              aria-label="Report summary"
              onChange={(e) => summary.set(e.target.value)}
              onFocus={summary.onFocus}
              onBlur={summary.onBlur}
            />
          </FieldHighlight>
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
        <FieldHighlight
          peers={peers}
          focusKey={{
            table: "day_report_blocks",
            recordId: block.id,
            field: "content",
          }}
        >
          <RichTextEditor
            value={content.value}
            onChange={(next) => content.set(next)}
            onFocus={content.onFocus}
            onBlur={content.onBlur}
            minRows={2}
            className={cn("font-mono text-xs", GHOST_FIELD)}
          />
        </FieldHighlight>
      </BlockFrame>
      {dialog}
    </>
  );
}
