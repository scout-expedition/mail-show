"use client";

import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import { VARIABLE_KIND_ICON } from "@/lib/endings/variable-kind-icon";
import type { EndingVariableKind } from "@/lib/db/enums";
import type { VariableLike } from "./variable-filter";

const KIND_LABEL: Record<EndingVariableKind, string> = {
  text: "text",
  // Renamed from "number" — these variables track playthrough impact
  // columns (citizens, deaths, etc.), not arbitrary numerics. The
  // "playthrough" label reads more clearly in the picker than "number".
  number_ref: "playthrough",
  aggregate_ref: "aggregate",
  smart_ref: "smart",
};

export interface VariableOptionListProps<T extends VariableLike> {
  /** Pre-filtered, kind-grouped variables (see `filterVariables`). */
  filtered: T[];
  /** Highlighted row index; -1 = none highlighted (mouse mode). */
  activeIndex: number;
  onChangeActiveIndex: (i: number) => void;
  onCommit: (variable: T) => void;
  ariaLabel?: string;
  /** Extra classes for the <ul> — callers add width / chrome. */
  className?: string;
  /** Positioning styles — callers anchor the list however they need. */
  style?: CSSProperties;
}

/**
 * Presentational listbox of variable rows — a color square, the name,
 * and a kind label, with dividers between kind groups and a keyboard
 * highlight that scrolls into view. It owns no popup lifecycle,
 * open/close, positioning, or keyboard policy — callers keep those,
 * since the two surfaces (endings mention autocomplete, inspection-
 * letters action variable picker) have different interaction models.
 */
export function VariableOptionList<T extends VariableLike>({
  filtered,
  activeIndex,
  onChangeActiveIndex,
  onCommit,
  ariaLabel,
  className,
  style,
}: VariableOptionListProps<T>) {
  // Indexed by row position. Unmounted rows get nulled by React's ref
  // callback, so the array self-prunes when `filtered` shrinks — only
  // `itemRefs.current[activeIndex]` is ever read.
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <ul
      style={style}
      role="listbox"
      aria-label={ariaLabel}
      // tabIndex -1 so the scrollable list isn't itself a tab stop
      // (Chrome makes overflowing scrollers keyboard-focusable).
      tabIndex={-1}
      className={cn("max-h-56 overflow-y-auto py-1 text-xs", className)}
    >
      {filtered.map((v, i) => {
        const isActive = i === activeIndex;
        const color = v.color_hex ?? paletteColor(v.color_index);
        const showDivider = i > 0 && filtered[i - 1].kind !== v.kind;
        const KindIcon = VARIABLE_KIND_ICON[v.kind];
        return (
          <Fragment key={v.id}>
            {showDivider ? (
              <li
                role="separator"
                aria-hidden
                className="my-1 border-t border-border/60"
              />
            ) : null}
            <li
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="option"
              aria-selected={isActive}
              // mousedown (not click) so a focused editor / search input
              // doesn't blur-close the popup before the commit lands.
              onMouseDown={(e) => {
                e.preventDefault();
                onCommit(v);
              }}
              onMouseEnter={() => onChangeActiveIndex(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2 py-1",
                isActive && "bg-accent/60"
              )}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <KindIcon
                size={11}
                aria-hidden
                className="shrink-0 text-muted-foreground/80"
              />
              <span className="flex-1 truncate text-foreground">{v.name}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {KIND_LABEL[v.kind]}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
