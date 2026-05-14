"use client";

// Floating autocomplete popup for the @[Variable Name] tag flow.
// Triggered when the user types `@` in the body textarea: a popup of
// matching variables opens, arrow keys navigate, Enter/Tab/click commits
// `@[Name]` at the caret.
//
// `MentionTextarea` wraps a plain <textarea> with auto-grow (same shape
// as `AutoTextarea` from components/panel.tsx) plus the trigger
// detection. Kept as a sibling component instead of extending
// AutoTextarea because trigger detection needs direct ref access to the
// textarea element (for selectionStart + setting caret after commit),
// which AutoTextarea doesn't forward.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Compute the post-commit textarea state. Replaces text from `atIdx`
 * through the end of any current selection (`selectionEnd`) with the
 * `@[variableName]` token, and returns the new value + the desired
 * caret position (immediately after the closing `]`).
 *
 * `selectionEnd` (not `selectionStart`) is intentional: if the user
 * selects text inside their `@query` before committing, the selected
 * suffix would otherwise survive on the right and produce malformed
 * output like `@[Name]foo`.
 */
export function commitMentionToken(
  value: string,
  atIdx: number,
  selectionEnd: number,
  variableName: string
): { value: string; caret: number } {
  const insert = `@[${variableName}]`;
  const before = value.slice(0, atIdx);
  const after = value.slice(selectionEnd);
  return {
    value: before + insert + after,
    caret: atIdx + insert.length,
  };
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

interface MentionPopupProps {
  filtered: VariableState[];
  activeIndex: number;
  onChangeActiveIndex: (i: number) => void;
  onCommit: (variable: VariableState) => void;
}

function MentionPopup({
  filtered,
  activeIndex,
  onChangeActiveIndex,
  onCommit,
}: MentionPopupProps) {
  // Refs keyed by candidate index, so the active row can scroll into
  // view without us walking past divider elements with nth-child math.
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  itemRefs.current.length = filtered.length;
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (filtered.length === 0) {
    return (
      <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No matching variables.
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label="Variable autocomplete"
      className="absolute left-0 top-full z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 text-xs shadow-lg"
    >
      {filtered.map((v, i) => {
        const isActive = i === activeIndex;
        const color = v.color_hex ?? paletteColor(v.color_index);
        // Divider before this row whenever the kind changes from the
        // previous row. Empty groups produce no divider because there's
        // no preceding row with the prior kind.
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
              // mousedown (not click) so the textarea's blur doesn't
              // fire before commit.
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

// ---------------------------------------------------------------------
// Textarea + autocomplete composition
// ---------------------------------------------------------------------

export interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  variables: VariableState[];
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** Minimum visible rows. Defaults to 2 (matches AutoTextarea). */
  minRows?: number;
}

export function MentionTextarea({
  value,
  onChange,
  variables,
  placeholder,
  className,
  style,
  minRows = 2,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{
    atIdx: number;
    query: string;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto-grow to fit content (same shape as panel.tsx's AutoTextarea —
  // can't reuse directly because that component owns its ref).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Reset highlight whenever the query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.query]);

  const filtered = useMemo(
    () => filterVariablesForMention(variables, trigger?.query ?? ""),
    [variables, trigger?.query]
  );

  const refreshTrigger = useCallback((el: HTMLTextAreaElement) => {
    setTrigger(detectMentionTrigger(el.value, el.selectionStart));
  }, []);

  const commit = useCallback(
    (variable: VariableState) => {
      const el = ref.current;
      if (!el || !trigger) return;
      const { value: next, caret } = commitMentionToken(
        value,
        trigger.atIdx,
        el.selectionEnd,
        variable.name
      );
      onChange(next);
      setTrigger(null);
      // Restore focus + caret on the next paint (after the controlled
      // value has rendered).
      requestAnimationFrame(() => {
        const t = ref.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(caret, caret);
      });
    },
    [trigger, value, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!trigger) return;
      if (filtered.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          setTrigger(null);
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          commit(filtered[activeIndex]);
          break;
        case "Escape":
          e.preventDefault();
          setTrigger(null);
          break;
      }
    },
    [trigger, filtered, activeIndex, commit]
  );

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={minRows}
        placeholder={placeholder}
        style={style}
        className={cn("resize-none overflow-hidden", className)}
        onChange={(e) => {
          onChange(e.target.value);
          refreshTrigger(e.currentTarget);
        }}
        onSelect={(e) => refreshTrigger(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Close on blur, but defer one tick so click-commits on the
          // popup land before the blur fires (popup uses mousedown to
          // pre-empt blur, but belt-and-braces).
          setTimeout(() => setTrigger(null), 0);
        }}
      />
      {trigger ? (
        <MentionPopup
          filtered={filtered}
          activeIndex={activeIndex}
          onChangeActiveIndex={setActiveIndex}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}
