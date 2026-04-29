"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type ConnectionSourceData = {
  /**
   * "report" → action lacks a report segment; circle paints in the
   *            action's color. Drag to a report node to attach it.
   * "next"   → action lacks a next-letter; grey circle. Drag to a letter
   *            in the adjacent group to set the next-letter link.
   */
  kind: "report" | "next";
  /** Action color, used as the circle fill for the "report" kind. */
  color: string;
};

const SIZE = 12;

/**
 * Tiny draggable handle anchored next to an action chip in edit mode. The
 * node IS the visible circle: an xyflow Handle styled with the action /
 * grey fill, sized 12px, with default Handle pointer-events left intact so
 * the connection drag works the moment the user mousedowns on it.
 */
function ConnectionSourceNode({ data }: NodeProps) {
  const d = data as unknown as ConnectionSourceData;
  const fill = d.kind === "report" ? d.color : "#9ca3af";
  const title =
    d.kind === "report"
      ? "Drag to a report segment to attach it"
      : "Drag to a letter to set as the next letter";
  return (
    <div style={{ width: SIZE, height: SIZE, position: "relative" }}>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable
        isConnectableStart
        title={title}
        style={{
          width: SIZE,
          height: SIZE,
          minWidth: SIZE,
          minHeight: SIZE,
          borderRadius: "50%",
          background: fill,
          border: "1.5px solid var(--background)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
          // Override the Position.Right default (right:0; transform:translate(50%,-50%))
          // so the handle sits centered on the node's origin point.
          top: "50%",
          left: "50%",
          right: "auto",
          transform: "translate(-50%, -50%)",
          cursor: "grab",
        }}
      />
    </div>
  );
}

export default memo(ConnectionSourceNode);
