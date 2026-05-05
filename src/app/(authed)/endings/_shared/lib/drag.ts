// Drag-drop coordination for the v3 endings editor.
//
// Model: two-phase commit-on-release.
//   1. While the user drags, dragover handlers update a `target` (where the
//      dragged block would land if released now) and per-block components
//      render a visual indicator (insertion line / empty-row highlight).
//      Block state itself is NOT mutated during the drag.
//   2. On release, `commit()` performs the reparent + reorder once, using
//      the last-known target.
//
// This avoids the oscillation/jitter that "reorder during dragover" causes
// at parent boundaries and into empty containers — the cursor's relative
// position no longer shifts mid-drag because the DOM doesn't move.
//
// Release-path resolution is layered (see framework-editor.tsx for the
// listeners): per-element drop → window drop → window dragend → safety
// timer. Native HTML5 dragend silently doesn't fire in several Chrome edge
// cases (release outside window, click-without-real-drag, source DOM
// removed mid-drag), and the layered listeners catch all of them.

import { createContext, useContext } from "react";
import type { BlockState, ParentLoc } from "@/lib/endings/block-state";

/** Where the dragged block will land if released now. */
export type DragTarget =
  | {
      kind: "near";
      parent_block_id: string | null;
      parent_row_id: string | null;
      targetId: string;
      position: "before" | "after";
    }
  | {
      kind: "empty";
      parent_block_id: string | null;
      parent_row_id: string | null;
    };

export interface DragContext {
  dragId: string | null;
  dragHeight: number | null;
  target: DragTarget | null;
  start: (blockId: string, height: number) => void;
  /** Set the pending drop intent (called from dragenter / dragover). */
  setTarget: (t: DragTarget | null) => void;
  /** Commit the move using the current target (called from drop). */
  commit: () => void;
}

export const DragCtx = createContext<DragContext | null>(null);

export function useDrag(): DragContext {
  const ctx = useContext(DragCtx);
  if (!ctx) throw new Error("DragCtx not provided");
  return ctx;
}

/**
 * Reparent + reorder one block. Returns the new block list, or `prev`
 * unchanged if the move would create a cycle (target lives inside the
 * dragged subtree) or violate result-uniqueness in the destination
 * group.
 *
 * Result-uniqueness: a result block must be the sole non-fallback
 * block in its sibling group. Reject moves that would put a result
 * alongside any other non-fallback block (in either direction).
 */
export function moveBlock(
  prev: BlockState[],
  blockId: string,
  target: ParentLoc,
  beforeId: string | null
): BlockState[] {
  const b = prev.find((x) => x.id === blockId);
  if (!b) return prev;
  if (beforeId === blockId) return prev;

  // Cycle guard: walk target.parent_block_id chain; reject if blockId appears.
  let cur: string | null = target.parent_block_id;
  while (cur) {
    if (cur === blockId) return prev;
    const parent = prev.find((x) => x.id === cur);
    cur = parent?.parent_block_id ?? null;
  }

  // Result-uniqueness in the destination group. Same predicate used by
  // BlockList adders + addBlock server action.
  const destSiblings = prev.filter(
    (x) =>
      x.id !== blockId &&
      x.parent_block_id === target.parent_block_id &&
      x.parent_row_id === target.parent_row_id &&
      x.block_type !== "fallback"
  );
  const destHasResult = destSiblings.some((x) => x.block_type === "result");
  if (b.block_type === "result" && destSiblings.length > 0) return prev;
  if (b.block_type !== "result" && destHasResult) return prev;

  const next = prev.map((x) =>
    x.id === blockId
      ? {
          ...x,
          parent_block_id: target.parent_block_id,
          parent_row_id: target.parent_row_id,
        }
      : x
  );
  const fromIdx = next.findIndex((x) => x.id === blockId);
  const [moved] = next.splice(fromIdx, 1);
  if (beforeId) {
    const toIdx = next.findIndex((x) => x.id === beforeId);
    next.splice(toIdx < 0 ? next.length : toIdx, 0, moved);
  } else {
    next.push(moved);
  }
  return next;
}
