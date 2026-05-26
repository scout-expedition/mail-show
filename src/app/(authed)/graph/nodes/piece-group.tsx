"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin } from "lucide-react";
import { InspectionLetterCard } from "@/components/pills";
import type { InspectionLetterView, Storyline } from "@/lib/db/types";

export type PieceGroupData = {
  /** The letter_group_id that owns this piece group (used for merge validation). */
  letterGroupId: string;
  /** The shared variant letter for all members (e.g. "a"). */
  variant: string;
  /** All members, sorted by sort_order ascending for display. */
  members: InspectionLetterView[];
  storyline: Pick<Storyline, "color_hex" | "id">;
  /** Pre-computed variant-only display ID, e.g. "L-W1/a". */
  contentId: string;
  /** True while this node is a pending ghost (server create in flight). */
  pendingAdd?: boolean;
  /** True while this node is being optimistically deleted. */
  pendingDelete?: boolean;
  /** True while being shown as a drag preview (semi-transparent). */
  dragGhost?: boolean;
  /** Filled pin — any member carries an absolute delivery override. */
  pinned?: boolean;
  /** Signed offset text (e.g. "+2") — members carry a relative override. */
  offsetText?: string | null;
  /** Selects the piece group for the inspector. Routed via the parent
   *  graph's `onNodeClick` (xyflow node-level `selectable` is off so the
   *  inspector selection is driven by callbacks, not RF selection state). */
  onSelect?: () => void;
  /** Selects a specific piece member when its nested pill is clicked.
   *  Falls back to onSelect (group-level) when omitted. */
  onSelectMember?: (memberId: string) => void;
  /** The piece member currently selected by the local user — drives the
   *  letter-card ring on just that piece's pill, not the whole group. */
  selectedPieceId?: string;
  /** Local user's avatar color, applied to the selectedPieceId pill's ring. */
  pieceSelfRingColor?: string;
  /** Peer rings keyed by piece member id; each pill in the group can show
   *  its own stack of peer-color rings if multiple peers are editing
   *  different pieces. */
  pieceRingColorsByMember?: Record<string, string[]>;
};

// Max pieces to show before collapsing the rest into a "+N" overflow
// chip. When a group has MORE than this, only `MAX_VISIBLE - 1` pills
// render plus the chip — so reserved layout width must match.
export const MAX_VISIBLE_PIECES = 4;
// Visible width of each per-piece pill — wider than the natural content
// width so multi-piece groups read clearly rather than as a tight strip.
export const PIECE_PILL_W = 86;
// Visible gap between adjacent piece pills. Note: this gap is split as
// half-gap padding on each piece's [data-piece-id] wrapper (see below),
// so the wrapper hit-areas tile with no dead zone in between.
export const PIECE_GAP = 10;
// Horizontal padding inside the muted backdrop (`px-1.5` = 6px). Exported
// so graph-view can derive per-piece anchor X coords that match the
// actual rendered pill centers (used for action-chip placement).
export const PIECE_ROW_PAD_X = 6;
// Approximate rendered width of the "+N" overflow chip (inline-flex with
// `text-[9px]` + `px-1`). A constant is good enough for layout reservation
// since the chip is small relative to a full pill — minor under/over-fit
// of a few px doesn't visibly crowd the next variant.
export const PIECE_OVERFLOW_CHIP_W = 24;

// Inline-style overrides that strip ReactFlow's default Handle CSS so the
// Handle becomes a transparent in-flow wrapper that sizes to its child.
const FULL_CARD_HANDLE_STYLE: React.CSSProperties = {
  position: "static",
  transform: "none",
  width: "auto",
  height: "auto",
  minWidth: 0,
  minHeight: 0,
  borderRadius: 0,
  background: "transparent",
  border: "none",
  cursor: "inherit",
};

