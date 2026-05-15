"use client";

// Collapse coordination for the Morning Reports working area. Three panel
// modes; the middle mode ("groups") keeps letter-group blocks open while
// collapsing everything inside them plus generic + pinned blocks.

import { createContext, useContext } from "react";

export type MorningCollapseMode = "expanded" | "groups" | "all";

/** Block category, used to resolve the default collapsed state per mode. */
export type CollapseKind = "pinned" | "generic" | "letter_group" | "report";

export interface MorningCollapseContext {
  mode: MorningCollapseMode;
  /** blockId → user override of the panel-mode default. */
  overrides: Map<string, boolean>;
  setOverride: (id: string, collapsed: boolean) => void;
}

const NOOP: MorningCollapseContext = {
  mode: "expanded",
  overrides: new Map(),
  setOverride: () => {},
};

export const MorningCollapseCtx = createContext<MorningCollapseContext>(NOOP);

export function useMorningCollapse(): MorningCollapseContext {
  return useContext(MorningCollapseCtx);
}

/** Panel-mode default collapsed state for a block of the given kind. */
export function defaultCollapsed(
  kind: CollapseKind,
  mode: MorningCollapseMode
): boolean {
  if (mode === "expanded") return false;
  if (mode === "all") return true;
  // "groups": letter-group blocks stay open, everything else collapses.
  return kind !== "letter_group";
}

/** Resolve a block's collapsed state: user override wins over panel mode. */
export function resolveCollapsed(
  kind: CollapseKind,
  id: string,
  ctx: MorningCollapseContext
): boolean {
  return ctx.overrides.get(id) ?? defaultCollapsed(kind, ctx.mode);
}
