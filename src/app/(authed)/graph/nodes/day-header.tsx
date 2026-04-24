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
      className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card/80 px-2 text-center"
    >
      <span className="font-mono text-[11px] font-semibold tracking-widest text-foreground">
        {d.identifier ?? (d.isUnscheduled ? "—" : "")}
      </span>
      {d.label ? (
        <span className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
          {d.label}
        </span>
      ) : null}
    </div>
  );
}

export default memo(DayHeaderNode);
