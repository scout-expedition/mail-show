"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { LetterGroupPill } from "@/components/pills";

export type LetterGroupData = {
  width: number;
  height: number;
  sequence: number; // group sequence (e.g., 2)
  abbr: string; // storyline abbreviation
  name: string; // group name shown under the pill
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
        className="absolute top-1/2 left-0 flex cursor-pointer flex-col items-center gap-0.5"
        style={{ transform: "translate(-50%, -50%)" }}
      >
        <LetterGroupPill
          storyline={{ abbreviation: d.abbr, color_hex: d.color }}
          sequence={d.sequence}
          selected={d.selected}
        />
        {d.name ? (
          <div
            className="max-w-[88px] break-words text-center font-mono text-[9px] leading-tight text-muted-foreground"
            title={d.name}
          >
            {d.name}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(LetterGroupNode);
