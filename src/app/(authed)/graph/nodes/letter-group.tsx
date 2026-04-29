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
  /** Phase 6: ring this group while a letter is being dragged over it. */
  hovered?: boolean;
  onSelect?: () => void;
};

function LetterGroupNode({ data }: NodeProps) {
  const d = data as unknown as LetterGroupData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className={
        "relative cursor-grab rounded-md border border-transparent bg-white/5 transition-[background-color,box-shadow] duration-100 active:cursor-grabbing" +
        (d.hovered
          ? " bg-[color-mix(in_srgb,var(--ring)_15%,transparent)] ring-2 ring-ring ring-offset-1 ring-offset-background"
          : "")
      }
    >
      <div
        className="absolute top-1/2 left-0 cursor-pointer"
        style={{ transform: "translate(-50%, -50%)" }}
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
