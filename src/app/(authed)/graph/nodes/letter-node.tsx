"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { InspectionLetterCard } from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type LetterNodeData = {
  contentId: string;
  storyline: Pick<Storyline, "color_hex">;
  summary: string | null;
  widthPx?: number;
  selected?: boolean;
  onSelect?: () => void;
};

function LetterNode({ data }: NodeProps) {
  const d = data as unknown as LetterNodeData;
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-2 !w-2 !border-none !bg-transparent"
      />
      <div className="cursor-pointer">
        <InspectionLetterCard
          storyline={d.storyline}
          contentId={d.contentId}
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

export default memo(LetterNode);
