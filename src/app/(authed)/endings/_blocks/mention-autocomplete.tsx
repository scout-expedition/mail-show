"use client";

// Autocomplete popup for the @[Variable Name] tag flow + the pure
// helpers (trigger detection, filtering) the Lexical editor plugin
// uses. The textarea-based driver from Phase 2 was retired in Phase 3
// when the text-block body switched to a Lexical contenteditable —
// only the popup + helpers remain.

import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { VariableState } from "@/lib/endings/block-state";
import { paletteColor } from "@/lib/endings/color-palette";

// ---------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------

/**
 * Look backwards from `caret-1` for a `@` that opens an autocomplete
 * trigger. Returns the `@`'s index and the typed query (chars between
 * `@` and `caret`), or null if no active trigger.
 *
 * Mirrors the substitution regex's negative lookbehind (`@` must not
 * follow alnum or another `@`) so the popup never opens inside an
 * `email@[...]` pattern or a `@@` sequence.
 *
 * Terminator chars between `@` and caret close the trigger: `\n` (new
 * paragraph), `[` (start of bracketed form — the user is past the
 * autocomplete stage), `]` (closing bracket — same).
 */
export function detectMentionTrigger(
  text: string,
  caret: number
): { atIdx: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n" || ch === "[" || ch === "]") return null;
    if (ch === "@") {
      const prev = i > 0 ? text[i - 1] : "";
      if (/[A-Za-z0-9@]/.test(prev)) return null;
      return { atIdx: i, query: text.slice(i + 1, caret) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Filter + sort
// ---------------------------------------------------------------------

/**
 * Case-insensitive filter, grouped by variable kind. Output order is
 * text → number_ref → aggregate_ref, matching the popup's section
 * order. Within each group: prefix matches sort first (alphabetical
 * within), then substring matches (alphabetical within).
 *
 * Result is a flat array so keyboard nav stays simple; the popup
 * inserts dividers wherever consecutive items differ in kind.
 */
const KIND_ORDER: VariableState["kind"][] = [
  "text",
  "number_ref",
  "aggregate_ref",
];

export function filterVariablesForMention(
  variables: VariableState[],
  query: string
): VariableState[] {
  const q = query.trim().toLowerCase();
  const out: VariableState[] = [];
  for (const kind of KIND_ORDER) {
    const group = variables.filter((v) => v.kind === kind);
    if (group.length === 0) continue;
    if (!q) {
      out.push(...group.sort((a, b) => a.name.localeCompare(b.name)));
      continue;
    }
    const prefix: VariableState[] = [];
    const substring: VariableState[] = [];
    for (const v of group) {
      const n = v.name.toLowerCase();
      if (n.startsWith(q)) prefix.push(v);
      else if (n.includes(q)) substring.push(v);
    }
    prefix.sort((a, b) => a.name.localeCompare(b.name));
    substring.sort((a, b) => a.name.localeCompare(b.name));
    out.push(...prefix, ...substring);
  }
  return out;
}

const KIND_LABEL: Record<VariableState["kind"], string> = {
  text: "text",
  number_ref: "number",
  aggregate_ref: "aggregate",
};

// ---------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------

export interface MentionAutocompletePopupProps {
  filtered: VariableState[];
  activeIndex: number;
  onChangeActiveIndex: (i: number) => void;
  onCommit: (variable: VariableState) => void;
  /** Pixel coordinates for absolute positioning. Caller computes from
   *  the caret's bounding rect (Lexical) or the textarea's wrapper
   *  position. */
  position: { top: number; left: number };
}

export function MentionAutocompletePopup({
  filtered,
  activeIndex,
  onChangeActiveIndex,
  onCommit,
  position,
}: MentionAutocompletePopupProps) {
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  itemRefs.current.length = filtered.length;
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Both render branches share these positioning styles so the
  // empty-state fallback and the populated list anchor at the same
  // caret coordinates. `position: fixed` so the caller-supplied coords
  // (which come from `getBoundingClientRect()`, i.e. viewport-relative)
  // work directly without needing the popup's parent to be positioned.
  const positionStyle: CSSProperties = {
    position: "fixed",
    top: position.top,
    left: position.left,
    zIndex: 20,
  };

  if (filtered.length === 0) {
    return (
      <div
        style={positionStyle}
        className="w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg"
      >
        No matching variables.
      </div>
    );
  }

  return (
    <ul
      style={positionStyle}
      role="listbox"
      aria-label="Variable autocomplete"
      className="max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 text-xs shadow-lg"
    >
      {filtered.map((v, i) => {
        const isActive = i === activeIndex;
        const color = v.color_hex ?? paletteColor(v.color_index);
        const showDivider = i > 0 && filtered[i - 1].kind !== v.kind;
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
              // mousedown (not click) so the editor's blur doesn't fire
              // before commit.
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
