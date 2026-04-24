"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  Position,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { IconDisplay } from "@/components/icon-display";
import { readableOnHex } from "@/components/pills";
import type { IconType } from "@/lib/db/enums";
import type { ActiveImpact } from "@/lib/graph-overlay";

export type ActionIconEdgeData = {
  color: string;
  iconType: IconType;
  iconValue: string | null;
  actionName: string;
  /** Absolute X of the chip — also the via-point for the two bezier segments. */
  chipX: number;
  /** Absolute Y of the chip. */
  chipY: number;
  /** "arrow" connects through chip to a real target; "circle" terminates at the chip. */
  terminator?: "arrow" | "circle";
  /** Optional impact badges shown stacked below the chip when the overlay is on. */
  impacts?: ActiveImpact[];
  /** True when this action sets an ending variable and the ending overlay is on. */
  hasEnding?: boolean;
};

function ActionIconEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
}: EdgeProps) {
  const d = data as unknown as ActionIconEdgeData;
  const color = d.color || "#ffffff";
  const terminator = d.terminator ?? "arrow";
  const chipX = d.chipX;
  const chipY = d.chipY;

  // Cubic bezier segments so the line leaves the source and arrives at the
  // target perpendicular to the pill edges (horizontal exit / entry via
  // sourcePosition=Right / targetPosition=Left). Full connections use two
  // segments joined at the chip — each segment's endpoint tangents are
  // horizontal, so the curve is C1-smooth across the chip AND perpendicular
  // at source and target. For dangling, the chip itself terminates the line.
  const [path1] = getBezierPath({
    sourceX,
    sourceY,
    targetX: chipX,
    targetY: chipY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  });
  const path2 =
    terminator === "arrow"
      ? getBezierPath({
          sourceX: chipX,
          sourceY: chipY,
          targetX,
          targetY,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        })[0]
      : null;

  return (
    <>
      <BaseEdge
        id={`${id}-a`}
        path={path1}
        style={{ stroke: color, strokeWidth: 1.75 }}
      />
      {path2 ? (
        <BaseEdge
          id={`${id}-b`}
          path={path2}
          style={{ stroke: color, strokeWidth: 1.75 }}
          markerEnd={markerEnd}
        />
      ) : null}

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan flex flex-col items-center"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${chipX}px, ${chipY}px)`,
            pointerEvents: "none",
            zIndex: 10,
          }}
          title={d.actionName}
        >
          <span
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-md"
            style={{ background: color, color: readableOnHex(color) }}
          >
            {d.iconValue ? (
              <IconDisplay
                type={d.iconType}
                value={d.iconValue}
                size={12}
              />
            ) : (
              <span className="text-[10px] font-mono font-semibold">
                {d.actionName.slice(0, 1).toUpperCase()}
              </span>
            )}
            {d.hasEnding ? (
              <span
                aria-label="Sets an ending variable"
                title="Sets an ending variable"
                className="absolute -right-1 -top-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-amber-400 text-[8px] font-semibold leading-none text-black"
              >
                <IconDisplay type="tabler" value="IconFlag" size={8} />
              </span>
            ) : null}
          </span>
          {d.impacts && d.impacts.length > 0 ? (
            <BadgeStack impacts={d.impacts} />
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * World status + demerits share a top row (world-level impacts cluster);
 * class and nation affinities wrap below at 2 per row for ≤4 badges, 3 per
 * row otherwise.
 */
function BadgeStack({ impacts }: { impacts: ActiveImpact[] }) {
  const world = impacts.filter((i) => i.key.startsWith("world:"));
  const others = impacts.filter((i) => !i.key.startsWith("world:"));
  const otherMaxW = others.length <= 4 ? 90 : 132;
  return (
    <div className="mt-[3px] flex flex-col items-center gap-[2px]">
      {world.length > 0 ? (
        <div className="flex flex-row justify-center gap-[2px]">
          {world.map((imp) => (
            <ImpactBadge key={imp.key} impact={imp} />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div
          className="flex flex-row flex-wrap justify-center gap-[2px]"
          style={{ maxWidth: otherMaxW }}
        >
          {others.map((imp) => (
            <ImpactBadge key={imp.key} impact={imp} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImpactBadge({ impact }: { impact: ActiveImpact }) {
  const sign = impact.value > 0 ? "+" : "";
  const valueColor = impact.valueColor ?? impact.color;
  return (
    <span
      className="inline-flex h-4 items-center gap-0.5 rounded-sm border bg-background/70 px-1 font-mono text-[10px] leading-none tabular-nums"
      style={{ borderColor: impact.color, color: impact.color }}
      title={`${impact.label} ${sign}${impact.value}`}
    >
      {impact.iconValue ? (
        <IconDisplay
          type={impact.iconType}
          value={impact.iconValue}
          size={10}
        />
      ) : null}
      <span style={{ color: valueColor }}>
        {sign}
        {impact.value}
      </span>
    </span>
  );
}

export const ActionIconEdge = memo(ActionIconEdgeComponent);

export const DEFAULT_ARROW_MARKER = {
  type: MarkerType.ArrowClosed,
  color: "#ffffff",
};
