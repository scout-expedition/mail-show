"use client";

import { memo } from "react";
import Link from "next/link";
import { type NodeProps } from "@xyflow/react";

export type LetterGroupData = {
  width: number;
  height: number;
  label: string; // e.g. "L-W2 Mainstage announcement"
  color: string; // storyline color hex
  href: string; // click target
};

function LetterGroupNode({ data }: NodeProps) {
  const d = data as unknown as LetterGroupData;
  return (
    <div
      style={{
        width: d.width,
        height: d.height,
        borderColor: `color-mix(in srgb, ${d.color} 60%, var(--border))`,
      }}
      className="relative rounded-md border-[1.5px] bg-card/40"
    >
      <Link
        href={d.href}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className="absolute left-2 -top-2.5 inline-flex h-5 items-center rounded bg-card px-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        style={{
          borderColor: `color-mix(in srgb, ${d.color} 60%, var(--border))`,
          border: "1px solid",
        }}
      >
        {d.label}
      </Link>
    </div>
  );
}

export default memo(LetterGroupNode);
