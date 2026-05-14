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
  /**
   * Override for the SECOND bezier segment (chip → target). Used to
   * paint letter→chip in the action's own color while chip→next-letter
   * stays muted grey on `ln` edges. Falls back to `color` when unset.
   */
  path2Color?: string;
  /**
   * Optional override for the action-chip background, used when the line
   * itself is muted (e.g. `ln` edges paint a grey line into a next letter
   * but the chip should keep the action's own color). Falls back to
   * `color` when unset.
   */
  chipColor?: string;
  iconType: IconType;
  iconValue: string | null;
  actionName: string;
  /** Absolute X of the chip — also the via-point for the two bezier segments. */
  chipX: number;
  /** Absolute Y of the chip — also the via-point for the two bezier segments. */
  chipY: number;
  /** "arrow" connects through chip to a real target; "circle" terminates at the chip. */
  terminator?: "arrow" | "circle";
  /** Optional impact badges shown beside the chip when the overlay is on. */
  impacts?: ActiveImpact[];
  /** Which side of the chip the impact badges stack on. Defaults to "right". */
  badgeSide?: "left" | "right";
  /** Horizontal nudge applied to the path's target endpoint so converging
   * arrowheads on the same letter/report don't stack at one point. */
  targetXOffset?: number;
  /** Horizontal nudge applied to the path's SOURCE endpoint. Used to
   * spread sn-edge departures across a report's bottom edge so each
   * outgoing line aligns with the matching action's arrival on top. */
  sourceXOffset?: number;
  /** True when this action sets an ending variable and the ending overlay is on. */
  hasEnding?: boolean;
  /** True when this chip is the active inspector selection. */
  selected?: boolean;
  /** Click handler that opens the inspector panel for this action. */
  onSelect?: () => void;
  /** Right-click handler attached to the chip — used to surface a small
   *  Delete Action context menu on the graph. */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Hide the chip icon+badges (e.g., report → next-letter continuations); just draw the colored line. */
  hideChip?: boolean;
  /**
   * Edge represents a broken timing chain — the triggering letter's
   * effective day is the same as or after the report's effective day, so
   * the report can't actually include the letter's outcome. Renders the
   * path as a destructive-color dashed line.
   */
  invalid?: boolean;
  /**
   * When true, the edge's arrow terminator is replaced with a small
   * circle "connector". Reconnectable arrows become drag-to-retarget
   * handles; non-reconnectable arrows just render as static circles.
   */
  editingEnabled?: boolean;
  /** When the connector represents a reconnectable target end, render it
   *  in the line's color (matches the chip drag affordance). */
  reconnectable?: boolean;
};

