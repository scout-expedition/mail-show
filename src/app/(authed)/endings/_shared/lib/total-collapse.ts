"use client";

import { createContext, useContext } from "react";

/**
 * Panel-level collapse mode. Three states:
 *   - "expanded": every block fully visible.
 *   - "groups":   every condition block stays expanded (the logic-tree
 *                 skeleton stays visible); every text block collapses to
 *                 its header/summary.
 *   - "all":      every condition block fully collapsed; nothing inside
 *                 a block renders.
 *
 * The user can also toggle a single block's chevron to override the
 * panel mode for that one block. When any override is set, no mode
 * button reads as "active" — clicking any of them clears every
 * override and resets the mode.
 */
export type CollapseMode = "expanded" | "groups" | "all";

export interface CollapseContext {
  mode: CollapseMode;
  /** blockId → user-set collapsed state. Presence here means the user
   *  has overridden the panel mode for that block. */
  overrides: Map<string, boolean>;
  setOverride: (blockId: string, collapsed: boolean) => void;
}

const NOOP_CTX: CollapseContext = {
  mode: "expanded",
  overrides: new Map(),
  setOverride: () => {},
};

export const TotalCollapseCtx = createContext<CollapseContext>(NOOP_CTX);

export function useCollapseCtx(): CollapseContext {
  return useContext(TotalCollapseCtx);
}
