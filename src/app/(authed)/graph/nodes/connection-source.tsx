"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type ConnectionSourceData = {
  /**
   * "report" → action lacks a report segment; circle paints in the
   *            action's color. Drag to a report node to attach it.
   * "next"   → action lacks a next-letter; grey circle. Drag to a letter
   *            in the adjacent group to set the next-letter link.
   * "any"    → action has neither; circle paints in the action's color
   *            and accepts both letter and report drops.
   */
  kind: "report" | "next" | "any";
  /** Fill color (the chip color for "report"/"any", grey for "next"). */
  color: string;
};

const VISIBLE = 12;
const HIT = 24;

/**
 * Tiny draggable handle anchored next to an action chip in edit mode. The
 * node renders a transparent 24px hit area with the 12px visible circle
 * centered inside, so neighbouring connectors stay clickable even when
 * they sit close together. The Handle is sized to the hit area; the
 * coloured circle is a styled child of the Handle.
 */
function ConnectionSourceNode({ data }: NodeProps) {
  const d = data as unknown as ConnectionSourceData;
  const fill = d.color;
  const title =
    d.kind === "report"
      ? "Drag to a report segment to attach it"
      : d.kind === "next"
        ? "Drag to a letter to set as the next letter"
        : "Drag to a report or to a letter to connect this action";
  return (
    <div style={{ width: VISIBLE, height: VISIBLE, position: "relative" }}>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable
        isConnectableStart
        title={title}
        style={{
          width: HIT,
          height: HIT,
          minWidth: HIT,
          minHeight: HIT,
          borderRadius: "50%",
          background: "transparent",
          border: "none",
          // Center the hit area on the visible-circle origin so the
          // pointer-events surface extends ~6px past the visible dot in
          // every direction.
          top: "50%",
          left: "50%",
          right: "auto",
          transform: "translate(-50%, -50%)",
          cursor: "grab",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: VISIBLE,
            height: VISIBLE,
            borderRadius: "50%",
            background: fill,
            border: "1.5px solid var(--background)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
            pointerEvents: "none",
          }}
        />
      </Handle>
    </div>
  );
}

export default memo(ConnectionSourceNode);