const CHIP_PX = 20;
const CHIP_TO_BADGES_GAP_PX = 3;

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
  const invalid = !!d.invalid;
  const color = invalid ? "#ef4444" : d.color || "#ffffff";
  const path2Color = invalid ? color : d.path2Color ?? color;
  const terminator = d.terminator ?? "arrow";
  const chipX = d.chipX;
  const chipY = d.chipY;
  const hideChip = !!d.hideChip;
  const strokeStyle = invalid
    ? { stroke: color, strokeWidth: 1.75, strokeDasharray: "6 4" }
    : { stroke: color, strokeWidth: 1.75 };
  const path2StrokeStyle = invalid
    ? { stroke: path2Color, strokeWidth: 1.75, strokeDasharray: "6 4" }
    : { stroke: path2Color, strokeWidth: 1.75 };

  // Cubic bezier segments so the line leaves the source and arrives at the
  // target perpendicular to the pill edges (vertical exit / entry via
  // sourcePosition=Bottom / targetPosition=Top). When the chip is hidden
  // (e.g., report → next-letter continuations), draw a single smooth
  // bezier directly from source to target. Otherwise two segments joined
  // at the chip keep source/chip/target tangents all vertical.
  // Higher curvature (default 0.25) extends the bezier control points
  // further along the source/target tangent so the curve enters the
  // arrowhead closer to vertical instead of cutting in at a shallow
  // angle.
  const CURVATURE = 0.5;
  // Stop the path a couple px short of the actual target Y so the
  // arrowhead's back edge lines up centered on the line. Without this,
  // SVG's marker is placed with its TIP at the path endpoint and the
  // line appears to enter the arrow off-center.
  const ARROW_PULLBACK = 3;
  const arrowTargetY = targetY - ARROW_PULLBACK;
  // Spread converging arrowheads across the target's top edge.
  const arrowTargetX = targetX + (d.targetXOffset ?? 0);
  // Mirror spread on the source side (used for `sn` exits from a report).
  const adjustedSourceX = sourceX + (d.sourceXOffset ?? 0);
  const single =
    hideChip && terminator === "arrow"
      ? getBezierPath({
          sourceX: adjustedSourceX,
          sourceY,
          targetX: arrowTargetX,
          targetY: arrowTargetY,
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          curvature: CURVATURE,
        })[0]
      : null;
  const [path1] = single
    ? [null]
    : getBezierPath({
        sourceX: adjustedSourceX,
        sourceY,
        targetX: chipX,
        targetY: chipY,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        curvature: CURVATURE,
      });
  const path2 =
    !single && terminator === "arrow"
      ? getBezierPath({
          sourceX: chipX,
          sourceY: chipY,
          targetX: arrowTargetX,
          targetY: arrowTargetY,
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          curvature: CURVATURE,
        })[0]
      : null;

  const hasImpacts = !hideChip && !!(d.impacts && d.impacts.length > 0);
  const badgeSide = d.badgeSide ?? "right";
  const badgeAnchorX =
    badgeSide === "right"
      ? chipX + CHIP_PX / 2 + CHIP_TO_BADGES_GAP_PX
      : chipX - CHIP_PX / 2 - CHIP_TO_BADGES_GAP_PX;

  return (
    <>
      {single ? (
        <BaseEdge
          id={`${id}-s`}
          path={single}
          style={strokeStyle}
          markerEnd={markerEnd}
        />
      ) : path1 ? (
        <BaseEdge
          id={`${id}-a`}
          path={path1}
          style={strokeStyle}
        />
      ) : null}
      {path2 ? (
        <BaseEdge
          id={`${id}-b`}
          path={path2}
          style={path2StrokeStyle}
          markerEnd={markerEnd}
        />
      ) : null}

      {d.editingEnabled && terminator === "arrow" ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${arrowTargetX}px, ${arrowTargetY}px)`,
              pointerEvents: "none",
              zIndex: 9,
            }}
            aria-hidden
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                // Terminator sits at the END of the second bezier
                // segment, so use that segment's color (matches the
                // muted grey on letter→next-letter direct edges).
                background: path2Color,
                border: "1.5px solid var(--background)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
              }}
            />
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {hideChip ? null : (
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${chipX}px, ${chipY}px)`,
            pointerEvents: "none",
            zIndex: 10,
          }}
          title={d.actionName}
        >
          <button
            type="button"
            onClick={d.onSelect}
            onContextMenu={d.onContextMenu}
            onPointerDown={(e) => e.stopPropagation()}
            className={
              "relative inline-flex h-5 w-5 items-center justify-center rounded-md border-0" +
              (d.selected
                ? " ring-2 ring-ring ring-offset-1 ring-offset-background"
                : "")
            }
            style={{
              background: invalid
                ? color
                : d.chipColor ?? color,
              color: readableOnHex(
                invalid ? color : d.chipColor ?? color
              ),
              pointerEvents: "auto",
              cursor: d.onSelect ? "pointer" : "default",
            }}
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
          </button>
        </div>
        {hasImpacts ? (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              // Right-side badges grow rightward from the chip; left-side
              // badges grow leftward — translate(-100%, …) right-aligns
              // the wrapper so its right edge sits at the anchor.
              transform: `translate(${badgeSide === "left" ? "-100%" : "0"}, -50%) translate(${badgeAnchorX}px, ${chipY}px)`,
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <BadgeStack
              impacts={d.impacts as ActiveImpact[]}
              align={badgeSide === "left" ? "end" : "start"}
            />
          </div>
        ) : null}
      </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * World status + demerits share a top row (world-level impacts cluster);
 * class and nation affinities wrap below at 2 per row for ≤4 badges, 3 per
 * row otherwise. Rendered as a vertical column to the right of the chip.
 */
function BadgeStack({
  impacts,
  align = "start",
}: {
  impacts: ActiveImpact[];
  align?: "start" | "end";
}) {
  const world = impacts.filter((i) => i.key.startsWith("world:"));
  const others = impacts.filter((i) => !i.key.startsWith("world:"));
  const otherMaxW = others.length <= 4 ? 90 : 132;
  const colAlign = align === "end" ? "items-end" : "items-start";
  const rowJustify = align === "end" ? "justify-end" : "justify-start";
  return (
    <div className={`flex flex-col gap-[2px] ${colAlign}`}>
      {world.length > 0 ? (
        <div className={`flex flex-row gap-[2px] ${rowJustify}`}>
          {world.map((imp) => (
            <ImpactBadge key={imp.key} impact={imp} />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div
          className={`flex flex-row flex-wrap gap-[2px] ${rowJustify}`}
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
