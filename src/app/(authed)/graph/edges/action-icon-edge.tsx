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
import {
  VAR_CHIP_W,
  type ActiveImpact,
  type ActiveVariable,
} from "@/lib/graph-overlay";

export type ActionIconEdgeData = {
  color: string;
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
  /** Ending-variable chips (name stacked over value) shown beneath the impact
   *  badges when the Variables overlay is on. */
  variables?: ActiveVariable[];
  /** Which side of the chip the impact badges stack on. Defaults to "right". */
  badgeSide?: "left" | "right";
  /** Horizontal nudge applied to the path's target endpoint so converging
   * arrowheads on the same letter/report don't stack at one point. */
  targetXOffset?: number;
  /** Horizontal nudge applied to the path's SOURCE endpoint. Used to
   * spread sn-edge departures across a report's bottom edge so each
   * outgoing line aligns with the matching action's arrival on top. */
  sourceXOffset?: number;
  /** True when this chip is the active inspector selection. */
  selected?: boolean;
  /** Avatar color used for the self-selection ring. Falls back to var(--ring). */
  selfRingColor?: string;
  /** Avatar colors of peers co-selecting this chip — stacked outer rings. */
  peerRingColors?: string[];
  /** True while a delete-action is in flight — chip + lines fade and
   *  pulse so the user sees the optimistic removal in progress. */
  pendingDelete?: boolean;
  /** True while a reconnect / link change is in flight (chip already
   *  snapped to the new target). Adds a subtle pulse on the chip so
   *  the user sees that the change is still saving. */
  optimisticPending?: boolean;
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

/**
 * Mirror of `composeSelectionShadow` in pills.tsx, scoped to the chip
 * button. Self ring sits inside (1px bg gap + 2px ring), peer rings stack
 * outward in 2px slabs.
 */
function composeChipShadow(opts: {
  selected?: boolean;
  selfRingColor?: string;
  peerRingColors?: string[];
}): string | undefined {
  const parts: string[] = [];
  if (opts.selected) {
    parts.push(`0 0 0 1px var(--background)`);
    parts.push(`0 0 0 3px ${opts.selfRingColor ?? "var(--ring)"}`);
  }
  if (opts.peerRingColors?.length) {
    const baseRadius = opts.selected ? 3 : 0;
    opts.peerRingColors.forEach((c, i) => {
      parts.push(`0 0 0 ${baseRadius + (i + 1) * 2}px ${c}`);
    });
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

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
  const terminator = d.terminator ?? "arrow";
  const chipX = d.chipX;
  const chipY = d.chipY;
  const hideChip = !!d.hideChip;
  // Pending-delete fades the whole edge; optimistic-pending leaves it
  // at full color but the chip+lines pulse.
  const pendingDelete = !!d.pendingDelete;
  const optimisticPending = !!d.optimisticPending;
  const baseOpacity = pendingDelete ? 0.4 : 1;
  const strokeStyle = invalid
    ? {
        stroke: color,
        strokeWidth: 1.75,
        strokeDasharray: "6 4",
        opacity: baseOpacity,
      }
    : { stroke: color, strokeWidth: 1.75, opacity: baseOpacity };

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
  // In edit mode the terminator is a 12px circle (no SVG arrowhead);
  // tuck it inside the target box's top edge so it reads as attached to
  // the letter/report it points at. In locked mode the SVG arrowhead's
  // tip lands right on the box edge — no pullback — so the line meets
  // the arrowhead's back cleanly with no floating gap.
  const CONNECTOR_TUCK = 8;
  const arrowTargetY = d.editingEnabled ? targetY + CONNECTOR_TUCK : targetY;
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
  const hasVariables = !hideChip && !!(d.variables && d.variables.length > 0);
  // When the local user has this action selected, ring its overlay chips in
  // the same avatar color as the chip — so the impact badges + variable
  // chips read as part of the selection, not just the chip itself.
  const overlayRingColor = d.selected
    ? d.selfRingColor ?? "var(--ring)"
    : undefined;
  const badgeSide = d.badgeSide ?? "right";
  const badgeAnchorX =
    badgeSide === "right"
      ? chipX + CHIP_PX / 2 + CHIP_TO_BADGES_GAP_PX
      : chipX - CHIP_PX / 2 - CHIP_TO_BADGES_GAP_PX;

  // Selection halos: paint a wider, partly transparent stroke beneath each
  // segment in every selecting user's avatar color so the connector lines
  // read as selected — mirrors the concentric rings around the chip. The
  // local user (when selected) is the innermost band; peers stack outward.
  const selected = !!d.selected;
  const haloRings: string[] = [];
  if (selected) haloRings.push(d.selfRingColor ?? "var(--ring)");
  for (const c of d.peerRingColors ?? []) haloRings.push(c);
  // Widest first so the narrower inner bands paint on top of it.
  const haloLayers = haloRings
    .map((color, i) => ({ color, width: 5 + i * 3 }))
    .reverse();
  const haloPaths = ([single, path1, path2].filter(Boolean) as string[]).map(
    (p, i) => ({ p, key: i })
  );
  return (
    <>
      {haloLayers.flatMap((layer, li) =>
        haloPaths.map(({ p, key }) => (
          <BaseEdge
            key={`halo-${li}-${key}`}
            id={`${id}-halo-${li}-${key}`}
            path={p}
            style={{
              stroke: layer.color,
              strokeWidth: layer.width,
              opacity: 0.55,
            }}
          />
        ))
      )}
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
          style={strokeStyle}
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
              // Keep connector terminus circles on the top layer so they
              // sit over letter-group / report-cluster outline boxes.
              zIndex: 1000,
            }}
            aria-hidden
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: color,
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
          className={
            "nodrag nopan" +
            (pendingDelete || optimisticPending ? " animate-pulse" : "")
          }
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${chipX}px, ${chipY}px)`,
            pointerEvents: "none",
            zIndex: 10,
            opacity: baseOpacity,
          }}
          title={d.actionName}
        >
          <button
            type="button"
            onClick={d.onSelect}
            onContextMenu={d.onContextMenu}
            onPointerDown={(e) => e.stopPropagation()}
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-md border-0"
            style={{
              background: invalid
                ? color
                : d.chipColor ?? color,
              color: readableOnHex(
                invalid ? color : d.chipColor ?? color
              ),
              pointerEvents: "auto",
              cursor: d.onSelect ? "pointer" : "default",
              boxShadow: composeChipShadow({
                selected: d.selected,
                selfRingColor: d.selfRingColor,
                peerRingColors: d.peerRingColors,
              }),
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
                {(d.actionName ?? "?").slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
        </div>
        {hasImpacts || hasVariables ? (
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
            <div
              className={`flex flex-col gap-[3px] ${badgeSide === "left" ? "items-end" : "items-start"}`}
            >
              {hasImpacts ? (
                <BadgeStack
                  impacts={d.impacts as ActiveImpact[]}
                  align={badgeSide === "left" ? "end" : "start"}
                  onSelect={d.onSelect}
                  ringColor={overlayRingColor}
                />
              ) : null}
              {hasVariables ? (
                <VariableChipStack
                  variables={d.variables as ActiveVariable[]}
                  align={badgeSide === "left" ? "end" : "start"}
                  onSelect={d.onSelect}
                  ringColor={overlayRingColor}
                />
              ) : null}
            </div>
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
  onSelect,
  ringColor,
}: {
  impacts: ActiveImpact[];
  align?: "start" | "end";
  /** Opens the inspector for the parent action — wired to every badge. */
  onSelect?: () => void;
  /** Avatar-color ring drawn on each badge while the parent action is the
   *  local user's selection. */
  ringColor?: string;
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
            <ImpactBadge
              key={imp.key}
              impact={imp}
              onSelect={onSelect}
              ringColor={ringColor}
            />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div
          className={`flex flex-row flex-wrap gap-[2px] ${rowJustify}`}
          style={{ maxWidth: otherMaxW }}
        >
          {others.map((imp) => (
            <ImpactBadge
              key={imp.key}
              impact={imp}
              onSelect={onSelect}
              ringColor={ringColor}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Variable chips wrap in a row beneath the impact badges — 2 per row for ≤4,
 * 3 per row otherwise (same wrap rule as the impact badges).
 */
function VariableChipStack({
  variables,
  align = "start",
  onSelect,
  ringColor,
}: {
  variables: ActiveVariable[];
  align?: "start" | "end";
  onSelect?: () => void;
  ringColor?: string;
}) {
  const cols = Math.min(variables.length, variables.length <= 4 ? 2 : 3);
  const maxW = cols * VAR_CHIP_W + Math.max(0, cols - 1) * 2;
  const rowJustify = align === "end" ? "justify-end" : "justify-start";
  return (
    <div
      className={`flex flex-row flex-wrap gap-[2px] ${rowJustify}`}
      style={{ maxWidth: maxW }}
    >
      {variables.map((v) => (
        <VariableChip
          key={v.key}
          variable={v}
          onSelect={onSelect}
          ringColor={ringColor}
        />
      ))}
    </div>
  );
}

/** Click handlers shared by every overlay chip — clicking opens the
 *  inspector for the parent action; the pointerdown stop keeps the click
 *  from starting a graph pan. */
function chipSelectProps(onSelect?: () => void) {
  return {
    onClick: onSelect,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    style: {
      pointerEvents: (onSelect ? "auto" : "none") as "auto" | "none",
      cursor: onSelect ? "pointer" : "default",
    },
  };
}

/**
 * A single ending-variable chip — the variable name stacked above its
 * assigned value (the inspector's action panel shows the two side by side;
 * the graph stacks them so the chip stays narrow). Name segment is filled
 * with the variable color; value segment sits on a dark fill. Each segment
 * wraps to at most two lines before truncating with an ellipsis.
 */
function VariableChip({
  variable,
  onSelect,
  ringColor,
}: {
  variable: ActiveVariable;
  onSelect?: () => void;
  ringColor?: string;
}) {
  const sel = chipSelectProps(onSelect);
  return (
    <button
      type="button"
      onClick={sel.onClick}
      onPointerDown={sel.onPointerDown}
      className="flex flex-col overflow-hidden rounded-sm border text-center font-mono uppercase"
      style={{
        borderColor: variable.color,
        width: VAR_CHIP_W,
        ...sel.style,
        ...(ringColor
          ? { boxShadow: `0 0 0 1px var(--background), 0 0 0 3px ${ringColor}` }
          : null),
      }}
      title={`${variable.name} = ${variable.valueLabel}`}
    >
      <span
        className="line-clamp-2 px-0.5 py-px text-[7px] leading-[8px]"
        style={{
          backgroundColor: variable.color,
          color: readableOnHex(variable.color),
        }}
      >
        {variable.name}
      </span>
      <span className="line-clamp-2 bg-background/85 px-0.5 py-px text-[9px] leading-[10px] text-foreground">
        {variable.valueLabel}
      </span>
    </button>
  );
}

function ImpactBadge({
  impact,
  onSelect,
  ringColor,
}: {
  impact: ActiveImpact;
  onSelect?: () => void;
  ringColor?: string;
}) {
  const sign = impact.value > 0 ? "+" : "";
  const valueColor = impact.valueColor ?? impact.color;
  const sel = chipSelectProps(onSelect);
  return (
    <button
      type="button"
      onClick={sel.onClick}
      onPointerDown={sel.onPointerDown}
      className="inline-flex h-4 items-center gap-0.5 rounded-sm border bg-background/70 px-1 font-mono text-[10px] leading-none tabular-nums"
      style={{
        borderColor: impact.color,
        color: impact.color,
        ...sel.style,
        ...(ringColor
          ? { boxShadow: `0 0 0 1px var(--background), 0 0 0 3px ${ringColor}` }
          : null),
      }}
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
    </button>
  );
}

export const ActionIconEdge = memo(ActionIconEdgeComponent);

export const DEFAULT_ARROW_MARKER = {
  type: MarkerType.ArrowClosed,
  color: "#ffffff",
};
