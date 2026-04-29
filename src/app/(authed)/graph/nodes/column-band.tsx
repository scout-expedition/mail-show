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
};

function ColumnBandNode({ data }: NodeProps) {
  const d = data as unknown as ColumnBandData;
  const baseBg = d.tinted
    ? "color-mix(in srgb, var(--card) 50%, transparent)"
    : "transparent";
  const hoverBg = "color-mix(in srgb, var(--ring) 12%, transparent)";
  return (
    <div
      aria-hidden
      style={{
        width: d.width,
        height: d.height,
        background: d.hovered ? hoverBg : baseBg,
        outline: d.hovered ? "1px dashed var(--ring)" : undefined,
        outlineOffset: d.hovered ? -1 : undefined,
        borderTop: d.isUnscheduled
          ? "1px dashed var(--border)"
          : "1px solid transparent",
        pointerEvents: "none",
        transition:
          "background-color 80ms ease-out, outline-color 80ms ease-out",
      }}
    />
  );
}

export default memo(ColumnBandNode);
