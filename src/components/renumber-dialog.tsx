"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Diamond,
  MailOpen,
  Mails,
  Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  intToLetter,
  intToRoman,
  letterToInt,
  romanToInt,
} from "@/lib/id-tokens";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RenumberKind =
  | "letterGroup"
  | "inspectionLetter"
  | "reportSegment"
  | "sortingRule";

export type RenumberItem = {
  /** Opaque unique key (groupId / segmentId / variant-string). */
  id: string;
  /** Current display token — "2", "ii", "b". */
  numberToken: string;
  /** Shown inline to the right of the row. */
  name: string;
};

export type RenumberRequest = {
  kind: RenumberKind;
  /** ALL siblings in the parent scope, including the target. */
  items: RenumberItem[];
  /** The item whose "Edit ID" was clicked. */
  targetId: string;
  /** ID prefix shown in the pill and before each dropdown ("W", "L-W2/"). */
  prefix?: string;
};

export type RenumberResult = {
  /** Only items that changed. */
  edits: Array<{ id: string; newNumberToken: string }>;
};

// ---------------------------------------------------------------------------
// Per-kind codecs + icons
// ---------------------------------------------------------------------------

type Codec = {
  /** Display token → integer (null when unparseable). */
  parse(token: string): number | null;
  /** Integer → display token. */
  format(n: number): string;
};

const CODECS: Record<RenumberKind, Codec> = {
  letterGroup: {
    parse(token) {
      const n = Number(token);
      return Number.isInteger(n) && n >= 1 ? n : null;
    },
    format: (n) => String(n),
  },
  reportSegment: { parse: romanToInt, format: intToRoman },
  inspectionLetter: { parse: letterToInt, format: intToLetter },
  sortingRule: {
    parse: letterToInt,
    // Rule IDs display as uppercase letters (A, B, …).
    format: (n) => intToLetter(n).toUpperCase(),
  },
};

const KIND_ICON: Record<
  RenumberKind,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  letterGroup: Mails,
  inspectionLetter: MailOpen,
  reportSegment: Megaphone,
  sortingRule: Diamond,
};

/** Letter-kinded ranges cap at 26 (A–Z); numeric kinds are unbounded. */
const MAX_OPTION: Record<RenumberKind, number> = {
  letterGroup: Number.POSITIVE_INFINITY,
  reportSegment: Number.POSITIVE_INFINITY,
  inspectionLetter: 26,
  sortingRule: 26,
};

// ---------------------------------------------------------------------------
// Internal row + cascade
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  name: string;
  originalInt: number;
  /** Chosen new number, or null while unresolved. */
  draftInt: number | null;
  origin: "target" | "cascade";
};

/** Parse every item's current token to an integer. */
function makeItemInt(
  items: RenumberItem[],
  codec: Codec
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.id, codec.parse(it.numberToken) ?? 0);
  return m;
}

/**
 * Grow the cascade: for every row whose draft lands on an item not yet being
 * edited, append that displaced item as a fresh (unresolved) cascade row.
 * Collisions are checked against the FULL item set, so a re-evaluation after
 * an upstream edit naturally pulls in only the items that are still displaced.
 */
function buildCascade(
  baseRows: Row[],
  items: RenumberItem[],
  itemInt: Map<string, number>
): Row[] {
  const rows = [...baseRows];
  for (let iter = 0; iter <= items.length; iter++) {
    const rowIds = new Set(rows.map((r) => r.id));
    let added = false;
    for (const row of rows) {
      if (row.draftInt == null) continue;
      const collide = items.find(
        (it) => !rowIds.has(it.id) && itemInt.get(it.id) === row.draftInt
      );
      if (collide) {
        rows.push({
          id: collide.id,
          name: collide.name,
          originalInt: itemInt.get(collide.id) ?? 0,
          draftInt: null,
          origin: "cascade",
        });
        rowIds.add(collide.id);
        added = true;
      }
    }
    if (!added) break;
  }
  return rows;
}

type ValidationStatus = {
  ok: boolean;
  message: string;
  tone: "ok" | "error" | "neutral";
  /** Rows whose draft duplicates an earlier row / a non-edited sibling. */
  invalidIds: Set<string>;
};

