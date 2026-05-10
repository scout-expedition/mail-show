"use client";

// Leaf component for logic-kind documents. Mirrors text-block.tsx in
// drag/grip/delete chrome but renders a single Select whose options come
// from ENDING_LOGIC_RESULT_OPTIONS_BY_KIND for affinity kinds, or from
// the framework documents list for `framework_selection`.
//
// Edits flow through `onChange` like text-block — the shared editor's
// dirty plumbing observes the in-memory mutation and the UPDATE-only
// saveDocument flow persists it.
//
// Because BlockList's LeafComponents prop pins the component signature
// to `{ block, onChange, onDelete }`, the doc kind + framework option
// list are bound in by the `makeResultBlock` factory below — the editor
// builds one per logic doc.

import { useMemo, useRef, useTransition, type ComponentType } from "react";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { OverflowMenu } from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  AGGREGATE_OPTIONS_BY_REF,
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  formatRandomSubset,
  formatRemoveSentinel,
  parseRandomSubset,
  RANDOM_ALL_SENTINEL,
  RANDOM_REMAINING_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_SUBSET_SENTINEL_PREFIX,
  RANDOM_TIED_SENTINEL,
  type EndingLogicKind,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import type { BlockState } from "@/lib/endings/block-state";
import type { EndingDocument } from "@/lib/db/types";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { duplicateBlock } from "../_shared/document-actions";
import { DropLine } from "./text-block";

export type ResultOption = { value: string; label: string };

/** Marker value for the "Random (custom subset)" dropdown row. The
 *  picker rewrites this to a real subset sentinel once the user has
 *  toggled the framework checkboxes. */
const SUBSET_PICKER_VALUE = `${RANDOM_SUBSET_SENTINEL_PREFIX}__pending__`;

