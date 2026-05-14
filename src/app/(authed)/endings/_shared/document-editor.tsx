"use client";

// Generalized authoring shell for ending documents — frameworks and the
// five logic-tab tiebreak / framework-selection docs share this editor.
// The block tree, drag-and-drop coordination, save/revert wiring, dirty
// tracking, and static analysis live here. Leaf rendering is delegated
// through the `leaves` prop on the recursive BlockList — frameworks pass
// `{ text }`; logic docs pass `{ result }`.
//
// Lifted unchanged-in-spirit from the pre-rebuild `framework-editor.tsx`;
// the differences are:
//   * accepts EndingDocument + EndingBlock instead of the framework-shape rows
//   * accepts an optional `name` slot — only frameworks render the input
//   * routes the save through _shared/document-actions.ts:saveDocument
//   * `leaves` prop chooses TextBlock vs ResultBlock for the leaf type

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ChevronsDownUp, ChevronsUpDown, Eye, Trash2 } from "lucide-react";
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
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import {
  buildByParentBlock,
  buildChipsByRow,
  buildDeclaredByBlock,
  buildRowsByConditionBlock,
  type BlockState,
  type BlockVariableState,
  type ChipState,
  type RowState,
  type VariableState,
} from "@/lib/endings/block-state";
import {
  AGGREGATE_CHIP_COLORS,
  IMPACT_CHIP_COLORS,
} from "@/lib/endings/impact-colors";
import { AGGREGATE_OPTIONS_BY_REF } from "@/lib/db/enums";
import {
  EMPTY_SELECTIONS,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import {
  numericRowOverlaps,
  staticShadowedRows,
  uncoveredAssignmentsByBlock,
} from "@/lib/endings/static-analysis";
import { BlockList, type LeafComponents } from "../_blocks/block-list";
import { FallbackBlock } from "../_blocks/fallback-block";
import {
  deleteFrameworkDocument,
  saveDocument,
  type BlockPayload,
} from "./document-actions";
import {
  DragCtx,
  isValidDropTarget,
  moveBlock,
  type DragContext,
  type DragTarget,
} from "./lib/drag";
import { PickerCtx, type PickerContext } from "./lib/picker";
import {
  AnalysisCtx,
  indexOverlap,
  indexShadow,
  type AnalysisContext,
} from "./lib/analysis";
import {
  TotalCollapseCtx,
  type CollapseContext,
  type CollapseMode,
} from "./lib/total-collapse";

export type EditorHandle = {
  dirty: boolean;
  save: () => Promise<void>;
};

export interface DocumentEditorProps {
  document: EndingDocument;
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  /** Leaf components by block_type. Frameworks pass `{ text }`; logic
   *  docs pass `{ result }`. */
  leaves: LeafComponents;
  /** Optional: render a preview tab. Frameworks supply this; logic docs
   *  haven't yet (followup). */
  renderPreview?: (args: {
    name: string;
    blocks: BlockState[];
    rows: RowState[];
    chips: ChipState[];
    variables: VariableState[];
    referencedVariables: VariableState[];
    values: EndingVariableValue[];
    selections: PreviewSelections;
    onChangeText: (variableId: string, valueId: string | null) => void;
    onChangeNumber: (variableId: string, value: number | null) => void;
  }) => ReactNode;
  /** Called after a successful framework deletion. Logic docs are
   *  seed-immortal; pass undefined to hide the delete button. */
  onDeleted?: () => void;
  registerHandle: (h: EditorHandle) => void;
  /** Override the panel title. Defaults to the document's name when
   *  framework, or the kind label when logic. */
  panelTitle?: string;
  /** When supplied, renders a pinned fallback picker at the bottom of
   *  the document. The migration seeds a fallback row only on docs the
   *  caller knows about (framework_selection in 0023, class_affinity_top
   *  in 0025). Caller supplies the options to pick from + the helper
   *  text under the label. */
  fallback?: {
    options: { value: string; label: string }[];
    /** Frameworks available for the custom-subset picker; only consulted
     *  when `subsetEnabled` is true (framework_selection only). */
    subsetFrameworks?: { value: string; label: string }[];
    subsetEnabled?: boolean;
    helperText: string;
    emptyLabel: string;
    /** Header label on the fallback panel (e.g. "Fallback ending" or
     *  "Tiebreak Fallback"). Defaults to "Fallback ending". */
    title?: string;
  };
  /** Per-logic-kind tiebreak summary for the static analyzer. When the
   *  doc the analyzer is running on has aggregate chips, tied outcomes
   *  drop from the uncovered enumeration if the relevant tiebreak doc
   *  is non-empty. Caller computes from saved state (e.g. frameworks/
   *  page.tsx pre-fetches all logic-doc data and condenses to a
   *  per-kind isEmpty boolean). */
  tiebreakDocsSummary?: Map<
    import("@/lib/db/enums").EndingLogicKind,
    { isEmpty: boolean }
  >;
}

export function DocumentEditor({
  document,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  nations,
  leaves,
  renderPreview,
  onDeleted,
  registerHandle,
  panelTitle,
  fallback,
  tiebreakDocsSummary,
}: DocumentEditorProps) {
  const isFramework = document.kind === "framework";
  const initialName = document.name ?? "";

  const initial = useMemo(
    () => ({
      name: initialName,
      blocks: blocks.map(
        (b): BlockState => ({
          id: b.id,
          document_id: b.document_id,
          parent_block_id: b.parent_block_id,
          parent_row_id: b.parent_row_id,
          block_type: b.block_type,
          text: b.text ?? "",
          result_value: b.result_value,
          summary: b.summary ?? "",
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
      blockVariables: blockVariables.map(
        (bv): BlockVariableState => ({
          id: bv.id,
          condition_block_id: bv.condition_block_id,
          variable_id: bv.variable_id,
          sort_order: bv.sort_order,
        })
      ),
    }),
    [initialName, blocks, rows, chips, blockVariables]
  );

  const [name, setName] = useState(initial.name);
  const [blockState, setBlockState] = useState<BlockState[]>(initial.blocks);
  const [rowState, setRowState] = useState<RowState[]>(initial.rows);
  const [chipState, setChipState] = useState<ChipState[]>(initial.chips);
  const [blockVariableState, setBlockVariableState] = useState<
    BlockVariableState[]
  >(initial.blockVariables);
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
  const collapseModeStorageKey = `endings.collapseMode.${document.id}`;
  const [collapseMode, setCollapseModeState] = useState<CollapseMode>("expanded");
  const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
    () => new Map()
  );
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(collapseModeStorageKey);
      if (raw === "all") setCollapseModeState("all");
      else setCollapseModeState("expanded");
    } catch {
      // localStorage unavailable — keep default (expanded).
    }
    setCollapseOverrides(new Map());
  }, [collapseModeStorageKey]);
  const applyCollapseMode = useCallback(
    (next: CollapseMode) => {
      setCollapseModeState(next);
      setCollapseOverrides(new Map());
      try {
        if (next === "expanded")
          window.localStorage.removeItem(collapseModeStorageKey);
        else window.localStorage.setItem(collapseModeStorageKey, next);
      } catch {
        // ignore — preference is best-effort.
      }
    },
    [collapseModeStorageKey]
  );
  const setCollapseOverride = useCallback(
    (blockId: string, collapsed: boolean) => {
      setCollapseOverrides((prev) => {
        const next = new Map(prev);
        next.set(blockId, collapsed);
        return next;
      });
    },
    []
  );
  const collapseCtx = useMemo<CollapseContext>(
    () => ({
      mode: collapseMode,
      overrides: collapseOverrides,
      setOverride: setCollapseOverride,
      cascadeSeen: null,
    }),
    [collapseMode, collapseOverrides, setCollapseOverride]
  );
  const collapseDirty = collapseOverrides.size > 0;

  // Reconcile incoming server state with local edits.
  useEffect(() => {
    if (!dirty) {
      setName(initial.name);
      setBlockState(initial.blocks);
      setRowState(initial.rows);
      setChipState(initial.chips);
      setBlockVariableState(initial.blockVariables);
      return;
    }
    setBlockState((prev) =>
      mergeServer(prev, initial.blocks, (a, b) => a.id === b.id)
    );
    setRowState((prev) =>
      mergeServer(prev, initial.rows, (a, b) => a.id === b.id)
    );
    setChipState((prev) =>
      mergeServer(prev, initial.chips, (a, b) => a.id === b.id)
    );
    setBlockVariableState((prev) =>
      mergeServer(prev, initial.blockVariables, (a, b) => a.id === b.id)
    );
  }, [initial, dirty]);

  // Open chip-picker count — Save is disabled while any picker is mid-pick.
  const [openPickerCount, setOpenPickerCount] = useState(0);
  const pickerCtx: PickerContext = useMemo(
    () => ({
      openCount: openPickerCount,
      register: () => setOpenPickerCount((n) => n + 1),
      unregister: () => setOpenPickerCount((n) => Math.max(0, n - 1)),
    }),
    [openPickerCount]
  );

  const nationColorByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nations) m.set(n.name.toLowerCase(), n.color_hex);
    return m;
  }, [nations]);

  const variableState: VariableState[] = useMemo(
    () =>
      variables.map((v) => {
        let color_hex: string | null = v.color_hex ?? null;
        if (v.kind === "number_ref" && v.number_ref) {
          color_hex =
            v.color_hex ??
            IMPACT_CHIP_COLORS[v.number_ref] ??
            nationColorByName.get(v.name.toLowerCase()) ??
            null;
        } else if (v.kind === "aggregate_ref" && v.aggregate_ref) {
          color_hex = v.color_hex ?? AGGREGATE_CHIP_COLORS[v.aggregate_ref] ?? null;
        }
        return {
          id: v.id,
          name: v.name,
          kind: v.kind,
          number_ref: v.number_ref,
          aggregate_ref:
            v.aggregate_ref === "class_affinity" ||
            v.aggregate_ref === "nation_affinity" ||
            v.aggregate_ref === "nation_tiebreak_set"
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

  // Authoring scope: tiebreak documents (class_affinity_top /
  // nation_affinity_top / nation_affinity_bottom) author against the
  // tiebreak set, while frameworks + framework_selection author against
  // the affinity aggregates. Filter the picker pool accordingly so the
  // header + chip pickers only surface variables that make sense on
  // this surface. The unfiltered list stays available for preview /
  // evaluation paths.
  const isTiebreakDoc =
    document.kind === "class_affinity_top" ||
    document.kind === "nation_affinity_top" ||
    document.kind === "nation_affinity_bottom";
  const authoringVariableState = useMemo(() => {
    return variableState.filter((v) => {
      if (v.kind !== "aggregate_ref" || !v.aggregate_ref) return true;
      if (isTiebreakDoc) {
        return v.aggregate_ref === "nation_tiebreak_set";
      }
      return v.aggregate_ref !== "nation_tiebreak_set";
    });
  }, [variableState, isTiebreakDoc]);
  const variableIndex = useMemo(() => {
    const m = new Map<string, VariableState>();
    for (const v of variableState) m.set(v.id, v);
    return m;
  }, [variableState]);
  // Fallback blocks are pinned at the bottom of the document and rendered
  // outside BlockList — filter them out of the byParent map so the
  // recursive list doesn't try to render them as a regular leaf.
  const fallbackBlock = useMemo(
    () => blockState.find((b) => b.block_type === "fallback") ?? null,
    [blockState]
  );
  const byParent = useMemo(
    () =>
      buildByParentBlock(
        blockState.filter((b) => b.block_type !== "fallback")
      ),
    [blockState]
  );
  const rowsByConditionBlock = useMemo(
    () => buildRowsByConditionBlock(rowState),
    [rowState]
  );
  const chipsByRow = useMemo(() => buildChipsByRow(chipState), [chipState]);
  const declaredByBlock = useMemo(
    () => buildDeclaredByBlock(blockVariableState),
    [blockVariableState]
  );

  // Static analysis (Phase 5): shadow + uncovered-assignment detection.
  const analysisCtx = useMemo<AnalysisContext>(() => {
    const evalVariables = variableState.map((v) => ({
      id: v.id,
      kind: v.kind,
      aggregate_ref: v.aggregate_ref,
    }));
    const evalChips = chipState.map((c) => ({
      id: c.id,
      row_id: c.row_id,
      variable_id: c.variable_id,
      operator: c.operator,
      text_value_id: c.text_value_id,
      number_value: c.number_value,
      aggregate_value: c.aggregate_value,
      sort_order: c.sort_order,
    }));
    const evalRows = rowState.map((r) => ({
      id: r.id,
      condition_block_id: r.condition_block_id,
      sort_order: r.sort_order,
    }));
    // Static analysis only inspects condition blocks (their rows + chips);
    // text/result leaves are passed through opaquely. Cast to the
    // narrower EvalBlock shape so we stay compatible with the evaluator's
    // block_type union — the analyzer never reads block_type itself, but
    // the type system insists.
    const evalBlocks = blockState
      .filter((b) => b.block_type !== "result" && b.block_type !== "fallback")
      .map((b) => ({
        id: b.id,
        parent_block_id: b.parent_block_id,
        parent_row_id: b.parent_row_id,
        block_type: b.block_type as "text" | "condition",
        text: b.text,
        sort_order: b.sort_order,
      }));
    const evalValues = values.map((v) => ({
      id: v.id,
      variable_id: v.variable_id,
    }));
    const evalBlockVariables = blockVariableState.map((bv) => ({
      condition_block_id: bv.condition_block_id,
      variable_id: bv.variable_id,
    }));
    const inputs = {
      blocks: evalBlocks,
      rows: evalRows,
      chips: evalChips,
      variables: evalVariables,
      values: evalValues,
      blockVariables: evalBlockVariables,
      tiebreakDocs: tiebreakDocsSummary,
    };
    const shadow = staticShadowedRows(inputs);
    const overlaps = numericRowOverlaps(inputs);
    const blockAnalysis = uncoveredAssignmentsByBlock(inputs);
    const rowSortOrder = new Map<string, number>();
    for (const list of rowsByConditionBlock.values()) {
      list.forEach((r, i) => rowSortOrder.set(r.id, i + 1));
    }
    return {
      shadowByRowId: indexShadow(shadow),
      overlapByRowId: indexOverlap(overlaps),
      blockAnalysis,
      rowSortOrder,
    };
  }, [
    blockState,
    rowState,
    chipState,
    blockVariableState,
    variableState,
    values,
    rowsByConditionBlock,
    tiebreakDocsSummary,
  ]);

  // Variables actually referenced by any chip (for the preview UI).
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
      // nation_tiebreak_set chips check set-membership against the working
      // tiebreak set, not the underlying nation impact-column scores —
      // pulling those columns into the preview would show inputs that
      // have no effect on the result.
      if (v.aggregate_ref === "nation_tiebreak_set") continue;
      for (const col of AGGREGATE_OPTIONS_BY_REF[v.aggregate_ref]) {
        const underlying = numberRefByName.get(col);
        if (underlying) ids.add(underlying.id);
      }
    }
    return variableState.filter((v) => ids.has(v.id));
  }, [chipState, variableState]);

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
  const doCommit = useCallback(
    (dragIdNow: string, targetNow: DragTarget) => {
      const beforeId =
        targetNow.kind === "near"
          ? targetNow.position === "before"
            ? targetNow.targetId
            : null
          : null;
      setBlockState((prev) => {
        let next: BlockState[];
        if (targetNow.kind === "near" && targetNow.position === "after") {
          const dragged = prev.find((b) => b.id === dragIdNow);
          if (!dragged) return prev;
          const movedBefore = moveBlock(
            prev,
            dragIdNow,
            {
              parent_block_id: targetNow.parent_block_id,
              parent_row_id: targetNow.parent_row_id,
            },
            targetNow.targetId
          );
          if (movedBefore === prev) return prev;
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
        return renumberSortOrders(next);
      });
      setDirty(true);
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
        // Suppress the insertion highlight when the proposed drop
        // would be invalid (cycle / result-uniqueness). The dragged
        // block keeps moving with the cursor; only the target
        // indicator is hidden.
        if (
          t &&
          dragId &&
          !isValidDropTarget(blockState, dragId, {
            parent_block_id: t.parent_block_id,
            parent_row_id: t.parent_row_id,
          })
        ) {
          setTargetState(null);
          return;
        }
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
    [dragId, dragHeight, target, doCommit, blockState]
  );

  // Layered drop / dragend listeners. See lib/drag.ts header for why.
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
    globalThis.document.addEventListener("dragover", onDocDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    return () => {
      globalThis.document.removeEventListener("dragover", onDocDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
    };
  }, [doCommit]);

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
    if (isFramework) {
      const trimmedName = name.trim();
      if (!trimmedName) return;
    }
    const blockPayload: BlockPayload[] = [];
    function walk(parentBlockId: string | null, parentRowId: string | null) {
      const list =
        byParent.get(`${parentBlockId ?? "root"}:${parentRowId ?? "root"}`) ??
        [];
      list.forEach((b, i) => {
        blockPayload.push({
          id: b.id,
          parent_block_id: parentBlockId,
          parent_row_id: parentRowId,
          block_type: b.block_type,
          text: b.text,
          result_value: b.result_value,
          summary: b.summary === "" ? null : b.summary,
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

    // Fallback block lives outside the byParent walk (it's pinned at the
    // bottom and not part of the recursive tree); append it explicitly so
    // saveDocument writes its result_value.
    if (fallbackBlock) {
      blockPayload.push({
        id: fallbackBlock.id,
        parent_block_id: null,
        parent_row_id: null,
        block_type: fallbackBlock.block_type,
        text: null,
        result_value: fallbackBlock.result_value,
        summary: null,
        sort_order: 999999,
      });
    }

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

    const headerPayload = blockVariableState.map((bv, i) => ({
      id: bv.id,
      sort_order: i,
    }));

    await saveDocument({
      document_id: document.id,
      name: isFramework ? name.trim() : null,
      blocks: blockPayload,
      rows: rowPayload,
      chips: chipPayload,
      header_vars: headerPayload,
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
    setBlockVariableState(initial.blockVariables);
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
    if (!onDeleted) return;
    const ok = await confirmDialog({
      title: "Delete framework?",
      message: `"${document.name ?? "this framework"}" and all of its blocks will be permanently removed. Logic rules that target this framework will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", document.id);
    startSave(async () => {
      await deleteFrameworkDocument(fd);
      onDeleted();
    });
  }

  const nameInvalid = isFramework && !name.trim();

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
  if (previewOn && renderPreview) {
    body = renderPreview({
      name,
      blocks: blockState,
      rows: rowState,
      chips: chipState,
      variables: variableState,
      referencedVariables,
      values,
      selections: previewSelections,
      onChangeText: (variableId, valueId) =>
        setPreviewSelections((prev) => ({
          ...prev,
          textValueIds: { ...prev.textValueIds, [variableId]: valueId },
        })),
      onChangeNumber: (variableId, value) =>
        setPreviewSelections((prev) => ({
          ...prev,
          numbers: { ...prev.numbers, [variableId]: value },
        })),
    });
  } else {
    body = (
      <div className="flex flex-col gap-4 p-3">
        {isFramework ? (
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
            {onDeleted ? (
              <button
                type="button"
                aria-label="Delete framework"
                title="Delete framework"
                onClick={handleDelete}
                className="mt-6 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        <DragCtx.Provider value={dragCtx}>
          <PickerCtx.Provider value={pickerCtx}>
            <AnalysisCtx.Provider value={analysisCtx}>
              <TotalCollapseCtx.Provider value={collapseCtx}>
                <BlockList
                  parent={{ parent_block_id: null, parent_row_id: null }}
                  byParent={byParent}
                  rowsByConditionBlock={rowsByConditionBlock}
                  chipsByRow={chipsByRow}
                  declaredByBlock={declaredByBlock}
                  variableIndex={variableIndex}
                  variables={authoringVariableState}
                  values={values}
                  document_id={document.id}
                  leaves={leaves}
                  onUpdateBlock={updateBlock}
                  onChangeChip={updateChip}
                />
                {fallback && fallbackBlock ? (
                  <FallbackBlock
                    block={fallbackBlock}
                    options={fallback.options}
                    subsetFrameworks={fallback.subsetFrameworks}
                    subsetEnabled={fallback.subsetEnabled}
                    helperText={fallback.helperText}
                    emptyLabel={fallback.emptyLabel}
                    title={fallback.title}
                    onChange={(result_value) =>
                      updateBlock(fallbackBlock.id, { result_value })
                    }
                  />
                ) : null}
              </TotalCollapseCtx.Provider>
            </AnalysisCtx.Provider>
          </PickerCtx.Provider>
        </DragCtx.Provider>
      </div>
    );
  }

  const saveDisabled = openPickerCount > 0;
  const headerTitle =
    panelTitle ?? (isFramework ? document.name ?? "(unnamed)" : document.kind);

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={headerTitle}
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
          <div className="flex items-center gap-1">
            <CollapseModeToggleGroup
              mode={collapseMode}
              dirty={collapseDirty}
              onSelect={applyCollapseMode}
            />
            {renderPreview ? (
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
                <Eye size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        }
      />
      {body}
      {confirmDialogEl}
    </section>
  );
}

function CollapseModeToggleGroup({
  mode,
  dirty,
  onSelect,
}: {
  mode: CollapseMode;
  dirty: boolean;
  onSelect: (mode: CollapseMode) => void;
}) {
  const items: {
    id: CollapseMode;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "expanded", label: "Expand all", icon: <ChevronsUpDown size={14} aria-hidden /> },
    { id: "all", label: "Collapse all", icon: <ChevronsDownUp size={14} aria-hidden /> },
  ];
  return (
    <div role="group" aria-label="Collapse mode" className="flex items-center gap-0.5">
      {items.map((item) => {
        const active = !dirty && mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={active}
            aria-label={item.label}
            title={item.label}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renumber `sort_order` per-parent based on flat-array position.
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
