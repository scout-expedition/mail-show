import { Mail, MailOpen, Mails, Megaphone } from "lucide-react";
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

/**
 * Composes an inline `box-shadow` describing concentric selection rings:
 *   • self ring (when `selected`): 1px background gap + 2px ring in
 *     `selfRingColor` (defaults to `var(--ring)` to preserve callers that
 *     don't customize the color).
 *   • peer rings: 2px rings in each peer's avatar color, stacked outward.
 *
 * Returns `undefined` when no rings are needed so the wrapper inherits
 * whatever shadow other classes set (typically none).
 */
function composeSelectionShadow(opts: {
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
}): string | undefined {
  const parts: string[] = [];
  if (opts.selected) {
    // ring-offset-1 (1px background-colored gap) + ring-2 (2px ring at 1–3px).
    parts.push(`0 0 0 1px var(--background)`);
    parts.push(`0 0 0 3px ${opts.selfRingColor ?? "var(--ring)"}`);
  }
  if (opts.peerRingColors?.length) {
    const baseRadius = opts.selected ? 3 : 0;
    opts.peerRingColors.forEach((c, i) => {
      parts.push(`0 0 0 ${baseRadius + (i + 1) * 2}px ${c}`);
    });
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** [Mails][abbr+sequence] pill with a storyline-color border on a card fill. */
export function LetterGroupPill({
  storyline,
  sequence,
  className,
  style,
  selected,
  selfRingColor,
  peerRingColors,
}: {
  storyline: Pick<Storyline, "abbreviation" | "color_hex"> | undefined;
  sequence: number;
  className?: string;
  style?: React.CSSProperties;
  selected?: boolean;
  /** Override the default `var(--ring)` color for the self-selection ring. */
  selfRingColor?: string;
  /** Stacked outer rings, one per peer co-selecting this pill. */
  peerRingColors?: string[];
}) {
  const abbr = storyline?.abbreviation ?? "?";
  const color = storyline?.color_hex ?? "#888888";
  const boxShadow = composeSelectionShadow({
    selected,
    selfRingColor,
    peerRingColors,
  });
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border-[1.5px] bg-card px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{ borderColor: color, boxShadow, ...style }}
    >
      <Mails size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">
        {abbr}
        {sequence}
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
  style,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  contentId: string;
  className?: string;
  closed?: boolean;
  style?: React.CSSProperties;
}) {
  const color = storyline?.color_hex ?? "#888888";
  const Icon = closed ? Mail : MailOpen;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 font-mono text-[11px] font-normal normal-case leading-none tracking-normal text-white",
        className
      )}
      style={{ background: color, ...style }}
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
  style,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  reportId: string;
  className?: string;
  style?: React.CSSProperties;
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
        ...style,
      }}
    >
      <Megaphone size={11} aria-hidden className="shrink-0" />
      <span className="whitespace-nowrap">{reportId}</span>
    </span>
  );
}

/**
 * Card layout: storyline-bordered wrapper with the existing pill as a heading
 * row and a body box of summary text underneath. Empty summary collapses the
 * body. Used in the narrative graph; matches the design where each node grows
 * to fit a short summary.
 */
// The pill acts as the card's heading, flush with the top edge. Only the
// border inflates the outer width beyond PILL_W.
export const PILL_CARD_BORDER = 3;
export const PILL_CARD_EXTRA = PILL_CARD_BORDER;
// Pill (heading) height inside the card.
export const PILL_H_PX = 24;
// Distance from card top to the heading-row vertical center. Used by graph
// nodes to pin xyflow handles at the pill row regardless of body height.
export const HEADING_CENTER_OFFSET_PX = PILL_CARD_BORDER / 2 + PILL_H_PX / 2;

function PillCard({
  borderColor,
  children,
  summary,
  widthPx,
  className,
  selected,
  selfRingColor,
  peerRingColors,
}: {
  borderColor: string;
  children: React.ReactNode;
  summary: string | null | undefined;
  widthPx?: number;
  className?: string;
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
}) {
  const trimmed = summary?.trim();
  const boxShadow = composeSelectionShadow({
    selected,
    selfRingColor,
    peerRingColors,
  });
  return (
    <div
      className={cn("flex flex-col overflow-hidden rounded-md border-[1.5px]", className)}
      style={{
        borderColor,
        // Match the card fill to the border color so any subpixel sliver
        // between the 1.5px border and the heading pill renders as the
        // same color instead of letting bg-card peek through at zoom.
        backgroundColor: borderColor,
        width: widthPx ? widthPx + PILL_CARD_EXTRA : undefined,
        boxShadow,
      }}
    >
      {children}
      {trimmed ? (
        <div
          className="bg-card px-1.5 py-1 text-xs leading-snug text-white/70"
          style={{ wordBreak: "break-word" }}
        >
          {trimmed}
        </div>
      ) : null}
    </div>
  );
}

/** Letter pill rendered as the card heading, flush with the top border. */
export function InspectionLetterCard({
  storyline,
  contentId,
  summary,
  widthPx,
  className,
  selected,
  selfRingColor,
  peerRingColors,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  contentId: string;
  summary: string | null | undefined;
  widthPx?: number;
  className?: string;
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
}) {
  const color = storyline?.color_hex ?? "#888888";
  return (
    <PillCard
      borderColor={color}
      summary={summary}
      widthPx={widthPx}
      className={className}
      selected={selected}
      selfRingColor={selfRingColor}
      peerRingColors={peerRingColors}
    >
      <InspectionLetterPill
        storyline={storyline}
        contentId={contentId}
        className={cn(
          "!rounded-none",
          widthPx ? "justify-start" : undefined
        )}
        style={widthPx ? { width: widthPx } : undefined}
      />
    </PillCard>
  );
}

/** Report pill rendered as the card heading. Border matches the pill tint. */
export function ReportSegmentCard({
  storyline,
  reportId,
  summary,
  widthPx,
  className,
  selected,
  selfRingColor,
  peerRingColors,
}: {
  storyline: Pick<Storyline, "color_hex"> | undefined;
  reportId: string;
  summary: string | null | undefined;
  widthPx?: number;
  className?: string;
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
}) {
  const color = storyline?.color_hex ?? "#888888";
  // The report pill is a 40% mix of storyline + card; the card border matches
  // it so the heading flows seamlessly into the box outline.
  const borderColor = `color-mix(in srgb, ${color} 40%, var(--card))`;
  return (
    <PillCard
      borderColor={borderColor}
      summary={summary}
      widthPx={widthPx}
      className={className}
      selected={selected}
      selfRingColor={selfRingColor}
      peerRingColors={peerRingColors}
    >
      <ReportSegmentPill
        storyline={storyline}
        reportId={reportId}
        className={cn(
          "!rounded-none",
          widthPx ? "justify-start" : undefined
        )}
        style={widthPx ? { width: widthPx } : undefined}
      />
    </PillCard>
  );
}
