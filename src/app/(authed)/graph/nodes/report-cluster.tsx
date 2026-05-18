"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type ReportClusterData = {
  width: number;
  height: number;
};

/**
 * Decorative outline box drawn behind the report segments that share a
 * letter group on a single day — the report-side echo of the letter
 * group's outline box. Purely visual: not selectable, draggable, or
 * focusable.
 */
function ReportClusterNode({ data }: NodeProps) {
  const d = data as unknown as ReportClusterData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className="rounded-md border border-white/15"
    />
  );
}

export default memo(ReportClusterNode);
