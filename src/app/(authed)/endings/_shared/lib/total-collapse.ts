"use client";

import { createContext, useContext } from "react";

/**
 * Panel-level collapse mode. Two states:
 *   - "expanded": every block fully visible.
 *   - "all":      every condition block fully collapsed; nothing inside
 *                 a block renders.
 *
 * The user can also toggle a single block's chevron to override the
 * panel mode for that one block. When any override is set, neither
 * mode button reads as "active" — clicking either of them clears every
 * override and resets the mode.
 *
 * The "collapse to headers" intermediate mode was prototyped on this
 * branch and reverted; see the followup issue for the design + impl
 * plan we want to revisit later.
 */
export type CollapseMode = "expanded" | "all";

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
