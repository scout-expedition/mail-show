"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type ColumnBandData = {
  width: number;
  height: number;
  tinted: boolean;
  isUnscheduled?: boolean;
  /** Phase 6: highlight the day-row currently under the drag pointer. */
  hovered?: boolean;
  /** Drop-target cell: the dragged node's storyline column, so the hover
   *  highlight is scoped to one (column × day) cell rather than the row. */
  hoveredCell?: { x: number; width: number } | null;
};

function ColumnBandNode({ data }: NodeProps) {
  const d = data as unknown as ColumnBandData;
  const baseBg = d.tinted
    ? "color-mix(in srgb, var(--card) 50%, transparent)"
    : "transparent";
  const cellBg = "color-mix(in srgb, var(--ring) 14%, transparent)";
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: d.width,
        height: d.height,
        background: baseBg,
        borderTop: d.isUnscheduled
          ? "1px dashed var(--border)"
          : "1px solid transparent",
        pointerEvents: "none",
      }}
    >
      {d.hovered && d.hoveredCell ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: d.hoveredCell.x,
            width: d.hoveredCell.width,
            height: "100%",
            background: cellBg,
            outline: "1px dashed var(--ring)",
            outlineOffset: -1,
            transition: "background-color 80ms ease-out",
          }}
        />
      ) : null}
    </div>
  );
}

export default memo(ColumnBandNode);
