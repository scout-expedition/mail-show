"use client";

import { IconDisplay } from "@/components/icon-display";
import type { ActionTemplate } from "@/lib/db/types";

function readableOn(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/**
 * Group chip that visualizes a set of action templates as a composed swatch.
 * Layout depends on member count:
 *   - 1 member: full fill + icon centered.
 *   - 2 members: diagonal split top-right → bottom-left, icon at each triangle's centroid.
 *   - 3 members: Y-shape — top triangle + two bottom quads divided by a vertical line down from center.
 *   - 4+ members: X-quartered (top / right / bottom / left triangles meeting at center), using the first 4 members.
 *
 * Used both in the admin (`/inspection/actions`) editor and the letter
 * actions AddActionMenu. The visual contract is identical across surfaces.
 */
export function CompositeActionChip({
  members,
  size = 28,
}: {
  members: ActionTemplate[];
  size?: number;
}) {
  if (members.length === 0) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-muted-foreground"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  if (members.length === 1) {
    const m = members[0];
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded border border-border"
        style={{
          width: size,
          height: size,
          background: m.color_hex,
          color: readableOn(m.color_hex),
        }}
        aria-label={m.name}
        title={m.name}
      >
        {m.icon_value ? (
          <IconDisplay
            type={m.icon_type}
            value={m.icon_value}
            size={Math.round(size * 0.55)}
            className="block leading-none"
          />
        ) : null}
      </span>
    );
  }

  type Slice = {
    member: ActionTemplate;
    clip: string;
    /** Centroid as percentages (0-100). */
    cx: number;
    cy: number;
  };

  let slices: Slice[];
  if (members.length === 2) {
    const [a, b] = members;
    slices = [
      { member: a, clip: "polygon(0% 0%, 100% 0%, 0% 100%)", cx: 33.33, cy: 33.33 },
      { member: b, clip: "polygon(100% 0%, 100% 100%, 0% 100%)", cx: 66.66, cy: 66.66 },
    ];
  } else if (members.length === 3) {
    const [top, bl, br] = members;
    slices = [
      { member: top, clip: "polygon(0% 0%, 100% 0%, 50% 50%)", cx: 50, cy: 16.67 },
      {
        member: bl,
        clip: "polygon(0% 0%, 50% 50%, 50% 100%, 0% 100%)",
        cx: 25,
        cy: 62.5,
      },
      {
        member: br,
        clip: "polygon(100% 0%, 100% 100%, 50% 100%, 50% 50%)",
        cx: 75,
        cy: 62.5,
      },
    ];
  } else {
    const [top, right, bottom, left] = members;
    slices = [
      { member: top, clip: "polygon(0% 0%, 100% 0%, 50% 50%)", cx: 50, cy: 16.67 },
      { member: right, clip: "polygon(100% 0%, 100% 100%, 50% 50%)", cx: 83.33, cy: 50 },
      { member: bottom, clip: "polygon(100% 100%, 0% 100%, 50% 50%)", cx: 50, cy: 83.33 },
      { member: left, clip: "polygon(0% 0%, 50% 50%, 0% 100%)", cx: 16.67, cy: 50 },
    ];
  }

  const iconScale = members.length >= 4 ? 0.28 : members.length === 3 ? 0.3 : 0.34;
  const iconSize = Math.max(8, Math.round(size * iconScale));
  const ariaLabel = members.map((m) => m.name).join(" + ");

  return (
    <span
      className="relative shrink-0 overflow-hidden rounded border border-border"
      style={{ width: size, height: size }}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {slices.map((s, idx) => (
        <span
          key={`fill-${idx}`}
          className="absolute inset-0"
          style={{ background: s.member.color_hex, clipPath: s.clip }}
          aria-hidden
        />
      ))}
      {slices.map((s, idx) => (
        <span
          key={`icon-${idx}`}
          className="absolute flex items-center justify-center"
          style={{
            left: `${s.cx}%`,
            top: `${s.cy}%`,
            transform: "translate(-50%, -50%)",
            color: readableOn(s.member.color_hex),
            pointerEvents: "none",
          }}
          aria-hidden
        >
          {s.member.icon_value ? (
            // `block` strips the wrapper span's default inline display so
            // the SVG inside doesn't sit on the text baseline — that would
            // bias the icon a couple pixels low inside its slice.
            <IconDisplay
              type={s.member.icon_type}
              value={s.member.icon_value}
              size={iconSize}
              className="block leading-none"
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}
