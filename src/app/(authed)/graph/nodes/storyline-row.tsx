"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { StorylinePill } from "@/components/pills";
import type { Storyline } from "@/lib/db/types";

export type StorylineRowData = {
  width: number;
  height: number;
  storyline: Pick<
    Storyline,
    "name" | "abbreviation" | "color_hex" | "icon_type" | "icon_value"
  >;
};

function StorylineRowNode({ data }: NodeProps) {
  const d = data as unknown as StorylineRowData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className="flex items-start justify-end pr-3 pt-2"
    >
      <StorylinePill storyline={d.storyline} />
    </div>
  );
}

export default memo(StorylineRowNode);
