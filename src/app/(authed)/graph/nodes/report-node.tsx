"use client";

import { memo } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ReportSegmentPill } from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type ReportNodeData = {
  reportId: string;
  href: string;
  storyline: Pick<Storyline, "color_hex">;
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
      />
      <Link
        href={d.href}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <ReportSegmentPill
          storyline={d.storyline}
          reportId={d.reportId}
        />
      </Link>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
    </div>
  );
}

export default memo(ReportNode);
