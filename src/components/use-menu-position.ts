import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

type Placement = "down" | "up";
/** "right" / "left": menu is below/above the trigger, aligned to the trigger's right/left edge.
 *  "adjacent-right": menu opens to the right of the trigger (flyout submenu pattern). */
type Alignment = "right" | "left" | "adjacent-right";

export type MenuPosition = {
  top: number;
  left: number;
  placement: Placement;
};

const MARGIN = 4;

/**
 * Pure helper — computes the fixed-position coordinates and placement for a
 * dropdown menu given the trigger's bounding rect, the menu's measured size,
 * and the current viewport dimensions.
 *
 * Exported so it can be unit-tested without a DOM.
 */
export function computeMenuPosition(
  triggerRect: { top: number; bottom: number; left: number; right: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  align: Alignment,
  preferredPlacement: Placement,
  margin = MARGIN
): MenuPosition {
  const menuH = menuSize.height;
  const menuW = menuSize.width;

  // Determine placement: try the preferred direction, flip if there isn't room.
  let placement: Placement;
  if (preferredPlacement === "down") {
    placement =
      triggerRect.bottom + menuH + margin <= viewport.height ? "down" : "up";
  } else {
    placement =
      triggerRect.top - menuH - margin >= 0 ? "up" : "down";
  }

  // Vertical coordinate.
  let top: number;
  if (align === "adjacent-right") {
    // Flyout: align top of menu to bottom of trigger, grow upward if preferred.
    top =
      placement === "up"
        ? triggerRect.bottom - menuH
        : triggerRect.top;
    top = Math.max(margin, Math.min(top, viewport.height - menuH - margin));
  } else {
    top =
      placement === "down"
        ? triggerRect.bottom + margin
        : triggerRect.top - menuH - margin;
  }

  // Horizontal coordinate with viewport clamping.
  let left: number;
  if (align === "adjacent-right") {
    // Open to the right of the trigger; flip left if no room.
    const rightOfTrigger = triggerRect.right + margin;
    if (rightOfTrigger + menuW + margin <= viewport.width) {
      left = rightOfTrigger;
    } else {
      // Flip: open to the left of the trigger.
      left = triggerRect.left - menuW - margin;
    }
    left = Math.max(margin, Math.min(left, viewport.width - menuW - margin));
  } else if (align === "right") {
    left = triggerRect.right - menuW;
    left = Math.max(margin, Math.min(left, viewport.width - menuW - margin));
  } else {
    left = triggerRect.left;
    left = Math.max(margin, Math.min(left, viewport.width - menuW - margin));
  }

  return { top, left, placement };
}

/**
 * Positions a floating menu relative to its trigger button using
 * `position: fixed` coordinates, making it immune to `overflow: hidden`
 * ancestors. Repositions on scroll and resize while open.
 *
 * Generic over the trigger element type so the returned ref can be attached
 * directly to `<button>`, `<div>`, or `<span>` without a cast.
 */
export function useMenuPosition<T extends HTMLElement = HTMLButtonElement>({
  open,
  align = "right",
  preferredPlacement = "down",
  deps = [],
}: {
  open: boolean;
  align?: Alignment;
  preferredPlacement?: Placement;
  /** Additional dependencies that should trigger a reposition (e.g. items.length). */
  deps?: unknown[];
}): {
  triggerRef: RefObject<T | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  pos: MenuPosition | null;
} {
  const triggerRef = useRef<T | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<MenuPosition | null>(null);

  function recompute() {
    if (!triggerRef.current || !menuRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuH = menuRef.current.offsetHeight;
    const menuW = menuRef.current.offsetWidth;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next = computeMenuPosition(
      triggerRect,
      { width: menuW, height: menuH },
      viewport,
      align,
      preferredPlacement
    );
    setPos((prev) => {
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.placement === next.placement
      ) {
        return prev;
      }
      return next;
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, preferredPlacement, ...deps]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { triggerRef, menuRef, pos };
}