export function ResultBlock({
  block,
  options,
  /** Frameworks available for the custom-subset picker. Only used when
   *  `subsetEnabled` is true; ignored otherwise. */
  subsetFrameworks,
  subsetEnabled,
  onChange,
  onDelete,
}: {
  block: BlockState;
  options: ResultOption[];
  subsetFrameworks?: ResultOption[];
  subsetEnabled?: boolean;
  onChange: (result_value: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const [, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isDragging = drag.dragId === block.id;
  const targetBefore =
    drag.target?.kind === "near" &&
    drag.target.targetId === block.id &&
    drag.target.position === "before";
  const targetAfter =
    drag.target?.kind === "near" &&
    drag.target.targetId === block.id &&
    drag.target.position === "after";

  function nearTarget(e: React.DragEvent): DragTarget {
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return {
      kind: "near",
      parent_block_id: block.parent_block_id,
      parent_row_id: block.parent_row_id,
      targetId: block.id,
      position,
    };
  }

  const value = block.result_value ?? "";
  const isEmpty = value === "";
  const subset = subsetEnabled ? parseRandomSubset(value) : null;
  const isSubset = subset != null;
  // If the persisted value is no longer in the option list (e.g. a
  // framework was deleted), surface it as an "unknown" entry so the
  // author notices and re-picks. We never hide it silently. Subset
  // values render via their own virtual entry below.
  const valueKnown =
    isEmpty || isSubset || options.some((o) => o.value === value);

  // Subset count for the dropdown label. Frameworks no longer in the
  // available list (deleted) still count toward the stored size — the
  // user sees "(missing: …)" in the inline picker.
  const subsetSize = subset?.length ?? 0;
  const subsetTotal = subsetFrameworks?.length ?? 0;
  const subsetLabel = isSubset
    ? `Random (subset: ${subsetSize}${
        subsetTotal > 0 ? ` of ${subsetTotal}` : ""
      })`
    : "";

  function handleSelectChange(next: string) {
    if (next === SUBSET_PICKER_VALUE) {
      // Default subset = every available framework. Authors then
      // uncheck what they don't want. Empty subset is rejected by
      // server validation, so we never seed an empty list.
      const defaultIds = (subsetFrameworks ?? []).map((f) => f.value);
      if (defaultIds.length === 0) return; // no frameworks → nothing to pick
      onChange(formatRandomSubset(defaultIds));
      return;
    }
    onChange(next);
  }

  function toggleSubsetId(id: string) {
    if (!isSubset) return;
    const current = new Set(subset);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    if (current.size === 0) return; // never persist an empty subset
    // Preserve the order of subsetFrameworks so reordering frameworks
    // upstream doesn't churn the stored value.
    const ordered = (subsetFrameworks ?? [])
      .map((f) => f.value)
      .filter((id2) => current.has(id2));
    // Include any unknown ids (deleted frameworks) still in `current`
    // at the end — iterate `current`, not the pre-toggle `subset`,
    // otherwise an unchecked-then-removed id would be re-added here.
    for (const id2 of current) {
      if (!ordered.includes(id2)) ordered.push(id2);
    }
    onChange(formatRandomSubset(ordered));
  }

  return (
    <div ref={ref} className="relative flex flex-1 flex-col">
      <DropLine active={targetBefore} side="top" />
      <div
        ref={cardRef}
        onDragEnter={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag.dragId === block.id) return;
          drag.setTarget(nearTarget(e));
        }}
        onDragOver={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          if (drag.dragId === block.id) return;
          drag.setTarget(nearTarget(e));
        }}
        onDrop={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag.dragId === block.id) return;
          drag.commit();
        }}
        className={cn(
          "group/resultblock relative flex h-full min-h-full flex-1 items-stretch rounded-md border border-[var(--block-border)] transition-colors",
          isDragging && "opacity-40"
        )}
        style={{ backgroundColor: "var(--block-card)" }}
      >
        <span
          aria-hidden
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            drag.start(block.id, cardRef.current?.offsetHeight ?? 0);
            e.dataTransfer.effectAllowed = "move";
            if (cardRef.current) {
              const rect = cardRef.current.getBoundingClientRect();
              e.dataTransfer.setDragImage(
                cardRef.current,
                e.clientX - rect.left,
                e.clientY - rect.top
              );
            }
          }}
          className="flex w-6 shrink-0 cursor-grab items-start justify-center pt-[17px] text-muted-foreground/40 transition-opacity opacity-0 group-hover/resultblock:opacity-100"
        >
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 flex-col gap-2 py-2 pl-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
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
              {isEmpty ? (
                <option value="">— pick a result —</option>
              ) : null}
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
            <SubsetPicker
              frameworks={subsetFrameworks}
              selectedIds={subset!}
              onToggle={toggleSubsetId}
            />
          ) : null}
        </div>
        <div className="flex w-6 shrink-0 items-start justify-center pt-[12px]">
          <OverflowMenu
            items={[
              {
                label: "Duplicate Result Block",
                icon: <Copy size={10} aria-hidden />,
                onClick: () => {
                  startTransition(async () => {
                    await duplicateBlock({ id: block.id });
                  });
                },
              },
              {
                label: "Delete Result Block",
                intent: "destructive",
                icon: <Trash2 size={10} aria-hidden />,
                onClick: async () => {
                  const ok = await confirm({
                    title: "Delete result block?",
                    message: "This can't be undone.",
                    confirmLabel: "Delete",
                    intent: "destructive",
                  });
                  if (ok) onDelete();
                },
              },
            ]}
          />
        </div>
      </div>
      <DropLine active={targetAfter} side="bottom" />
      {confirmDialog}
    </div>
  );
}

/**
 * Build a `ResultBlock` component pre-configured with the option list
 * for a particular logic-doc kind. Returns `{ Component, defaultValue }`
 * — `defaultValue` is the value to seed when the user clicks "+ result"
 * in the block list (null means there are no options yet, e.g.
 * framework_selection with zero frameworks; the adder is disabled in
 * that case).
 *
 * Pass the `frameworks` array when `kind === 'framework_selection'` so
 * the picker can show framework names. For affinity kinds the options
 * are derived from `ENDING_LOGIC_RESULT_OPTIONS_BY_KIND` and
 * `frameworks` is ignored.
 */
