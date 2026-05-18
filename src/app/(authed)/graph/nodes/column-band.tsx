"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type ColumnBandData = {
  width: number;
  height: number;
  tinted: boolean;
  isUnscheduled?: boolean;
};

function ColumnBandNode({ data }: NodeProps) {
  const d = data as unknown as ColumnBandData;
  const baseBg = d.tinted
    ? "color-mix(in srgb, var(--card) 50%, transparent)"
    : "transparent";
  return (
    <div
      aria-hidden
      style={{
        width: d.width,
        height: d.height,
        background: baseBg,
        borderTop: d.isUnscheduled
          ? "1px dashed var(--border)"
          : "1px solid transparent",
        pointerEvents: "none",
      }}
    />
  );
}

export default memo(ColumnBandNode);
