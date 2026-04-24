"use client";

import { memo } from "react";
import Link from "next/link";
import { type NodeProps } from "@xyflow/react";
import { LetterGroupPill } from "@/components/pills";

export type LetterGroupData = {
  width: number;
  height: number;
  sequence: number; // group sequence (e.g., 2)
  abbr: string; // storyline abbreviation
  color: string; // storyline color hex
  href: string;
};

function LetterGroupNode({ data }: NodeProps) {
  const d = data as unknown as LetterGroupData;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className="relative rounded-md border border-transparent bg-white/5"
    >
      <Link
        href={d.href}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className="absolute left-1/2 -top-3 -translate-x-1/2"
      >
        <LetterGroupPill
          storyline={{ abbreviation: d.abbr, color_hex: d.color }}
          sequence={d.sequence}
        />
      </Link>
    </div>
  );
}

export default memo(LetterGroupNode);
