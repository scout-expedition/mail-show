"use client";

import { useState } from "react";
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
import { patchBlock } from "../_shared/document-actions";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { SubsetPills } from "./subset-pills";

export type FallbackOption = { value: string; label: string };

/** Marker value for the "Random (subset)" dropdown row. The picker
 *  rewrites this to a real subset sentinel once the user has toggled
 *  the framework pills. Mirrors result-block.tsx. */
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
}) {
  const { peers, setFocus } = usePresenceContext();
  // Fallback result_value autosaves through patchBlock. Empty-string is
  // stored as null so the column reflects "no fallback set".
  const resultField = useInstantField<string>({
    value: block.result_value ?? "",
    onCommit: (v) =>
      patchBlock(block.id, { result_value: v === "" ? null : v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "ending_blocks", recordId: block.id, field: "result_value" }
          : null
      ),
  });
  // Local working copy of the subset selection while editing. null =
  // not editing (picker reflects the saved value); a non-null array
  // (including []) drives the picker, so the selection can sit at zero
  // until the author picks at least one framework.
  const [subsetDraft, setSubsetDraft] = useState<string[] | null>(null);
  const value = resultField.value;
  const isEmpty = value === "";
  const subset = subsetEnabled ? parseRandomSubset(value) : null;
  const isSubset = subset != null;
  const showSubsetPicker = isSubset || subsetDraft != null;
  const subsetSelected = subsetDraft ?? subset ?? [];
  const valueKnown =
    isEmpty || isSubset || options.some((o) => o.value === value);

  function handleSelectChange(next: string) {
    if (next === SUBSET_PICKER_VALUE) {
      // Open the picker empty; nothing is persisted until a pill is on.
      setSubsetDraft([]);
      return;
    }
    setSubsetDraft(null);
    resultField.set(next);
  }

  function toggleSubsetId(id: string) {
    const current = new Set(subsetDraft ?? subset ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const ordered = (subsetFrameworks ?? [])
      .map((f) => f.value)
      .filter((id2) => current.has(id2));
    for (const id2 of current) {
      if (!ordered.includes(id2)) ordered.push(id2);
    }
    // Mirror the selection locally; an empty set stays empty (not
    // persistable) — persist only with at least one framework.
    setSubsetDraft(ordered);
    if (ordered.length > 0) resultField.set(formatRandomSubset(ordered));
  }

  return (
    <section className="mt-4 grid grid-cols-[minmax(120px,160px)_1fr_auto] gap-x-0 rounded-md border border-dashed border-border bg-muted/20 p-2">
      <div className="self-start pr-3">
        <Label className="mb-1 block text-[11px] uppercase tracking-wide">
          {title ?? "Fallback ending"}
        </Label>
        <p className="text-[11px] text-muted-foreground">{helperText}</p>
      </div>
      <div
        className="relative flex items-center self-start rounded-md border border-[var(--block-border)]"
        style={{ backgroundColor: "var(--block-card)" }}
      >
        {/* Invisible grip — width matches a result block's drag handle
            so the arrow + dropdown line up with one inside a row. */}
        <span aria-hidden className="invisible w-6 shrink-0">
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 flex-col gap-2 py-1.5 pl-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70"
            >
              →
            </span>
            <FieldHighlight
              peers={peers}
              focusKey={{
                table: "ending_blocks",
                recordId: block.id,
                field: "result_value",
              }}
            >
              <Select
                value={showSubsetPicker ? SUBSET_PICKER_VALUE : value}
                onChange={(e) => handleSelectChange(e.target.value)}
                onFocus={resultField.onFocus}
                onBlur={resultField.onBlur}
                style={{ backgroundColor: "var(--block-result-bg)" }}
                className={cn(
                  "h-8 w-auto min-w-[200px] border-transparent shadow-none focus:border-border focus-visible:shadow-sm",
                  isEmpty &&
                    !showSubsetPicker &&
                    "ring-2 ring-warning/60 bg-warning/10 text-warning-foreground",
                  resultField.status === "error" && "ring-2 ring-destructive"
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
                  <option value={SUBSET_PICKER_VALUE}>Random (subset)</option>
                ) : null}
              </Select>
            </FieldHighlight>
          </div>
          {showSubsetPicker && subsetFrameworks ? (
            <SubsetPills
              frameworks={subsetFrameworks}
              selectedIds={subsetSelected}
              onToggle={toggleSubsetId}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
