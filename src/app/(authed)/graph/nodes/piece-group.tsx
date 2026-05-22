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
  /** Pre-computed peer-edit ring colors for the piece-group surface. */
  selfRingColor?: string;
  peerRingColors?: string[];
  selected?: boolean;
};

// Max pieces to show before showing a "+N" overflow chip.
const MAX_VISIBLE = 4;

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

  // Show up to MAX_VISIBLE members; collapse the rest to a "+N" chip.
  const visibleMembers =
    d.members.length <= MAX_VISIBLE
      ? d.members
      : d.members.slice(0, MAX_VISIBLE - 1);
  const overflowCount =
    d.members.length <= MAX_VISIBLE ? 0 : d.members.length - (MAX_VISIBLE - 1);

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
            // the brightly-filled individual piece pills inside it.
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
              the same way standalone letter nodes do. */}
          <div
            className="flex flex-row items-stretch gap-[3px] px-1.5 pb-1.5"
            onClickCapture={(e) => {
              // Per-piece click → select that member. Without this the
              // parent piece-group selection swallows every click.
              const target = e.target as HTMLElement | null;
              const memberEl = target?.closest("[data-piece-id]");
              const memberId = memberEl?.getAttribute("data-piece-id");
              if (memberId && d.onSelectMember) {
                e.stopPropagation();
                d.onSelectMember(memberId);
              }
            }}
          >
            {visibleMembers.map((member) => (
              <div
                key={member.id}
                data-piece-id={member.id}
                className="cursor-pointer"
              >
                <InspectionLetterCard
                  storyline={{ color_hex: color }}
                  contentId={member.content_id}
                  summary={member.summary}
                />
              </div>
            ))}
            {overflowCount > 0 ? (
              <span className="inline-flex h-5 items-center rounded px-1 font-mono text-[9px] text-white/60">
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
