"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { InspectionLetterCard } from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type LetterNodeData = {
  contentId: string;
  storyline: Pick<Storyline, "color_hex">;
  summary: string | null;
  widthPx?: number;
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
  /** True while a delete is in flight for this letter (or its parent
   *  group). Fades the card and animates a soft pulse so the user sees
   *  the optimistic deletion in progress. */
  pendingDelete?: boolean;
  onSelect?: () => void;
};

// Inline-style overrides that strip ReactFlow's default Handle CSS so the
// Handle becomes a transparent in-flow wrapper that sizes to its child
// (the card). element-from-point checks anywhere on the card walk up to
// this Handle, so connection drops land anywhere on the card.
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

function LetterNode({ data }: NodeProps) {
  const d = data as unknown as LetterNodeData;
  return (
    <div
      className={
        "relative transition-opacity" +
        (d.pendingDelete ? " animate-pulse opacity-40" : "")
      }
    >
      {/*
        Small top-center Handle stays as the canonical endpoint anchor for
        edges that target this letter directly (locked-mode arrows). In
        edit mode, per-edge endpoint nodes own the visual terminator and
        reconnect grab, so this Handle's only role there is to be the
        no-id default when ReactFlow needs a connection-endpoint position.
      */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable
        isConnectableStart={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
      {/*
        Full-card drop zone: wraps the card so dropping a connection
        anywhere within the card lands on this Handle. Identified by
        `id="full"` so it doesn't displace the small Handle as the
        no-id default.
      */}
      <Handle
        type="target"
        position={Position.Top}
        id="full"
        isConnectable
        isConnectableStart={false}
        style={FULL_CARD_HANDLE_STYLE}
      >
        <div className="cursor-grab active:cursor-grabbing">
          <InspectionLetterCard
            storyline={d.storyline}
            contentId={d.contentId}
            summary={d.summary}
            widthPx={d.widthPx}
            selected={d.selected}
            selfRingColor={d.selfRingColor}
            peerRingColors={d.peerRingColors}
          />
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

export default memo(LetterNode);
