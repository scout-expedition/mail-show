"use client";

// The pinned intro / sign-off blocks. They edit days.base_report /
// days.report_sign_off, carry a fixed report id (R-D{n}/a and R-D{n}/z so
// they bracket the roman-numeral generic blocks), sit at the top and
// bottom of the working area, and cannot be dragged or deleted.

import { Lock } from "lucide-react";
import { BlockFrame, HeaderTitle } from "./block-shell";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import { ReportSegmentPill } from "@/components/pills";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { formatDayReportId } from "@/lib/ids";
import {
  resolveCollapsed,
  useMorningCollapse,
} from "../_lib/collapse";
import { patchDayReportField } from "../actions";

export function PinnedBlock({
  dayId,
  dayNumber,
  field,
  value,
  label,
}: {
  dayId: string;
  dayNumber: number;
  field: "base_report" | "report_sign_off";
  value: string | null;
  label: string;
}) {
  const collapse = useMorningCollapse();
  const collapsed = resolveCollapsed("pinned", field, collapse);
  const { peers, setFocus } = usePresenceContext();

  const text = useInstantField<string>({
    value: value ?? "",
    onCommit: (v) => {
      const next = v.trim() === "" ? null : v;
      return patchDayReportField(
        dayId,
        field === "base_report"
          ? { base_report: next }
          : { report_sign_off: next }
      );
    },
    onFocusChange: (focused) =>
      setFocus(focused ? { table: "days", recordId: dayId, field } : null),
  });

  const reportId = formatDayReportId({
    dayNumber,
    variant: field === "base_report" ? "a" : "z",
  });

  return (
    <BlockFrame
      collapsed={collapsed}
      onToggleCollapse={() => collapse.setOverride(field, !collapsed)}
      leading={<ReportSegmentPill storyline={undefined} reportId={reportId} />}
      headerExtra={<HeaderTitle>{label}</HeaderTitle>}
      menu={
        <span
          title="Fixed segment — id and position can't be changed"
          className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/40"
        >
          <Lock size={12} aria-hidden />
        </span>
      }
    >
      <FieldHighlight
        peers={peers}
        focusKey={{ table: "days", recordId: dayId, field }}
      >
        <RichTextEditor
          value={text.value}
          onChange={(next) => text.set(next)}
          onFocus={text.onFocus}
          onBlur={text.onBlur}
          minRows={2}
          className={cn("font-mono text-xs", GHOST_FIELD)}
        />
      </FieldHighlight>
    </BlockFrame>
  );
}