function PieceGroupNode({ data }: NodeProps) {
  const d = data as unknown as PieceGroupData;
  const color = d.storyline.color_hex;

  // Show up to MAX_VISIBLE_PIECES members; collapse the rest to a "+N"
  // chip. Layout reservation in graph-view (`variantSlotWidth`) mirrors
  // this branching so the reserved column width matches what renders.
  const visibleMembers =
    d.members.length <= MAX_VISIBLE_PIECES
      ? d.members
      : d.members.slice(0, MAX_VISIBLE_PIECES - 1);
  const overflowCount =
    d.members.length <= MAX_VISIBLE_PIECES
      ? 0
      : d.members.length - (MAX_VISIBLE_PIECES - 1);

  return (
    <div
      className={
        "relative transition-opacity" +
        (d.pendingDelete || d.pendingAdd
          ? " animate-pulse opacity-40"
          : d.dragGhost
            ? " opacity-50"
            : "")
      }
    >
      {/*
        Small top-center Handle: canonical endpoint anchor for edges.
        Mirrors letter-node.tsx pattern exactly.
      */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable
        isConnectableStart={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
      {/*
        Full-card drop zone: allows connection drops anywhere on the card.
        Mirrors letter-node.tsx FULL_CARD_HANDLE_STYLE pattern.
      */}
      <Handle
        type="target"
        position={Position.Top}
        id="full"
        isConnectable
        isConnectableStart={false}
        style={FULL_CARD_HANDLE_STYLE}
      >
        <div
          className="cursor-grab active:cursor-grabbing overflow-hidden rounded-md"
          style={{
            // Muted backdrop: 40% storyline color + 60% card — same recipe
            // as ReportSegmentPill, so the block reads recessive against
            // the brightly-filled individual piece pills inside it. The
            // selection / presence rings sit on the SPECIFIC piece pill
            // (see below), not on this group container.
            backgroundColor: `color-mix(in srgb, ${color} 40%, var(--card))`,
          }}
        >
          {/* Title bar — variant-only label at the same height/position as
              a normal letter card's heading pill (h-6 = 24px). */}
          <div
            className="flex items-center gap-1 px-1.5 font-mono text-[11px] leading-none text-white/70"
            style={{ height: 24 }}
          >
            <span className="truncate">{d.contentId}</span>
            {d.pinned ? (
              <Pin
                size={9}
                aria-hidden
                className="ml-auto shrink-0 opacity-80"
                fill="currentColor"
              />
            ) : d.offsetText ? (
              <span className="ml-auto shrink-0 font-mono text-[9px] font-semibold tabular-nums opacity-80">
                {d.offsetText}
              </span>
            ) : null}
          </div>
          {/* Individual piece cards in a horizontal row. Each card uses
              the full storyline color + the letter's summary so they pop
              against the muted parent and surface the letter's content
              the same way standalone letter nodes do.

              No flex `gap` here on purpose — the gap is implemented as
              half-gap horizontal padding on each [data-piece-id] wrapper
              so adjacent wrapper hit-areas TILE with no dead zone. With
              a flex gap, the empty space between pieces hits the muted
              backdrop (pointer-events:none from the parent Handle), the
              click bubbles to the outer node wrapper, and graph-view's
              onNodeClick can't resolve a `[data-piece-id]` ancestor —
              so it falls through to the group-level select, which
              always hydrates to the lowest-piece sibling. That's the
              "second click needed to select piece b2" bug. */}
          <div className="flex flex-row items-stretch px-1.5 pb-1.5">
            {visibleMembers.map((member, idx) => {
              const isSelf = d.selectedPieceId === member.id;
              const peerRings =
                d.pieceRingColorsByMember?.[member.id] ?? undefined;
              const isFirst = idx === 0;
              const isLast = idx === visibleMembers.length - 1;
              return (
                // `pointer-events-auto` is load-bearing: this wrapper is
                // nested inside ReactFlow's "full" <Handle>, which sets
                // pointer-events:none on its entire subtree so handles
                // only catch events during connection drags. Without an
                // explicit auto here, clicks on a piece pill never hit
                // the wrapper at all.
                //
                // `nodrag` is also load-bearing: ReactFlow watches every
                // pointerdown inside a node and starts a drag gesture on
                // even a few pixels of movement before mouseup. Without
                // it, a click with the tiniest hand-shake gets reinterpreted
                // as a drag-start and the click event never fires — so
                // the per-piece select silently misses and the user has
                // to click again. With `nodrag`, RF skips drag detection
                // on the piece pills (you can still drag the group from
                // its muted backdrop), so onClick always fires.
                //
                // onClick → stopPropagation prevents RF's onNodeClick
                // (which routes group-level) from firing on the same
                // gesture.
                <div
                  key={member.id}
                  data-piece-id={member.id}
                  className="nodrag pointer-events-auto cursor-pointer"
                  style={{
                    paddingLeft: isFirst ? 0 : PIECE_GAP / 2,
                    paddingRight: isLast ? 0 : PIECE_GAP / 2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    d.onSelectMember?.(member.id);
                  }}
                >
                  <InspectionLetterCard
                    storyline={{ color_hex: color }}
                    contentId={member.content_id}
                    summary={member.summary}
                    widthPx={PIECE_PILL_W}
                    selected={isSelf}
                    selfRingColor={isSelf ? d.pieceSelfRingColor : undefined}
                    peerRingColors={peerRings}
                  />
                </div>
              );
            })}
            {overflowCount > 0 ? (
              <span
                className="inline-flex h-5 items-center rounded px-1 font-mono text-[9px] text-white/60"
                style={{ marginLeft: PIECE_GAP / 2 }}
              >
                +{overflowCount}
              </span>
            ) : null}
          </div>
        </div>
      </Handle>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
    </div>
  );
}

export default memo(PieceGroupNode);
