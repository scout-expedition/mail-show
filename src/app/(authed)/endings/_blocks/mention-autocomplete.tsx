"use client";

// The @[Variable Name] tag flow's mention trigger detection.
// The caret-anchored popup was moved to VariablePickerPanel (folder-aware).
// The textarea-based driver from Phase 2 was retired in Phase 3 when
// the text-block body switched to a Lexical contenteditable.

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
