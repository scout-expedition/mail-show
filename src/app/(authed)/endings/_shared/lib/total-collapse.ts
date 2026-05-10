"use client";

import { createContext, useContext } from "react";

/**
 * Panel-level collapse mode. Three states:
 *   - "expanded": every block fully visible.
 *   - "headers":  every condition block displays as collapsed, but
 *                 descendant condition block headers cascade through
 *                 (rows + chips + prose hidden, nested headers shown).
 *   - "all":      every condition block fully collapsed; nothing inside
 *                 a block renders.
 *
 * The user can also toggle a single block's chevron to override the
 * panel mode for that one block. When any override is set, none of the
 * three mode buttons read as "active" — clicking any of them clears
 * every override and resets the mode.
 */
export type CollapseMode = "expanded" | "headers" | "all";

export interface CollapseContext {
  mode: CollapseMode;
  /** blockId → user-set collapsed state. Presence here means the user
   *  has overridden the panel mode for that block. */
  overrides: Map<string, boolean>;
  setOverride: (blockId: string, collapsed: boolean) => void;
  /** Mutable dedup set used during a ConditionBlock's headers cascade.
   *  Each ConditionBlock entering headers-only rendering swaps in a
   *  fresh set so dedup spans every row inside that block but doesn't
   *  leak across siblings. `null` outside a cascade. */
  cascadeSeen: Set<string> | null;
}

const NOOP_CTX: CollapseContext = {
  mode: "expanded",
  overrides: new Map(),
  setOverride: () => {},
  cascadeSeen: null,
};

export const TotalCollapseCtx = createContext<CollapseContext>(NOOP_CTX);

export function useCollapseCtx(): CollapseContext {
  return useContext(TotalCollapseCtx);
}

/** Fingerprint of a block's declared variable list — used to dedup
 *  siblings in headers view that read identically. */
export function declaredVariableFingerprint(
  variableIds: string[]
): string {
  return [...variableIds].sort().join("|");
}
