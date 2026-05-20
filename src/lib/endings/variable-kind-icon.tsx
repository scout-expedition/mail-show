// Lucide icon per ending variable kind. Centralised so every surface
// that renders a variable pill — header chips, picker options,
// inline `@[mention]` pills in text blocks, graph edges, and the
// inspection-letters action chips — uses the same glyph.
//
// Mapping:
//   text          → Focus    (a focused playthrough-defined string)
//   number_ref    → Play     (per-playthrough numeric impact column)
//   aggregate_ref → Sigma    (sum/aggregate over the impact columns)
//   smart_ref     → Atom     (Smart Variable — composed via conditions)

import type { ComponentType, SVGProps } from "react";
import { Atom, Focus, Play, Sigma } from "lucide-react";
import type { EndingVariableKind } from "@/lib/db/enums";

export type VariableKindIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

export const VARIABLE_KIND_ICON: Record<
  EndingVariableKind,
  VariableKindIconComponent
> = {
  text: Focus,
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

