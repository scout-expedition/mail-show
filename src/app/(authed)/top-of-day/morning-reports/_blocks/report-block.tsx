"use client";

// A Story Report Segment — one report_segments row that lands on the
// selected day. Nested inside a letter-group block; cannot be reordered or
// removed here. Editable: summary + content. Read-only: the report id and
// the Trigger list (the Letter+Action pairs that deliver this report).

import Link from "next/link";
import {
  BLOCK_TEXTAREA_CLASS,
  BlockFrame,
  BlockSectionLabel,
  HeaderInput,
} from "./block-shell";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import {
  ActionPill,
  InspectionLetterPill,
  readableOnHex,
  ReportSegmentPill,
} from "@/components/pills";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { patchReportSegment } from "@/app/(authed)/inspection/letters/actions";
import { resolveCollapsed, useMorningCollapse } from "../_lib/collapse";
import type { ReportSegmentView, Storyline } from "@/lib/db/types";
import type { IconType } from "@/lib/db/enums";

/** A resolved Letter+Action pair that triggers a report segment. */
export type Trigger = {
  actionId: string;
  actionName: string;
  actionIconType: IconType | null;
  actionIconValue: string | null;
  actionColorHex: string;
  letterContentId: string;
  letterStoryline: Pick<Storyline, "color_hex"> | undefined;
  /** Deep link to the triggering letter in the Inspection › Letters page. */
  letterHref: string;
  letterSummary: string | null;
};

export function ReportBlock({
  segment,
  storyline,
  triggers,
}: {
  segment: ReportSegmentView;
  storyline: Pick<Storyline, "color_hex"> | undefined;
  triggers: Trigger[];
}) {
  const collapse = useMorningCollapse();
  const collapsed = resolveCollapsed("report", segment.id, collapse);
  const { peers, setFocus } = usePresenceContext();

  const summary = useInstantField<string>({
    value: segment.summary ?? "",
    onCommit: (v) =>
      patchReportSegment(segment.id, {
        summary: v.trim() === "" ? null : v,
      }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "report_segments", recordId: segment.id, field: "summary" }
          : null
      ),
  });
  const content = useInstantField<string>({
    value: segment.content ?? "",
    onCommit: (v) =>
      patchReportSegment(segment.id, {
        content: v.trim() === "" ? null : v,
      }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "report_segments", recordId: segment.id, field: "content" }
          : null
      ),
  });

  return (
    <BlockFrame
      collapsed={collapsed}
      onToggleCollapse={() => collapse.setOverride(segment.id, !collapsed)}
      leading={
        <ReportSegmentPill storyline={storyline} reportId={segment.report_id} />
      }
      headerExtra={
        <FieldHighlight
          peers={peers}
          focusKey={{
            table: "report_segments",
            recordId: segment.id,
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
    >
      <FieldHighlight
        peers={peers}
        focusKey={{
          table: "report_segments",
          recordId: segment.id,
          field: "content",
        }}
      >
        <div onFocus={content.onFocus} onBlur={content.onBlur}>
          <MarkdownTextarea
            value={content.value}
            onChange={(e) => content.set(e.target.value)}
            minRows={2}
            className={`font-mono ${BLOCK_TEXTAREA_CLASS}`}
          />
        </div>
      </FieldHighlight>
      <BlockSectionLabel>
        {triggers.length > 0 ? `Triggers (${triggers.length})` : "Trigger"}
      </BlockSectionLabel>
      {triggers.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/60">
          No actions deliver this report yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {triggers.map((t) => (
            <Link
              key={t.actionId}
              href={t.letterHref}
              title={`Open ${t.letterContentId} in Inspection › Letters`}
              style={
                {
                  "--trig-l": t.letterStoryline?.color_hex ?? "#888888",
                  "--trig-a": t.actionColorHex,
                  "--trig-a-fg": readableOnHex(t.actionColorHex),
                } as React.CSSProperties
              }
              className="group/trig flex min-w-0 items-center gap-1.5"
            >
              {/* Pills are background-less + muted until the row is hovered. */}
              <span className="inline-flex shrink-0 items-center">
                <InspectionLetterPill
                  storyline={t.letterStoryline}
                  contentId={t.letterContentId}
                  className="rounded-r-none !bg-transparent !text-muted-foreground transition-colors group-hover/trig:!bg-[var(--trig-l)] group-hover/trig:!text-white"
                />
                <ActionPill
                  name={t.actionName}
                  iconType={t.actionIconType ?? "lucide"}
                  iconValue={t.actionIconValue}
                  colorHex={t.actionColorHex}
                  iconOnly
                  className="rounded-l-none !bg-transparent !text-muted-foreground transition-colors group-hover/trig:!bg-[var(--trig-a)] group-hover/trig:!text-[var(--trig-a-fg)]"
                />
              </span>
              {t.letterSummary ? (
                <span className="truncate text-[10px] text-muted-foreground/40 transition-colors group-hover/trig:text-muted-foreground">
                  {t.letterSummary}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </BlockFrame>
  );
}
