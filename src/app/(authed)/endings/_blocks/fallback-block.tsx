"use client";

import { GripVertical } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState } from "@/lib/endings/block-state";

export type FallbackOption = { value: string; label: string };

/**
 * Pinned at the bottom of a logic document. Returns the configured
 * fallback value when the rest of the chip-row tree above doesn't
 * resolve to a result. Cannot be deleted, moved, or sit alongside
 * other fallback blocks (DB partial unique enforces one per doc).
 *
 * Caller supplies `options` based on the doc's kind:
 *   - framework_selection → list of framework documents.
 *   - class_affinity_top  → ['proletariat','gentry'] mapped through
 *                            VARIABLE_LABELS.
 *
 * `helperText` is the one-liner under the label ("If nothing above
 * resolves to a framework, return this one.", or analogous wording
 * per kind).
 *
 * Outer chrome is a 3-column grid (matching condition blocks at root)
 * so the inner result-styled picker's arrow lines up with where a
 * result block's arrow falls inside a condition row.
 */
export function FallbackBlock({
  block,
  options,
  helperText,
  emptyLabel,
  onChange,
}: {
  block: BlockState;
  options: FallbackOption[];
  helperText: string;
  emptyLabel: string;
  onChange: (result_value: string | null) => void;
}) {
  const value = block.result_value ?? "";
  const isEmpty = value === "";
  const valueKnown = isEmpty || options.some((o) => o.value === value);

  return (
    <section className="mt-4 grid grid-cols-[minmax(160px,260px)_1fr_auto] gap-2 rounded-md border border-dashed border-border bg-muted/20 p-2">
      <div className="self-start">
        <Label className="mb-1 block text-[11px] uppercase tracking-wide">
          Fallback ending
        </Label>
        <p className="text-[11px] text-muted-foreground">{helperText}</p>
      </div>
      <div className="relative flex items-start gap-1 rounded-md border border-transparent bg-card transition-colors hover:border-border">
        <span aria-hidden className="invisible mt-2">
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 items-center gap-2 py-1">
          <span
            aria-hidden
            className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70"
          >
            →
          </span>
          <Select
            value={value}
            onChange={(e) => onChange(e.target.value || null)}
            className={cn(
              "ml-auto h-8 w-auto min-w-[200px]",
              GHOST_FIELD,
              isEmpty &&
                "ring-2 ring-warning/60 bg-warning/10 text-warning-foreground"
            )}
          >
            {isEmpty ? <option value="">{emptyLabel}</option> : null}
            {!isEmpty && !valueKnown ? (
              <option value={value}>(unknown: {value})</option>
            ) : null}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </section>
  );
}
