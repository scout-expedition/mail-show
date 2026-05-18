"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ReportSegmentCard } from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type ReportNodeData = {
  reportId: string;
  storyline: Pick<Storyline, "color_hex">;
  summary: string | null;
  widthPx?: number;
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
  pendingDelete?: boolean;
  pendingAdd?: boolean;
  /** Part of an in-progress drag preview — rendered semi-transparent. */
  dragGhost?: boolean;
  /** Filled pin — the report carries an absolute delivery override. */
  pinned?: boolean;
  /** Signed offset text (e.g. "+2") — the report carries a relative override. */
  offsetText?: string | null;
  onSelect?: () => void;
};

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

function ReportNode({ data }: NodeProps) {
  const d = data as unknown as ReportNodeData;
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
        Small top-center Handle: canonical endpoint anchor for any edge
        that targets this report directly (locked-mode arrows). In edit
        mode, per-edge endpoint nodes handle the visual terminator and
        reconnect grab.
      */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable
        isConnectableStart={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
      {/*
        Full-card drop zone: lets a dragged connection land anywhere on
        the card. Identified by `id="full"` so it doesn't displace the
        small Handle as the no-id default for edge endpoint positioning.
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
          <ReportSegmentCard
            storyline={d.storyline}
            reportId={d.reportId}
            summary={d.summary}
            widthPx={d.widthPx}
            selected={d.selected}
            selfRingColor={d.selfRingColor}
            peerRingColors={d.peerRingColors}
            pinned={d.pinned}
            offsetText={d.offsetText}
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

export default memo(ReportNode);
