"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-dialog";
import {
  GHOST_FIELD,
  PanelHeader,
  SaveRevert,
} from "@/components/panel";
import { cn } from "@/lib/utils";
import type {
  EndingConditionRow,
  EndingConditionRowChip,
  EndingFramework,
  EndingFrameworkBlock,
  EndingVariable,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import {
  buildByParentBlock,
  buildChipsByRow,
  buildRowsByConditionBlock,
  type BlockState,
  type ChipState,
  type RowState,
  type VariableState,
} from "@/lib/endings/block-state";
import {
  AGGREGATE_CHIP_COLORS,
  IMPACT_CHIP_COLORS,
} from "@/lib/endings/impact-colors";
import { AGGREGATE_OPTIONS_BY_REF } from "@/lib/db/enums";
import { EMPTY_SELECTIONS, type PreviewSelections } from "@/lib/endings/evaluator";
import { BlockList } from "./blocks/block-list";
import { PreviewView } from "./preview-view";
import {
  DragCtx,
  moveBlock,
  type DragContext,
  type DragTarget,
} from "./lib/drag";
import { PickerCtx, type PickerContext } from "./lib/picker";
import { deleteEndingFramework, saveFramework } from "./actions";

export type EditorHandle = {
  dirty: boolean;
  save: () => Promise<void>;
};

export function FrameworkEditor({
  framework,
  blocks,
  rows,
  chips,
  variables,
  values,
  nations,
  onDeleted,
  registerHandle,
}: {
  framework: EndingFramework;
  blocks: EndingFrameworkBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  nations: Pick<Nation, "name" | "color_hex">[];
  onDeleted: () => void;
  registerHandle: (h: EditorHandle) => void;
}) {
  const initial = useMemo(
    () => ({
      name: framework.name,
      blocks: blocks.map(
        (b): BlockState => ({
          id: b.id,
          framework_id: b.framework_id,
          parent_block_id: b.parent_block_id,
          parent_row_id: b.parent_row_id,
          block_type: b.block_type,
          text: b.text,
          sort_order: b.sort_order,
        })
      ),
      rows: rows.map(
        (r): RowState => ({
          id: r.id,
          condition_block_id: r.condition_block_id,
          sort_order: r.sort_order,
        })
      ),
      chips: chips.map(
        (c): ChipState => ({
          id: c.id,
          row_id: c.row_id,
          variable_id: c.variable_id,
          operator: c.operator,
          text_value_id: c.text_value_id,
          number_value: c.number_value,
          aggregate_value: c.aggregate_value,
          sort_order: c.sort_order,
        })
      ),
    }),
    [framework.name, blocks, rows, chips]
  );

  const [name, setName] = useState(initial.name);
  const [blockState, setBlockState] = useState<BlockState[]>(initial.blocks);
  const [rowState, setRowState] = useState<RowState[]>(initial.rows);
  const [chipState, setChipState] = useState<ChipState[]>(initial.chips);
  const [dirty, setDirty] = useState(false);
  const [pending, startSave] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [target, setTargetState] = useState<DragTarget | null>(null);

  // Refs mirror state so window-level listeners (whose closures are
  // captured at mount) can read the latest values.
  const dragIdRef = useRef<string | null>(null);
  const targetRef = useRef<DragTarget | null>(null);
  dragIdRef.current = dragId;
  targetRef.current = target;

  const [previewOn, setPreviewOn] = useState(false);
  const [previewSelections, setPreviewSelections] =
    useState<PreviewSelections>(EMPTY_SELECTIONS);

  // Reconcile incoming server state with local edits.
  useEffect(() => {
    if (!dirty) {
      setName(initial.name);
      setBlockState(initial.blocks);
      setRowState(initial.rows);
      setChipState(initial.chips);
      return;
    }
    // Drop locally-deleted ids; fold in server-only additions; preserve
    // local edits to ids the server still has.
    setBlockState((prev) =>
      mergeServer(prev, initial.blocks, (a, b) => a.id === b.id)
    );
    setRowState((prev) =>
      mergeServer(prev, initial.rows, (a, b) => a.id === b.id)
    );
    setChipState((prev) =>
      mergeServer(prev, initial.chips, (a, b) => a.id === b.id)
    );
  }, [initial, dirty]);

  // Open chip-picker count — Save is disabled while any picker is mid-pick
  // so authors can't lose a half-built chip by clicking Save before ✓.
  const [openPickerCount, setOpenPickerCount] = useState(0);
  const pickerCtx: PickerContext = useMemo(
    () => ({
      openCount: openPickerCount,
      register: () => setOpenPickerCount((n) => n + 1),
      unregister: () => setOpenPickerCount((n) => Math.max(0, n - 1)),
    }),
    [openPickerCount]
  );

  // Resolve the chip color override for each variable: impact map for
  // class/world_status/demerits, nations.color_hex by name match for
  // nation-affinity, else null (chip uses the palette).
  const nationColorByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nations) m.set(n.name.toLowerCase(), n.color_hex);
    return m;
  }, [nations]);

  // Indexed views.
  const variableState: VariableState[] = useMemo(
    () =>
      variables.map((v) => {
        let color_hex: string | null = null;
        if (v.kind === "number_ref" && v.number_ref) {
          color_hex =
            IMPACT_CHIP_COLORS[v.number_ref] ??
            nationColorByName.get(v.name.toLowerCase()) ??
            null;
        } else if (v.kind === "aggregate_ref" && v.aggregate_ref) {
          color_hex = AGGREGATE_CHIP_COLORS[v.aggregate_ref] ?? null;
        }
        return {
          id: v.id,
          name: v.name,
          kind: v.kind,
          number_ref: v.number_ref,
          aggregate_ref:
            v.aggregate_ref === "class_affinity" ||
            v.aggregate_ref === "nation_affinity"
              ? v.aggregate_ref
              : null,
          default_value_id: v.default_value_id,
          color_index: v.color_index,
          color_hex,
          sort_order: v.sort_order,
        };
      }),
    [variables, nationColorByName]
  );
  const variableIndex = useMemo(() => {
    const m = new Map<string, VariableState>();
    for (const v of variableState) m.set(v.id, v);
    return m;
  }, [variableState]);
  const byParent = useMemo(() => buildByParentBlock(blockState), [blockState]);
  const rowsByConditionBlock = useMemo(
    () => buildRowsByConditionBlock(rowState),
    [rowState]
  );
  const chipsByRow = useMemo(() => buildChipsByRow(chipState), [chipState]);

  // Variables actually referenced by any chip (for the preview UI).
  // Aggregate variables expand into their underlying number_ref scores
  // so the preview surfaces inputs for, e.g., proletariat + gentry when a
  // Class Affinity chip is in play.
  const referencedVariables = useMemo(() => {
    const ids = new Set<string>();
    for (const c of chipState) ids.add(c.variable_id);
    const numberRefByName = new Map<string, VariableState>();
    for (const v of variableState) {
      if (v.kind === "number_ref" && v.number_ref) {
        numberRefByName.set(v.number_ref, v);
      }
    }
    for (const v of variableState) {
      if (!ids.has(v.id)) continue;
      if (v.kind !== "aggregate_ref" || !v.aggregate_ref) continue;
      for (const col of AGGREGATE_OPTIONS_BY_REF[v.aggregate_ref]) {
        const underlying = numberRefByName.get(col);
        if (underlying) ids.add(underlying.id);
      }
    }
    return variableState.filter((v) => ids.has(v.id));
  }, [chipState, variableState]);

  // Seed preview selection defaults when the referenced set changes.
  useEffect(() => {
    setPreviewSelections((prev) => {
      const next: PreviewSelections = {
        textValueIds: { ...prev.textValueIds },
        numbers: { ...prev.numbers },
      };
      for (const v of referencedVariables) {
        if (v.kind === "text" && next.textValueIds[v.id] === undefined) {
          next.textValueIds[v.id] = v.default_value_id ?? null;
        }
        if (v.kind === "number_ref" && next.numbers[v.id] === undefined) {
          next.numbers[v.id] = 0;
        }
      }
      return next;
    });
  }, [referencedVariables]);

  // Local edits ----------------------------------------------------------
  function updateBlock(id: string, patch: Partial<BlockState>) {
    setBlockState((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
    setDirty(true);
  }
  function updateChip(id: string, patch: Partial<ChipState>) {
    setChipState((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
    setDirty(true);
  }

  // Drag context --------------------------------------------------------
  // Two-phase commit-on-release: dragover sets `target` (visual intent
  // only); release calls `commit()` which mutates state once. See
  // lib/drag.ts for the full model.
  const doCommit = useCallback(
    (dragIdNow: string, targetNow: DragTarget) => {
      const beforeId =
        targetNow.kind === "near"
          ? targetNow.position === "before"
            ? targetNow.targetId
            : null // splice after — handled below
          : null;
      setBlockState((prev) => {
        let next: BlockState[];
        if (targetNow.kind === "near" && targetNow.position === "after") {
          // Splice after: find the index of targetId in the post-reparent
          // list and splice at index+1. Easiest to do inline.
          const dragged = prev.find((b) => b.id === dragIdNow);
          if (!dragged) return prev;
          // Cycle guard delegated to moveBlock; reuse its logic by
          // moving the block to "before targetId", then swap.
          const movedBefore = moveBlock(
            prev,
            dragIdNow,
            {
              parent_block_id: targetNow.parent_block_id,
              parent_row_id: targetNow.parent_row_id,
            },
            targetNow.targetId
          );
          if (movedBefore === prev) return prev; // cycle rejected
          const draggedIdx = movedBefore.findIndex((b) => b.id === dragIdNow);
          const targetIdx = movedBefore.findIndex(
            (b) => b.id === targetNow.targetId
          );
          if (draggedIdx < 0 || targetIdx < 0) {
            next = movedBefore;
          } else if (draggedIdx === targetIdx + 1) {
            next = movedBefore;
          } else {
            const out = [...movedBefore];
            const [m] = out.splice(draggedIdx, 1);
            out.splice(targetIdx + (draggedIdx > targetIdx ? 1 : 0), 0, m);
            next = out;
          }
        } else {
          next = moveBlock(
            prev,
            dragIdNow,
            {
              parent_block_id: targetNow.parent_block_id,
              parent_row_id: targetNow.parent_row_id,
            },
            beforeId
          );
        }
        // Renumber sort_order per-parent so the visible order (which
        // sorts by sort_order via buildByParentBlock) reflects the new
        // flat-array order. Without this, same-parent reorders are
        // committed to state but invisible.
        return renumberSortOrders(next);
      });
      setDirty(true);
      // Clear synchronously so the dragged block's ghost opacity resets
      // even when its DOM node was recreated by the reparent.
      setDragId(null);
      setDragHeight(null);
      setTargetState(null);
    },
    []
  );

  const dragCtx: DragContext = useMemo(
    () => ({
      dragId,
      dragHeight,
      target,
      start: (blockId, height) => {
        setDragId(blockId);
        setDragHeight(height);
        setTargetState(null);
      },
      setTarget: (t) => {
        setTargetState((prev) => {
          if (prev === t) return prev;
          if (!prev || !t) return t;
          if (prev.kind !== t.kind) return t;
          if (prev.kind === "empty" && t.kind === "empty") {
            return prev.parent_block_id === t.parent_block_id &&
              prev.parent_row_id === t.parent_row_id
              ? prev
              : t;
          }
          if (prev.kind === "near" && t.kind === "near") {
            if (
              prev.parent_block_id === t.parent_block_id &&
              prev.parent_row_id === t.parent_row_id &&
              prev.targetId === t.targetId &&
              prev.position === t.position
            )
              return prev;
            return t;
          }
          return t;
        });
      },
      commit: () => {
        const d = dragIdRef.current;
        const t = targetRef.current;
        if (!d || !t) return;
        doCommit(d, t);
      },
    }),
    [dragId, dragHeight, target, doCommit]
  );

  // Drag-end has multiple silent-failure paths in Chrome (release outside
  // the window, click-without-real-drag, source DOM removed mid-drag). The
  // listeners below are layered: window drop is the primary commit path;
  // window dragend is the backup; document dragover preventDefault makes
  // the whole page a drop target so `drop` always fires; the safety timer
  // catches everything else.
  const safetyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    function finish() {
      const d = dragIdRef.current;
      const t = targetRef.current;
      if (d && t) {
        doCommit(d, t);
      } else if (d || t) {
        setDragId(null);
        setDragHeight(null);
        setTargetState(null);
      }
      if (safetyTimerRef.current != null) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    }
    function onDocDragOver(e: DragEvent) {
      if (dragIdRef.current) e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      finish();
    }
    function onEnd() {
      finish();
    }
    document.addEventListener("dragover", onDocDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    return () => {
      document.removeEventListener("dragover", onDocDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
    };
  }, [doCommit]);

  // Safety timer: reset state if dragend silently doesn't fire within 3s.
  useEffect(() => {
    if (!dragId) return;
    if (safetyTimerRef.current != null) clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = window.setTimeout(() => {
      const d = dragIdRef.current;
      const t = targetRef.current;
      if (d && t) doCommit(d, t);
      else if (d || t) {
        setDragId(null);
        setDragHeight(null);
        setTargetState(null);
      }
    }, 3000);
    return () => {
      if (safetyTimerRef.current != null) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, [dragId, doCommit]);

  // Save ----------------------------------------------------------------
  async function doSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    // Walk the tree to assign deterministic sort_orders (0..n at each level).
    const blockPayload: Array<{
      id: string;
      parent_block_id: string | null;
      parent_row_id: string | null;
      block_type: "text" | "condition";
      text: string;
      sort_order: number;
    }> = [];
    function walk(parentBlockId: string | null, parentRowId: string | null) {
      const list =
        byParent.get(
          `${parentBlockId ?? "root"}:${parentRowId ?? "root"}`
        ) ?? [];
      list.forEach((b, i) => {
        blockPayload.push({
          id: b.id,
          parent_block_id: parentBlockId,
          parent_row_id: parentRowId,
          block_type: b.block_type,
          text: b.text,
          sort_order: i,
        });
        if (b.block_type === "condition") {
          for (const r of rowsByConditionBlock.get(b.id) ?? []) {
            walk(b.id, r.id);
          }
        }
      });
    }
    walk(null, null);

    const rowPayload = rowState.map((r, i) => ({
      id: r.id,
      condition_block_id: r.condition_block_id,
      sort_order: i,
    }));

    const chipPayload = chipState.map((c, i) => ({
      id: c.id,
      row_id: c.row_id,
      variable_id: c.variable_id,
      operator: c.operator,
      text_value_id: c.text_value_id,
      number_value: c.number_value,
      aggregate_value: c.aggregate_value,
      sort_order: i,
    }));

    await saveFramework({
      id: framework.id,
      name: trimmedName,
      blocks: blockPayload,
      rows: rowPayload,
      chips: chipPayload,
    });
    setDirty(false);
  }

  function handleSave() {
    startSave(doSave);
  }
  function handleRevert() {
    setName(initial.name);
    setBlockState(initial.blocks);
    setRowState(initial.rows);
    setChipState(initial.chips);
    setDirty(false);
  }

  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  });
  useEffect(() => {
    registerHandle({ dirty, save: () => doSaveRef.current() });
  }, [dirty, registerHandle]);

  async function handleDelete() {
    const ok = await confirmDialog({
      title: "Delete framework?",
      message: `"${framework.name}" and all of its blocks will be permanently removed. Logic rules that target this framework will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", framework.id);
    startSave(async () => {
      await deleteEndingFramework(fd);
      onDeleted();
    });
  }

  const nameInvalid = !name.trim();

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  let body: ReactNode;
  if (previewOn) {
    body = (
      <PreviewView
        name={name}
        blocks={blockState}
        rows={rowState}
        chips={chipState}
        variables={variableState}
        referencedVariables={referencedVariables}
        values={values}
        selections={previewSelections}
        onChangeText={(variableId, valueId) =>
          setPreviewSelections((prev) => ({
            ...prev,
            textValueIds: { ...prev.textValueIds, [variableId]: valueId },
          }))
        }
        onChangeNumber={(variableId, value) =>
          setPreviewSelections((prev) => ({
            ...prev,
            numbers: { ...prev.numbers, [variableId]: value },
          }))
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4 p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Label className="!text-xs">Framework name</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Framework name"
              className={cn(
                "mt-1 h-9",
                GHOST_FIELD,
                nameInvalid && "ring-2 ring-destructive"
              )}
            />
          </div>
          <button
            type="button"
            aria-label="Delete framework"
            title="Delete framework"
            onClick={handleDelete}
            className="mt-6 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>

        <DragCtx.Provider value={dragCtx}>
          <PickerCtx.Provider value={pickerCtx}>
            <BlockList
              parent={{ parent_block_id: null, parent_row_id: null }}
              byParent={byParent}
              rowsByConditionBlock={rowsByConditionBlock}
              chipsByRow={chipsByRow}
              variableIndex={variableIndex}
              variables={variableState}
              values={values}
              framework_id={framework.id}
              onUpdateBlock={updateBlock}
              onChangeChip={updateChip}
            />
          </PickerCtx.Provider>
        </DragCtx.Provider>
      </div>
    );
  }

  const saveDisabled = openPickerCount > 0;

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={framework.name}
        dirty={dirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty && !nameInvalid && !saveDisabled}
            pending={pending}
            onSave={handleSave}
            onRevert={handleRevert}
          />
        }
        menu={
          <button
            type="button"
            onClick={() => setPreviewOn((v) => !v)}
            aria-label={previewOn ? "Exit preview" : "Preview"}
            title={previewOn ? "Exit preview" : "Preview"}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              previewOn
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {previewOn ? (
              <EyeOff size={14} aria-hidden />
            ) : (
              <Eye size={14} aria-hidden />
            )}
          </button>
        }
      />
      {body}
      {confirmDialogEl}
    </section>
  );
}

/**
 * Renumber `sort_order` per-parent based on flat-array position. Called
 * after every drag commit so byParent (which sorts by sort_order) renders
 * the user's intended order.
 */
function renumberSortOrders(blocks: BlockState[]): BlockState[] {
  const counts = new Map<string, number>();
  return blocks.map((b) => {
    const key = `${b.parent_block_id ?? "root"}:${b.parent_row_id ?? "root"}`;
    const idx = counts.get(key) ?? 0;
    counts.set(key, idx + 1);
    return b.sort_order === idx ? b : { ...b, sort_order: idx };
  });
}

/**
 * Reconcile a locally-edited list with an authoritative server list.
 *  - Drop local items the server no longer has.
 *  - Keep local edits where ids overlap.
 *  - Append items the server has that local didn't.
 */
function mergeServer<T extends { id: string }>(
  local: T[],
  server: T[],
  eq: (a: T, b: T) => boolean
): T[] {
  const serverIds = new Set(server.map((s) => s.id));
  const localIds = new Set(local.map((l) => l.id));
  const kept = local.filter((l) => serverIds.has(l.id));
  const additions = server.filter((s) => !localIds.has(s.id));
  if (
    additions.length === 0 &&
    kept.length === local.length &&
    kept.every((k, i) => eq(k, local[i]))
  ) {
    return local;
  }
  return [...kept, ...additions];
}
