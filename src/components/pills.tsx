import { Mail, MailOpen, Megaphone } from "lucide-react";
import { IconDisplay } from "@/components/icon-display";
import { cn } from "@/lib/utils";
import type { Storyline } from "@/lib/db/types";

/** Compute a readable foreground (#000 or #fff) for a given hex background. */
export function readableOnHex(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/**
 * Filled icon square on the left overlapping a bordered pill on the right.
 * Used in breadcrumbs and lists to identify a storyline.
 */
export function StorylinePill({
  storyline,
  className,
}: {
  storyline: Pick<
    Storyline,
    "name" | "abbreviation" | "color_hex" | "icon_type" | "icon_value"
  >;
  className?: string;
}) {
  const color = storyline.color_hex;
  const fg = readableOnHex(color);
  return (
    <span
      className={cn("relative inline-flex h-6 items-center", className)}
    >
      <span
        className="inline-flex h-6 min-w-0 items-center rounded-md border-[1.5px] bg-card pl-7 pr-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white"
        style={{ borderColor: color }}
      >
        <span className="truncate">{storyline.name}</span>
      </span>
      <span
        aria-hidden
        className="absolute left-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md"
        style={{ background: color, color: fg }}
      >
        {storyline.icon_value ? (
          <IconDisplay
            type={storyline.icon_type}
            value={storyline.icon_value}
            size={12}
          />
        ) : (
          <span className="font-mono text-[10px] font-semibold">
            {storyline.abbreviation}
          </span>
        )}
      </span>
    </span>
  );
}

/** [icon][content_id] pill filled with the storyline color. */
export function InspectionLetterPill({
  storyline,
  contentId,
  className,
  closed,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  contentId: string;
  className?: string;
  closed?: boolean;
}) {
  const color = storyline?.color_hex ?? "#888888";
  const Icon = closed ? Mail : MailOpen;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{ background: color }}
    >
      <Icon size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">{contentId}</span>
    </span>
  );
}

/**
 * [megaphone][report_id] pill with a muted (40% storyline + 60% card) fill.
 * Reads as a softer, recessive cousin of the InspectionLetterPill.
 */
export function ReportSegmentPill({
  storyline,
  reportId,
  className,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  reportId: string;
  className?: string;
}) {
  const color = storyline?.color_hex ?? "#888888";
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 40%, var(--card))`,
      }}
    >
      <Megaphone size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">{reportId}</span>
    </span>
  );
}
