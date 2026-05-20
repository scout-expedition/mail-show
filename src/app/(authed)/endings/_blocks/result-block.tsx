"use client";

// Leaf component for logic-kind documents. Mirrors text-block.tsx in
// drag/grip/delete chrome but renders a single Select whose options come
// from ENDING_LOGIC_RESULT_OPTIONS_BY_KIND for affinity kinds, or from
// the framework documents list for `framework_selection`.
//
// result_value autosaves through its own useInstantField + patchBlock —
// each Select change commits in 400ms (or immediately on blur).
//
// Because BlockList's LeafComponents prop pins the component signature
// to `{ block, onDelete }`, the doc kind + framework option list are
// bound in by the `makeResultBlock` factory below — the editor builds
// one per logic doc.

import { useMemo, useRef, useState, type ComponentType } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { patchBlock } from "../_shared/document-actions";
import { DropLine } from "./text-block";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { SubsetPills } from "./subset-pills";

export type ResultOption = { value: string; label: string };

/** Marker value for the "Random (subset)" dropdown row. The picker
 *  rewrites this to a real subset sentinel once the user has toggled
 *  the framework pills. */
const SUBSET_PICKER_VALUE = `${RANDOM_SUBSET_SENTINEL_PREFIX}__pending__`;

export function ResultBlock({
  block,
  options,
  /** Frameworks available for the custom-subset picker. Only used when
   *  `subsetEnabled` is true; ignored otherwise. */
  subsetFrameworks,
  subsetEnabled,
  /** "text" → free-text result (smart_variable docs). "dropdown" (default)
   *  → the existing Select chrome backed by `options`. */
  mode = "dropdown",
  /** Placeholder shown in text-mode when the field is empty. */
  textPlaceholder,
  onDelete,
}: {
  block: BlockState;
  options: ResultOption[];
  subsetFrameworks?: ResultOption[];
  subsetEnabled?: boolean;
  mode?: "dropdown" | "text";
  textPlaceholder?: string;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { peers, setFocus } = usePresenceContext();
  // Local working copy of the subset selection while editing. null =
  // not editing (picker reflects the saved value); a non-null array
  // (including []) drives the picker, so the selection can sit at zero
  // — an empty subset can't be persisted, so it just isn't saved —
  // until the author picks at least one framework.
  const [subsetDraft, setSubsetDraft] = useState<string[] | null>(null);

  // result_value autosaves through patchBlock. The Select fires on every
  // option change, so commit + blur-flush both reach the server cleanly.
  // Server validates against the doc's kind; on reject, useInstantField
  // flips to "error" and reverts to the server value.
  const resultField = useInstantField<string>({
    value: block.result_value ?? "",
    onCommit: (v) => patchBlock(block.id, { result_value: v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "ending_blocks", recordId: block.id, field: "result_value" }
          : null
      ),
  });
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
    const rect = (cardRef.current ?? e.currentTarget).getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return {
      kind: "near",
      parent_block_id: block.parent_block_id,
      parent_row_id: block.parent_row_id,
      targetId: block.id,
      position,
    };
  }

  const value = resultField.value;
  const isEmpty = value === "";
  const subset = subsetEnabled ? parseRandomSubset(value) : null;
  const isSubset = subset != null;
  // Show the pill picker for a persisted subset OR a fresh draft.
  const showSubsetPicker = isSubset || subsetDraft != null;
  // Pills reflect the local draft while editing, else the saved subset.
  const subsetSelected = subsetDraft ?? subset ?? [];
  // If the persisted value is no longer in the option list (e.g. a
  // framework was deleted), surface it as an "unknown" entry so the
  // author notices and re-picks. We never hide it silently. Subset
  // values render via their own virtual entry below.
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
    // Preserve the order of subsetFrameworks so reordering frameworks
    // upstream doesn't churn the stored value; append any unknown
    // (deleted) ids still selected at the end.
    const ordered = (subsetFrameworks ?? [])
      .map((f) => f.value)
      .filter((id2) => current.has(id2));
    for (const id2 of current) {
      if (!ordered.includes(id2)) ordered.push(id2);
    }
    // Always mirror the selection in the local draft — a zero-length
    // set stays at zero (an empty subset isn't persistable). Persist
    // only when at least one framework is selected.
    setSubsetDraft(ordered);
    if (ordered.length > 0) resultField.set(formatRandomSubset(ordered));
  }

  const dragFocusKey = {
    table: "ending_blocks",
    recordId: block.id,
    field: "drag",
  } as const;

  return (
    <div
      ref={ref}
      // Drop handlers on the outer wrapper, not the card: the wrapper
      // still stretches to the full condition-row slot while the card
      // inside is compact, so the whole slot stays a valid drop target.
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
      className="relative flex flex-1 flex-col"
    >
      <DropLine active={targetBefore} side="top" />
      <FieldHighlight
        peers={peers}
        focusKey={dragFocusKey}
        className="flex flex-1 flex-col"
      >
      <div
        ref={cardRef}
        className={cn(
          "group/resultblock relative flex items-stretch rounded-md border border-[var(--block-border)] transition-colors",
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
          className="flex w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 transition-opacity opacity-0 group-hover/resultblock:opacity-100"
        >
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 flex-col gap-2 py-1.5 pl-2 pr-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
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
              {mode === "text" ? (
                <Input
                  type="text"
                  value={value}
                  onChange={(e) => resultField.set(e.target.value)}
                  onFocus={resultField.onFocus}
                  onBlur={resultField.onBlur}
                  placeholder={textPlaceholder ?? "Result…"}
                  style={{ backgroundColor: "var(--block-result-bg)" }}
                  className={cn(
                    "h-8 w-auto min-w-[200px] border-transparent shadow-none focus:border-border focus-visible:shadow-sm",
                    isEmpty &&
                      "ring-2 ring-warning/60 bg-warning/10 text-warning-foreground",
                    resultField.status === "error" && "ring-2 ring-destructive"
                  )}
                />
              ) : (
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
                  <option value={SUBSET_PICKER_VALUE}>Random (subset)</option>
                ) : null}
                </Select>
              )}
            </FieldHighlight>
            <div className="ml-auto shrink-0">
              <OverflowMenu
                items={[
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
          {showSubsetPicker && subsetFrameworks ? (
            <SubsetPills
              frameworks={subsetFrameworks}
              selectedIds={subsetSelected}
              onToggle={toggleSubsetId}
            />
          ) : null}
        </div>
      </div>
      </FieldHighlight>
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
  // would behave identically. Framework_selection offers "Random (any)"
  // plus the custom-subset picker (see `subsetEnabled` below).
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
        { value: RANDOM_REMAINING_SENTINEL, label: "Random (remaining)" },
        { value: RANDOM_TIED_SENTINEL, label: "Random (tied)" },
        { value: RANDOM_ALL_SENTINEL, label: "Random (all)" },
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
    return [{ value: RANDOM_ALL_SENTINEL, label: "Random (any)" }];
  })();
  const options: ResultOption[] = [...baseOptions, ...randomOptions];

  // Custom-subset random is only meaningful for framework_selection.
  // The picker reads from `subsetFrameworks`; the dropdown shows
  // "Random (subset)" only when this flag is on.
  const subsetEnabled = kind === "framework_selection";
  const subsetFrameworks: ResultOption[] | undefined = subsetEnabled
    ? frameworks
        .filter((f) => f.kind === "framework")
        .map((f) => ({ value: f.id, label: f.name ?? "(unnamed)" }))
    : undefined;

  function ConfiguredResultBlock(props: {
    block: BlockState;
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

/**
 * `ResultBlock` factory for smart_variable documents. The result is a
 * free-text string (no dropdown, no subset picker), so the factory just
 * pre-binds mode='text' and an empty option list. `defaultValue` is the
 * empty string so a freshly-added result block starts with a focus-able
 * input rather than blocked-on-pick warning chrome.
 */
export function makeSmartVariableResultBlock(): {
  Component: ComponentType<{
    block: BlockState;
    onDelete: () => void;
  }>;
  defaultValue: string | null;
} {
  function SmartVariableResultBlock(props: {
    block: BlockState;
    onDelete: () => void;
  }) {
    return (
      <ResultBlock
        options={[]}
        mode="text"
        textPlaceholder="Result value…"
        {...props}
      />
    );
  }
  SmartVariableResultBlock.displayName = "ResultBlock(smart_variable)";
  return { Component: SmartVariableResultBlock, defaultValue: "" };
}
