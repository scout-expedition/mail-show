// Drag-drop coordination for the v3 endings editor. The editor keeps a
// single `dragId` (the block currently being dragged) and a `dragHeight`
// (its on-screen height at drag start, used to size the placeholder slot).
// All block targets register dragover handlers that reparent + reorder the
// dragged block via `moveBlock`.

import { createContext, useContext } from "react";
import type { BlockState, ParentLoc } from "@/lib/endings/block-state";

export interface DragContext {
  dragId: string | null;
  dragHeight: number | null;
  start: (blockId: string, height: number) => void;
  end: () => void;
  /** Drop dragged block before `overId` under `target`. */
  overBlock: (target: ParentLoc, overId: string) => void;
  /** Drop dragged block at the end of `target` (an empty list slot). */
  overEmpty: (target: ParentLoc) => void;
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
 * dragged subtree).
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
