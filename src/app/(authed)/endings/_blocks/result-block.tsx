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

import { useMemo, useRef, type ComponentType } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  type EndingLogicKind,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import type { BlockState } from "@/lib/endings/block-state";
import type { EndingDocument } from "@/lib/db/types";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { DropLine } from "./text-block";

export type ResultOption = { value: string; label: string };

export function ResultBlock({
  block,
  options,
  onChange,
  onDelete,
}: {
  block: BlockState;
  options: ResultOption[];
  onChange: (result_value: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
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
  // If the persisted value is no longer in the option list (e.g. a
  // framework was deleted), surface it as an "unknown" entry so the
  // author notices and re-picks. We never hide it silently.
  const valueKnown = isEmpty || options.some((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
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
          "group/resultblock relative flex items-start gap-1 rounded-md border border-transparent bg-card transition-colors hover:border-border",
          isDragging && "opacity-40"
        )}
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
          className="mt-2 cursor-grab text-muted-foreground/40 transition-opacity opacity-0 group-hover/resultblock:opacity-100"
        >
          <GripVertical size={14} />
        </span>
        <div className="flex flex-1 items-center gap-2 py-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            →
          </span>
          <Select
            value={valueKnown ? value : value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "ml-auto h-8 w-auto min-w-[200px]",
              GHOST_FIELD,
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
          </Select>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete block"
          title="Delete block"
          className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-opacity opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover/resultblock:opacity-100"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      <DropLine active={targetAfter} side="bottom" />
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
  const options: ResultOption[] = (() => {
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

  function ConfiguredResultBlock(props: {
    block: BlockState;
    onChange: (result_value: string) => void;
    onDelete: () => void;
  }) {
    // Memoize the option list per render to keep stable references for
    // <option> map keys; the captured `options` is already stable across
    // makeResultBlock calls so this is mostly belt-and-braces.
    const memoOptions = useMemo(() => options, []);
    return <ResultBlock options={memoOptions} {...props} />;
  }
  ConfiguredResultBlock.displayName = `ResultBlock(${kind})`;
  return {
    Component: ConfiguredResultBlock,
    defaultValue: options[0]?.value ?? null,
  };
}
