// Lucide icon per ending variable kind. Centralised so every surface
// that renders a variable pill — header chips, picker options,
// inline `@[mention]` pills in text blocks, graph edges, and the
// inspection-letters action chips — uses the same glyph.
//
// Mapping:
//   text          → Hash     (a playthrough-defined string variable)
//   number_ref    → Play     (per-playthrough numeric impact column)
//   aggregate_ref → Sigma    (sum/aggregate over the impact columns)
//   smart_ref     → Atom     (Smart Variable — composed via conditions)

import type { ComponentType, SVGProps } from "react";
import { Atom, Globe, Hash, Play, Sigma } from "lucide-react";
import type { EndingVariableKind } from "@/lib/db/enums";
import type { Nation } from "@/lib/db/types";
import type { VariableState } from "./block-state";
import { IconDisplay } from "@/components/icon-display";

export type VariableKindIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

export const VARIABLE_KIND_ICON: Record<
  EndingVariableKind,
  VariableKindIconComponent
> = {
  text: Hash,
  number_ref: Play,
  aggregate_ref: Sigma,
  smart_ref: Atom,
};

/**
 * Convenience wrapper that picks the icon by kind so callers don't
 * have to destructure the map. `size` and `className` flow through to
 * the underlying lucide component.
 */
export function VariableKindIcon({
  kind,
  size,
  className,
}: {
  kind: EndingVariableKind;
  size?: number;
  className?: string;
}) {
  const Icon = VARIABLE_KIND_ICON[kind];
  return <Icon size={size} className={className} aria-hidden />;
}

// ---------------------------------------------------------------------
// Per-row icon resolver used by the folder-aware variable picker popup.
//
// Where `VARIABLE_KIND_ICON` collapses every variable to one of four
// lucide glyphs by `kind`, `resolveVariableIcon` returns a richer
// descriptor that lets the picker show the *specific* glyph for an
// impact / class / nation row — e.g. "World Status" gets the globe-bolt
// tabler icon, "Proletariat" gets the hammer, each nation gets its own
// flag. Falls back to `Globe` if a nation row has no usable icon set.
// ---------------------------------------------------------------------

/** Narrow shape of nation row the resolver needs. The endings/logic
 * page query already selects exactly these fields. */
export type NationIconRef = Pick<
  Nation,
  "name" | "color_hex" | "icon_type" | "icon_value"
>;

export type ResolvedVariableIcon =
  | { source: "lucide"; name: "Hash" | "Atom" | "Sigma" | "Globe" }
  | { source: "tabler"; name: string };

const LUCIDE_ICONS = { Hash, Atom, Sigma, Globe } as const;

export function resolveVariableIcon(
  variable: VariableState,
  nations: ReadonlyArray<NationIconRef>
): ResolvedVariableIcon {
  switch (variable.kind) {
    case "text":
      return { source: "lucide", name: "Hash" };
    case "smart_ref":
      return { source: "lucide", name: "Atom" };
    case "aggregate_ref":
      return { source: "lucide", name: "Sigma" };
    case "number_ref": {
      const ref = variable.number_ref;
      if (ref === "world_status") return { source: "tabler", name: "IconWorldBolt" };
      if (ref === "demerits") return { source: "tabler", name: "IconCircleMinus" };
      if (ref === "proletariat") return { source: "tabler", name: "IconHammer" };
      if (ref === "gentry") return { source: "tabler", name: "IconDiamond" };
      // Nation column lookup by lowercased name.
      const nation = ref
        ? nations.find((n) => n.name.toLowerCase() === ref.toLowerCase())
        : undefined;
      if (nation && nation.icon_type === "tabler" && nation.icon_value) {
        return { source: "tabler", name: nation.icon_value };
      }
      return { source: "lucide", name: "Globe" };
    }
  }
}

export function ResolvedVariableIconView({
  icon,
  size = 12,
  color,
  className,
}: {
  icon: ResolvedVariableIcon;
  size?: number;
  color?: string;
  className?: string;
}) {
  if (icon.source === "lucide") {
    const Icon = LUCIDE_ICONS[icon.name];
    return (
      <Icon
        size={size}
        aria-hidden
        className={className}
        style={color ? { color } : undefined}
      />
    );
  }
  // Tabler icons render as a wrapping span via IconDisplay; the icon
  // itself uses `currentColor`, so coloring the wrapper colors the
  // strokes.
  return (
    <span
      className={className}
      style={color ? { color, display: "inline-flex" } : { display: "inline-flex" }}
      aria-hidden
    >
      <IconDisplay type="tabler" value={icon.name} size={size} />
    </span>
  );
}

