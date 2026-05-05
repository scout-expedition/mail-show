"use client";

import { GripVertical } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState } from "@/lib/endings/block-state";
import type { EndingDocument } from "@/lib/db/types";

/**
 * Pinned at the bottom of the framework_selection document. Returns the
 * configured framework when the rest of the logic flow above doesn't end
 * in a result. Cannot be deleted, moved, or sit alongside other fallback
 * blocks (DB partial unique enforces one per document).
 *
 * Outer chrome is a 3-column grid (same shape as a condition block at
 * root) so the inner result-styled picker's arrow lines up with where a
 * result block's arrow falls inside a condition row's content column.
 * The grip placeholder inside the inner row keeps the same offset
 * result-block.tsx uses for its grip.
 */
export function FallbackBlock({
  block,
  frameworks,
  onChange,
}: {
  block: BlockState;
  frameworks: EndingDocument[];
  onChange: (result_value: string | null) => void;
}) {
  const frameworkDocs = frameworks.filter((f) => f.kind === "framework");
  const value = block.result_value ?? "";
  const isEmpty = value === "";
  const valueKnown =
    isEmpty || frameworkDocs.some((f) => f.id === value);

  return (
    <section className="mt-4 grid grid-cols-[minmax(160px,260px)_1fr_auto] gap-2 rounded-md border border-dashed border-border bg-muted/20 p-2">
      <div className="self-start">
        <Label className="mb-1 block text-[11px] uppercase tracking-wide">
          Fallback ending
        </Label>
        <p className="text-[11px] text-muted-foreground">
          If nothing above resolves to a framework, return this one.
        </p>
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
            {isEmpty ? <option value="">— pick a framework —</option> : null}
            {!isEmpty && !valueKnown ? (
              <option value={value}>(unknown: {value})</option>
            ) : null}
            {frameworkDocs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name ?? "(unnamed)"}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </section>
  );
}
