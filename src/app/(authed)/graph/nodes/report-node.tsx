"use client";

import { memo } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  HEADING_CENTER_OFFSET_PX,
  ReportSegmentCard,
} from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type ReportNodeData = {
  reportId: string;
  href: string;
  storyline: Pick<Storyline, "color_hex">;
  summary: string | null;
  widthPx?: number;
};

function ReportNode({ data }: NodeProps) {
  const d = data as unknown as ReportNodeData;
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
        style={{ top: HEADING_CENTER_OFFSET_PX }}
      />
      <Link
        href={d.href}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <ReportSegmentCard
          storyline={d.storyline}
          reportId={d.reportId}
          summary={d.summary}
          widthPx={d.widthPx}
        />
      </Link>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
        style={{ top: HEADING_CENTER_OFFSET_PX }}
      />
    </div>
  );
}

export default memo(ReportNode);