export function makeResultBlock(
  kind: EndingLogicKind,
  frameworks: EndingDocument[]
): {
  Component: ComponentType<{
    block: BlockState;
    onChange: (result_value: string) => void;
    onDelete: () => void;
  }>;
  defaultValue: string | null;
} {
  const baseOptions: ResultOption[] = (() => {
    const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[kind];
    if (allowed) {
      return allowed.map((v) => ({
        value: v,
        // VARIABLE_LABELS maps the impact-column raw name (proletariat,
        // gentry, folos, …) to its user-facing label (Working Class,
        // Upper Class, Folos, …). Fall back to the raw value for any
        // entry the map doesn't know about.
        label: (VARIABLE_LABELS as Record<string, string>)[v] ?? v,
      }));
    }
    // framework_selection — options are framework documents.
    return frameworks
      .filter((f) => f.kind === "framework")
      .map((f) => ({ value: f.id, label: f.name ?? "(unnamed)" }));
  })();
  // Random options sit at the end. Nation affinity (5-way tiebreak)
  // distinguishes "tied only" from "all". Class affinity (2-way, every
  // tie is the full set) collapses to a single "Random" since the two
  // would behave identically. Framework_selection offers "Random (any
  // framework)" — random of all today; custom subset is a followup.
  const randomOptions: ResultOption[] = (() => {
    if (kind === "nation_affinity_top" || kind === "nation_affinity_bottom") {
      // Set-narrowing: emit one "Remove …" entry per nation alongside
      // the random sentinels. Authors pick a removal as a row's leaf
      // when they want the doc to drop a nation from the working set
      // and keep evaluating instead of returning a definite answer.
      const removeOptions: ResultOption[] = AGGREGATE_OPTIONS_BY_REF.nation_affinity.map(
        (n) => ({
          value: formatRemoveSentinel(n),
          label: `Remove ${
            (VARIABLE_LABELS as Record<string, string>)[n] ?? n
          }`,
        })
      );
      return [
        ...removeOptions,
        { value: RANDOM_TIED_SENTINEL, label: "Random (between tied)" },
        {
          value: RANDOM_REMAINING_SENTINEL,
          label: "Random (between remaining)",
        },
        { value: RANDOM_ALL_SENTINEL, label: "Random (between all)" },
      ];
    }
    if (kind === "class_affinity_top") {
      return [
        // Legacy alias keeps existing rows working without an in-place
        // migration.
        { value: RANDOM_RESULT_SENTINEL, label: "Random" },
      ];
    }
    // framework_selection
    return [
      { value: RANDOM_ALL_SENTINEL, label: "Random (any framework)" },
    ];
  })();
  const options: ResultOption[] = [...baseOptions, ...randomOptions];

  // Custom-subset random is only meaningful for framework_selection.
  // The picker reads from `subsetFrameworks`; the dropdown shows
  // "Random (custom subset)…" only when this flag is on.
  const subsetEnabled = kind === "framework_selection";
  const subsetFrameworks: ResultOption[] | undefined = subsetEnabled
    ? frameworks
        .filter((f) => f.kind === "framework")
        .map((f) => ({ value: f.id, label: f.name ?? "(unnamed)" }))
    : undefined;

  function ConfiguredResultBlock(props: {
    block: BlockState;
    onChange: (result_value: string) => void;
    onDelete: () => void;
  }) {
    // Memoize the option list per render to keep stable references for
    // <option> map keys; the captured `options` is already stable across
    // makeResultBlock calls so this is mostly belt-and-braces.
    const memoOptions = useMemo(() => options, []);
    const memoSubset = useMemo(() => subsetFrameworks, []);
    return (
      <ResultBlock
        options={memoOptions}
        subsetFrameworks={memoSubset}
        subsetEnabled={subsetEnabled}
        {...props}
      />
    );
  }
  ConfiguredResultBlock.displayName = `ResultBlock(${kind})`;
  return {
    Component: ConfiguredResultBlock,
    defaultValue: options[0]?.value ?? null,
  };
}

function SubsetPicker({
  frameworks,
  selectedIds,
  onToggle,
}: {
  frameworks: ResultOption[];
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