function validate(
  rows: Row[],
  items: RenumberItem[],
  itemInt: Map<string, number>
): ValidationStatus {
  // A row is invalid if its draft duplicates an earlier row's draft, or
  // lands on a sibling that isn't being edited. The earlier/upper row of a
  // clashing pair stays clean — the lower one is flagged.
  const invalidIds = new Set<string>();
  const seen = new Set<number>();
  const rowIds = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    if (r.draftInt == null) continue;
    const clashesSibling = items.some(
      (it) => !rowIds.has(it.id) && itemInt.get(it.id) === r.draftInt
    );
    if (seen.has(r.draftInt) || clashesSibling) invalidIds.add(r.id);
    else seen.add(r.draftInt);
  }
  if (invalidIds.size > 0) {
    return {
      ok: false,
      message: "Two items would share the same ID",
      tone: "error",
      invalidIds,
    };
  }
  const unresolved = rows.filter((r) => r.draftInt == null).length;
  if (unresolved > 0) {
    return {
      ok: false,
      message: `Resolve ${unresolved} more`,
      tone: "neutral",
      invalidIds,
    };
  }
  if (!rows.some((r) => r.draftInt !== r.originalInt)) {
    return { ok: false, message: "No changes yet", tone: "neutral", invalidIds };
  }
  return { ok: true, message: "Looks good", tone: "ok", invalidIds };
}

// ---------------------------------------------------------------------------
// Number dropdown
// ---------------------------------------------------------------------------

