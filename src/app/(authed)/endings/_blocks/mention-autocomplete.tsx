"use client";

// The @[Variable Name] tag flow's mention-specific pieces: the `@`
// trigger scan and the caret-anchored popup wrapper. The kind-grouped
// filter and the rendered option rows live in the shared
// `variable-picker` module (filterVariables / VariableOptionList).
// The textarea-based driver from Phase 2 was retired in Phase 3 when
// the text-block body switched to a Lexical contenteditable.

import { type CSSProperties } from "react";
import type { VariableState } from "@/lib/endings/block-state";
import { VariableOptionList } from "@/components/variable-picker/variable-option-list";

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
// Popup
// ---------------------------------------------------------------------

export interface MentionAutocompletePopupProps {
  filtered: VariableState[];
  activeIndex: number;
  onChangeActiveIndex: (i: number) => void;
  onCommit: (variable: VariableState) => void;
  /** Pixel coordinates for absolute positioning. Caller computes from
   *  the caret's bounding rect. */
  position: { top: number; left: number };
}

export function MentionAutocompletePopup({
  filtered,
  activeIndex,
  onChangeActiveIndex,
  onCommit,
  position,
}: MentionAutocompletePopupProps) {
  // `position: fixed` so the caller-supplied coords (which come from
  // `getBoundingClientRect()`, i.e. viewport-relative) work directly
  // without needing the popup's parent to be positioned.
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
    <VariableOptionList
      filtered={filtered}
      activeIndex={activeIndex}
      onChangeActiveIndex={onChangeActiveIndex}
      onCommit={onCommit}
      ariaLabel="Variable autocomplete"
      style={positionStyle}
      className="w-64 rounded-md border border-border bg-popover shadow-lg"
    />
  );
}
