"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { LetterGroupPill } from "@/components/pills";

export type LetterGroupData = {
  width: number;
  height: number;
  sequence: number; // group sequence (e.g., 2)
  abbr: string; // storyline abbreviation
  color: string; // storyline color hex
  selected?: boolean;
  onSelect?: () => void;
};

function LetterGroupNode({ data }: NodeProps) {
  const d = data as unknown as LetterGroupData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className="relative rounded-md border border-transparent bg-white/5"
    >
      <div
        className="absolute top-1/2 left-0 cursor-pointer"
        style={{ transform: "translate(calc(-100% - 8px), -50%)" }}
      >
        <LetterGroupPill
          storyline={{ abbreviation: d.abbr, color_hex: d.color }}
          sequence={d.sequence}
          selected={d.selected}
        />
      </div>
    </div>
  );
}

export default memo(LetterGroupNode);
