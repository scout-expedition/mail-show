"use client";

import { GripVertical } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  formatRandomSubset,
  parseRandomSubset,
  RANDOM_SUBSET_SENTINEL_PREFIX,
} from "@/lib/db/enums";
import type { BlockState } from "@/lib/endings/block-state";

export type FallbackOption = { value: string; label: string };

/** Marker value for the "Random (custom subset)" dropdown row. The
 *  picker rewrites this to a real subset sentinel once the user has
 *  toggled the framework checkboxes. Mirrors result-block.tsx. */
const SUBSET_PICKER_VALUE = `${RANDOM_SUBSET_SENTINEL_PREFIX}__pending__`;

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
  subsetFrameworks,
  subsetEnabled,
  helperText,
  emptyLabel,
  title,
  onChange,
}: {
  block: BlockState;
  options: FallbackOption[];
  /** Frameworks available for the custom-subset picker. Only used when
   *  `subsetEnabled` is true; ignored otherwise. */
  subsetFrameworks?: FallbackOption[];
  subsetEnabled?: boolean;
  helperText: string;
  emptyLabel: string;
  /** Header label on the panel. Defaults to "Fallback ending". */
  title?: string;
  onChange: (result_value: string | null) => void;
}) {
  const value = block.result_value ?? "";
  const isEmpty = value === "";
  const subset = subsetEnabled ? parseRandomSubset(value) : null;
  const isSubset = subset != null;
  const valueKnown =
    isEmpty || isSubset || options.some((o) => o.value === value);

  const subsetSize = subset?.length ?? 0;
  const subsetTotal = subsetFrameworks?.length ?? 0;
  const subsetLabel = isSubset
    ? `Random (subset: ${subsetSize}${
        subsetTotal > 0 ? ` of ${subsetTotal}` : ""
      })`
    : "";

  function handleSelectChange(next: string) {
    if (next === SUBSET_PICKER_VALUE) {
      const defaultIds = (subsetFrameworks ?? []).map((f) => f.value);
      if (defaultIds.length === 0) return;
      onChange(formatRandomSubset(defaultIds));
      return;
    }
    onChange(next || null);
  }

  function toggleSubsetId(id: string) {
    if (!isSubset) return;
    const current = new Set(subset);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    if (current.size === 0) return;
    const ordered = (subsetFrameworks ?? [])
      .map((f) => f.value)
      .filter((id2) => current.has(id2));
    for (const id2 of current) {
      if (!ordered.includes(id2)) ordered.push(id2);
    }
    onChange(formatRandomSubset(ordered));
  }

  return (
    <section className="mt-4 grid grid-cols-[minmax(160px,260px)_1fr_auto] gap-2 rounded-md border border-dashed border-border bg-muted/20 p-2">
      <div className="self-start">
        <Label className="mb-1 block text-[11px] uppercase tracking-wide">
          {title ?? "Fallback ending"}
        </Label>
        <p className="text-[11px] text-muted-foreground">{helperText}</p>
      </div>
      <div
        className="relative flex items-start gap-0.5 rounded-md border border-[var(--block-border)] px-0.5 py-1"
        style={{ backgroundColor: "var(--block-card)" }}
      >
        <span aria-hidden className="invisible mt-1">
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70"
            >
              →
            </span>
            <Select
              value={isSubset ? SUBSET_PICKER_VALUE : value}
              onChange={(e) => handleSelectChange(e.target.value)}
              style={{ backgroundColor: "var(--block-result-bg)" }}
              className={cn(
                "h-8 w-auto min-w-[200px] border-transparent shadow-none focus:border-border focus-visible:shadow-sm",
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
              {subsetEnabled && (subsetFrameworks?.length ?? 0) > 0 ? (
                <option value={SUBSET_PICKER_VALUE}>
                  {isSubset ? subsetLabel : "Random (custom subset)…"}
                </option>
              ) : null}
            </Select>
          </div>
          {isSubset && subsetFrameworks ? (
            <FallbackSubsetPicker
              frameworks={subsetFrameworks}
              selectedIds={subset!}
              onToggle={toggleSubsetId}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function FallbackSubsetPicker({
  frameworks,
  selectedIds,
  onToggle,
}: {
  frameworks: FallbackOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const selectedSet = new Set(selectedIds);
  const known = new Set(frameworks.map((f) => f.value));
  const missing = selectedIds.filter((id) => !known.has(id));
  return (
    <div
      className="ml-4 grid grid-cols-1 gap-1 rounded-md border border-transparent p-2 sm:grid-cols-2"
      style={{ backgroundColor: "var(--block-result-bg)" }}
    >
      {frameworks.length === 0 ? (
        <p className="col-span-full text-[11px] italic text-muted-foreground">
          No frameworks available.
        </p>
      ) : null}
      {frameworks.map((f) => {
        const checked = selectedSet.has(f.value);
        const disable = checked && selectedIds.length === 1;
        return (
          <label
            key={f.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/30",
              disable && "cursor-not-allowed opacity-60"
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disable}
              onChange={() => onToggle(f.value)}
              className="h-3 w-3"
            />
            <span className="truncate">{f.label}</span>
          </label>
        );
      })}
      {missing.map((id) => (
        <label
          key={id}
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-warning-foreground hover:bg-warning/10"
        >
          <input
            type="checkbox"
            checked
            onChange={() => onToggle(id)}
            className="h-3 w-3"
          />
          <span className="truncate">(missing framework: {id})</span>
        </label>
      ))}
    </div>
  );
}