function NumberDropdown({
  value,
  placeholder,
  options,
  occupied,
  invalid,
  codec,
  kindIcon: Icon,
  onSelect,
}: {
  value: number | null;
  placeholder: string;
  options: number[];
  /** Integers currently held by some sibling — flagged with the kind icon. */
  occupied: Set<number>;
  /** When true, this row duplicates another — paint the box red. */
  invalid: boolean;
  codec: Codec;
  kindIcon: React.ComponentType<{ size?: number; className?: string }>;
  onSelect: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 w-36 items-center justify-between rounded-md border border-border bg-card px-2 font-mono text-sm transition-colors hover:bg-accent/40",
          invalid && "border-destructive ring-2 ring-destructive"
        )}
      >
        <span className={value == null ? "text-muted-foreground" : "text-foreground"}>
          {value == null ? placeholder : codec.format(value)}
        </span>
        <ChevronDown size={12} aria-hidden className="text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-0 top-9 z-10 max-h-56 w-36 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg">
          {options.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onSelect(n);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-sm transition-colors hover:bg-accent",
                n === value && "bg-accent/60"
              )}
            >
              <span className="w-8">{codec.format(n)}</span>
              {occupied.has(n) ? (
                <Icon size={11} aria-hidden className="text-muted-foreground" />
              ) : null}
              {n === value ? (
                <Check size={11} aria-hidden className="ml-auto text-muted-foreground" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * `useRenumberDialog` — mirrors the `useConfirm` pattern.
 *
 *   const { openRenumber, dialog } = useRenumberDialog({ scoped: true });
 *   // render `dialog` once in the subtree
 *   const result = await openRenumber(req);  // null = cancelled
 */
export function useRenumberDialog(options?: { scoped?: boolean }): {
  openRenumber: (req: RenumberRequest) => Promise<RenumberResult | null>;
  dialog: React.ReactNode;
} {
  const scoped = !!options?.scoped;
  const [req, setReq] = useState<RenumberRequest | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const resolverRef = useRef<((v: RenumberResult | null) => void) | null>(null);

  const openRenumber = useCallback(
    (request: RenumberRequest) =>
      new Promise<RenumberResult | null>((resolve) => {
        const codec = CODECS[request.kind];
        const target = request.items.find((i) => i.id === request.targetId);
        if (!target) {
          resolve(null);
          return;
        }
        resolverRef.current = resolve;
        setRows([
          {
            id: target.id,
            name: target.name,
            originalInt: codec.parse(target.numberToken) ?? 0,
            draftInt: null,
            origin: "target",
          },
        ]);
        setReq(request);
      }),
    []
  );

  const settle = useCallback((result: RenumberResult | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setReq(null);
    setRows([]);
    resolve?.(result);
  }, []);

  // Escape key → cancel.
  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") settle(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, settle]);

  let dialog: React.ReactNode = null;
  if (req) {
    const codec = CODECS[req.kind];
    const prefix = req.prefix ?? "";
    const itemInt = makeItemInt(req.items, codec);
    const occupied = new Set<number>(itemInt.values());
    const maxInt = Math.max(1, ...itemInt.values());
    const optionCeil = Math.min(maxInt + 1, MAX_OPTION[req.kind]);
    const optionList: number[] = [];
    for (let n = 1; n <= optionCeil; n++) optionList.push(n);

    // Cascade-row placeholder: the kind's numbering sequence as a hint.
    const seqHint = `${codec.format(1)}, ${codec.format(2)}, ${codec.format(
      3
    )}…`;

    const status = validate(rows, req.items, itemInt);

    // Editing a row truncates everything downstream of it (those rows were
    // consequences of the now-stale value) and re-derives the cascade.
    const selectAt = (index: number, value: number) => {
      const base = rows
        .slice(0, index + 1)
        .map((r, i) => (i === index ? { ...r, draftInt: value } : r));
      setRows(buildCascade(base, req.items, itemInt));
    };

    const confirm = () => {
      if (!validate(rows, req.items, itemInt).ok) return;
      const edits = rows
        .filter((r) => r.draftInt != null && r.draftInt !== r.originalInt)
        .map((r) => ({
          id: r.id,
          newNumberToken: codec.format(r.draftInt as number),
        }));
      settle({ edits });
    };

    dialog = (
      <div
        className={cn(
          scoped ? "absolute" : "fixed",
          "inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Edit ID"
        onClick={() => settle(null)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl"
        >
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Edit ID
          </h3>

          {/* Shared grid so every row's pill column is the width of the
              widest pill, and the arrows + dropdowns line up vertically. */}
          <div className="mt-4 grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-2 gap-y-3">
            {rows.map((row, index) => (
              <Fragment key={row.id}>
                {/* Current ID pill (column 1 — stretches to the widest) */}
                <span className="flex h-7 items-center justify-center rounded border border-border bg-muted px-2 font-mono text-xs text-foreground">
                  {prefix}
                  {codec.format(row.originalInt)}
                </span>
                {/* Arrow (column 2) */}
                <span aria-hidden className="text-center text-muted-foreground">
                  →
                </span>
                {/* New ID: prefix for context + dropdown (column 3) */}
                <span className="flex items-center gap-1">
                  {prefix ? (
                    <span className="font-mono text-sm text-muted-foreground">
                      {prefix}
                    </span>
                  ) : null}
                  <NumberDropdown
                    value={row.draftInt}
                    placeholder={seqHint}
                    options={optionList}
                    occupied={(() => {
                      // Earlier rows have committed to a move, so their
                      // *original* letter is free from this row's POV. The
                      // user can pick it without a cascade.
                      const earlierOriginals = new Set(
                        rows.slice(0, index).map((r) => r.originalInt)
                      );
                      const filtered = new Set<number>();
                      for (const v of occupied) {
                        if (!earlierOriginals.has(v)) filtered.add(v);
                      }
                      return filtered;
                    })()}
                    invalid={status.invalidIds.has(row.id)}
                    codec={codec}
                    kindIcon={KIND_ICON[req.kind]}
                    onSelect={(n) => selectAt(index, n)}
                  />
                </span>
                {/* Name, inline (column 4) */}
                <span className="min-w-0 truncate text-xs italic text-muted-foreground">
                  {row.name}
                </span>
              </Fragment>
            ))}
          </div>

          <p
            className={cn(
              "mt-3 text-xs",
              status.tone === "error"
                ? "text-destructive"
                : status.tone === "ok"
                  ? "text-green-500"
                  : "text-muted-foreground"
            )}
          >
            {status.message}
          </p>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => settle(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!status.ok}
              onClick={confirm}
            >
              Confirm
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return { openRenumber, dialog };
}
