"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type DayHeaderData = {
  width: number;
  height: number;
  identifier: string | null;
  label: string | null;
  isUnscheduled?: boolean;
};

function DayHeaderNode({ data }: NodeProps) {
  const d = data as unknown as DayHeaderData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className="flex items-center justify-end gap-2 rounded-md border border-border bg-card/80 px-3 text-right"
    >
      {d.label ? (
        <span className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
          {d.label}
        </span>
      ) : null}
      <span className="font-mono text-[11px] font-semibold tracking-widest text-foreground">
        {d.identifier ?? (d.isUnscheduled ? "—" : "")}
      </span>
    </div>
  );
}

export default memo(DayHeaderNode);
