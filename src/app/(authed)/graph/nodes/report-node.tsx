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
  onSelect?: () => void;
};

function ReportNode({ data }: NodeProps) {
  const d = data as unknown as ReportNodeData;
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
      <div className="cursor-pointer">
        <ReportSegmentCard
          storyline={d.storyline}
          reportId={d.reportId}
          summary={d.summary}
          widthPx={d.widthPx}
          selected={d.selected}
        />
      </div>
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
