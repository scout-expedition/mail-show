"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type GraphContextMenuItem =
  | {
      label: string;
      icon?: React.ReactNode;
      /** Optional trailing decoration (e.g. ChevronRight for "opens submenu"). */
      trailing?: React.ReactNode;
      /** Click handler. Optional when `submenu` is set — hover opens the
       *  submenu, and a bare click on the parent item is a no-op. */
      onClick?: () => void;
      /** Nested entries shown in a cascading submenu on hover. The
       *  submenu closes when the pointer enters a different parent
       *  item; click outside or Escape closes the whole stack. */
      submenu?: GraphContextMenuItem[];
      disabled?: boolean;
      intent?: "default" | "destructive";
    }
  | { divider: true };

/**
 * Lightweight floating context menu anchored at a (clientX, clientY)
 * coordinate, used for right-click on graph nodes and the pane. Closes on
 * outside-click or escape; flips upward when there isn't room below the
 * anchor. Supports one level of cascading submenus that open on hover.
 */
export function GraphContextMenu({
  anchor,
  items,
  onClose,
}: {
  anchor: { x: number; y: number } | null;
  items: GraphContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Which parent item the pointer is currently inside (or last entered
  // before moving into its submenu). Drives cascade rendering — when the
  // pointer enters a *different* parent item, the previous submenu
  // unmounts and the new one (if any) takes its place.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPos(null);
      return;
    }
    const menu = ref.current;
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    const margin = 4;
    const top =
      anchor.y + h + margin > window.innerHeight
        ? Math.max(margin, anchor.y - h - margin)
        : anchor.y + margin;
    const left = Math.max(
      margin,
      Math.min(anchor.x, window.innerWidth - w - margin)
    );
    setPos({ top, left });
  }, [anchor, items.length]);

  useEffect(() => {
    if (!anchor) return;
    function onDoc(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() {
      onClose();
    }
    // Capture-phase so the listener fires before child handlers
    // (ReactFlow's pane/node listeners stopPropagation on some events).
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("contextmenu", onDoc, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("contextmenu", onDoc, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const handleHover = (i: number, item: GraphContextMenuItem) => {
    setHoveredIdx(i);
    if ("divider" in item) {
      setSubmenuAnchor(null);
      return;
    }
    if (!item.submenu) {
      setSubmenuAnchor(null);
      return;
    }
    const btn = itemRefs.current[i];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Anchor the submenu's top-left at the parent item's top-right
    // (a 2px overlap keeps the cursor from dropping into a gap when
    // tracking from item → submenu).
    setSubmenuAnchor({ x: rect.right - 2, y: rect.top });
  };

  const submenuItem =
    hoveredIdx !== null && items[hoveredIdx] && !("divider" in items[hoveredIdx])
      ? items[hoveredIdx]
      : null;
  const submenuItems =
    submenuItem && !("divider" in submenuItem) ? submenuItem.submenu : null;

  if (!anchor) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-max min-w-[180px] max-w-[280px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {items.map((item, i) => {
        if ("divider" in item) {
          return (
            <div
              key={i}
              role="separator"
              className="my-1 border-t border-border"
            />
          );
        }
        const hasSubmenu = !!item.submenu && item.submenu.length > 0;
        return (
          <button
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onMouseEnter={() => handleHover(i, item)}
            onClick={() => {
              if (item.disabled) return;
              // Items with a submenu are hover-only — a click is a
              // no-op so the user can mouse into the submenu without
              // accidentally re-anchoring the menu.
              if (hasSubmenu) return;
              item.onClick?.();
              if (!item.trailing) onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              hoveredIdx === i
                ? item.intent === "destructive"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-accent text-accent-foreground"
                : item.intent === "destructive"
                  ? "text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.trailing}
          </button>
        );
      })}
      {submenuItems && submenuAnchor ? (
        <GraphContextMenu
          anchor={submenuAnchor}
          items={submenuItems}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
