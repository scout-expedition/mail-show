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
import { GHOST_FIELD, PanelHeader } from "@/components/panel";
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
import { extractVariableTagNames } from "@/lib/endings/text-substitution";
import {
  numericRowOverlaps,
  staticShadowedRows,
  uncoveredAssignmentsByBlock,
} from "@/lib/endings/static-analysis";
import { BlockList, type LeafComponents } from "../_blocks/block-list";
import { FallbackBlock } from "../_blocks/fallback-block";
import {
  deleteFrameworkDocument,
  patchBlock,
  patchChip,
  patchDocument,
  reorderTree,
} from "./document-actions";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import {
  DragCtx,
  isValidDropTarget,
  moveBlock,
  type DragContext,
  type DragTarget,
} from "./lib/drag";
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

/**
 * @deprecated Retained as a typed shape for the legacy
 * frameworks/logic parent wrappers until they drop the prop entirely.
 * After autosave migration, dirty is always false and save() is a
 * no-op — the parent's "wait for in-flight saves before navigating"
 * concern is handled by useInstantField's blur-flush + 400ms debounce.
 */
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
  /** @deprecated Kept for backwards compatibility while the framework /
   *  logic workspace parents drop their tab-switch dialog. The editor
   *  always reports dirty:false now; in-flight commits flush on blur. */
  registerHandle?: (h: EditorHandle) => void;
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

  // Framework name is now autosaved through patchDocument. The
  // useInstantField hook owns the local typed value + debounce; remote
  // updates (postgres echo) arrive via the document prop's new identity
  // and the hook's LWW reducer handles them. Logic docs are anonymous —
  // the hook still mounts (cheap) but its onCommit is a no-op so an
  // accidental call would never reach the server.
  const { peers, setFocus, onPostgresChanges } = usePresenceContext();
  const nameField = useInstantField<string>({
    value: initial.name,
    onCommit: async (v) => {
      if (!isFramework) return;
      const trimmed = v.trim();
      if (!trimmed) return; // server would throw; let the inline ring show the error
      await patchDocument(document.id, { name: trimmed });
    },
    onFocusChange: (focused) => {
      if (!isFramework) return;
      setFocus(
        focused
          ? { table: "ending_documents", recordId: document.id, field: "name" }
          : null
      );
    },
  });
  const name = nameField.value;
  const [blockState, setBlockState] = useState<BlockState[]>(initial.blocks);
  const [rowState, setRowState] = useState<RowState[]>(initial.rows);
  const [chipState, setChipState] = useState<ChipState[]>(initial.chips);
  const [blockVariableState, setBlockVariableState] = useState<
    BlockVariableState[]
  >(initial.blockVariables);
  const [pending, startDeleteTransition] = useTransition();
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
  //
  // Two sources push into the local mirror: (1) server-prop changes
  // after a structural revalidate (add/delete/duplicate), and (2)
  // postgres echo for column-level updates from peers. The merge here
  // handles case 1 — keep typed-but-uncommitted state for known ids,
  // append new ids from the server, drop ids that vanished. Per-leaf
  // useInstantField hooks own typed text and reconcile their own LWW.
  useEffect(() => {
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
  }, [initial]);

  // Postgres echo handler — merges column-level updates from peers into
  // the local mirror for all four ending tables, scoped to blocks /
  // rows / chips / headers that belong to THIS document. Document-scope
  // filtering is done client-side via id-membership in the local
  // mirror; the channel is shared across the surface so the filter
  // keeps cross-doc events out without an extra subscription.
  useEffect(() => {
    return onPostgresChanges((change) => {
      if (change.table === "ending_blocks") {
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.document_id !== document.id) return;
          setBlockState((prev) =>
            prev.map((b) =>
              b.id === n.id
                ? {
                    ...b,
                    parent_block_id: n.parent_block_id,
                    parent_row_id: n.parent_row_id,
                    block_type: n.block_type,
                    text: n.text ?? "",
                    result_value: n.result_value,
                    summary: n.summary ?? "",
                    sort_order: n.sort_order,
                  }
                : b
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setBlockState((prev) => prev.filter((b) => b.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.document_id !== document.id) return;
          setBlockState((prev) => {
            if (prev.some((b) => b.id === n.id)) return prev;
            return [
              ...prev,
              {
                id: n.id,
                document_id: n.document_id,
                parent_block_id: n.parent_block_id,
                parent_row_id: n.parent_row_id,
                block_type: n.block_type,
                text: n.text ?? "",
                result_value: n.result_value,
                summary: n.summary ?? "",
                sort_order: n.sort_order,
              },
            ];
          });
        }
        return;
      }
      if (change.table === "ending_condition_rows") {
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingConditionRow;
          if (!isThisDocBlockId(n.condition_block_id, blockState)) return;
          setRowState((prev) =>
            prev.map((r) =>
              r.id === n.id
                ? {
                    ...r,
                    condition_block_id: n.condition_block_id,
                    sort_order: n.sort_order,
                  }
                : r
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setRowState((prev) => prev.filter((r) => r.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingConditionRow;
          if (!isThisDocBlockId(n.condition_block_id, blockState)) return;
          setRowState((prev) => {
            if (prev.some((r) => r.id === n.id)) return prev;
            return [
              ...prev,
              {
                id: n.id,
                condition_block_id: n.condition_block_id,
                sort_order: n.sort_order,
              },
            ];
          });
        }
        return;
      }
      if (change.table === "ending_condition_row_chips") {
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingConditionRowChip;
          if (!isThisDocRowId(n.row_id, rowState)) return;
          setChipState((prev) =>
            prev.map((c) =>
              c.id === n.id
                ? {
                    ...c,
                    row_id: n.row_id,
                    variable_id: n.variable_id,
                    operator: n.operator,
                    text_value_id: n.text_value_id,
                    number_value: n.number_value,
                    aggregate_value: n.aggregate_value,
                    sort_order: n.sort_order,
                  }
                : c
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setChipState((prev) => prev.filter((c) => c.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingConditionRowChip;
          if (!isThisDocRowId(n.row_id, rowState)) return;
          setChipState((prev) => {
            if (prev.some((c) => c.id === n.id)) return prev;
            return [
              ...prev,
              {
                id: n.id,
                row_id: n.row_id,
                variable_id: n.variable_id,
                operator: n.operator,
                text_value_id: n.text_value_id,
                number_value: n.number_value,
                aggregate_value: n.aggregate_value,
                sort_order: n.sort_order,
              },
            ];
          });
        }
        return;
      }
      if (change.table === "ending_condition_block_variables") {
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingConditionBlockVariable;
          if (!isThisDocBlockId(n.condition_block_id, blockState)) return;
          setBlockVariableState((prev) =>
            prev.map((bv) =>
              bv.id === n.id
                ? {
                    ...bv,
                    condition_block_id: n.condition_block_id,
                    variable_id: n.variable_id,
                    sort_order: n.sort_order,
                  }
                : bv
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setBlockVariableState((prev) => prev.filter((bv) => bv.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingConditionBlockVariable;
          if (!isThisDocBlockId(n.condition_block_id, blockState)) return;
          setBlockVariableState((prev) => {
            if (prev.some((bv) => bv.id === n.id)) return prev;
            return [
              ...prev,
              {
                id: n.id,
                condition_block_id: n.condition_block_id,
                variable_id: n.variable_id,
                sort_order: n.sort_order,
              },
            ];
          });
        }
      }
    });
  }, [onPostgresChanges, document.id, blockState, rowState]);

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
      name: v.name,
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

  // Variables actually referenced by any chip OR by an `@[Name]` token
  // inside a text block (for the preview UI). The text-block scan counts
  // tags toward the input set so authors can dial in values for
  // variables that aren't otherwise on a chip.
  const referencedVariables = useMemo(() => {
    const ids = new Set<string>();
    for (const c of chipState) ids.add(c.variable_id);
    const variableByName = new Map<string, VariableState>();
    for (const v of variableState) variableByName.set(v.name, v);
    for (const b of blockState) {
      if (b.block_type !== "text" || !b.text) continue;
      for (const name of extractVariableTagNames(b.text)) {
        const v = variableByName.get(name);
        if (v) ids.add(v.id);
      }
    }
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
  }, [chipState, variableState, blockState]);

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
  // Block + chip edits flow through these wrappers. Each one applies an
  // optimistic local mutation so the UI updates instantly, then fires
  // the matching patchX action. Postgres echo eventually overwrites with
  // the server value (idempotent for happy-path edits; reverts on the
  // error path). Block text + summary + result_value migrated to their
  // own per-leaf useInstantField, so `updateBlock` is only used by drag-
  // reorder + the chip-add path's auto-declare flow today. Chip pickers
  // call this through `onChangeChip` from each click; no debounce
  // needed (clicks produce final values).
  function updateBlock(id: string, patch: Partial<BlockState>) {
    setBlockState((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
    // Only structural edits flow through this path now (drag reorder,
    // result-uniqueness fixups in the chip-add flow). Defer the patch to
    // the structural-save path so we don't double-write text/result.
  }
  function updateChip(id: string, patch: Partial<ChipState>) {
    setChipState((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
    // Fire and forget — postgres echo will reconcile the mirror with the
    // committed server value. Errors flip to the console and a toast in
    // a followup; today, the bulk Save path acts as the safety net.
    void patchChip(id, patch).catch(() => {
      // Server rejected (e.g. invalid operator/value-slot combo). The
      // optimistic mutation above stays in the mirror until either the
      // user fixes it (next picker click commits again) or postgres
      // echo of an unrelated change refreshes the chip. The bulk Save
      // button is still wired and would catch this on next press.
    });
  }

  // Drag context --------------------------------------------------------
  // Keep blockState in a ref so doCommit can compute the new structural
  // layout from the current mirror without going through setState's
  // updater-callback (where firing an async server action would risk
  // duplicates under StrictMode).
  const blockStateRef = useRef<BlockState[]>(blockState);
  blockStateRef.current = blockState;
  const doCommit = useCallback(
    (dragIdNow: string, targetNow: DragTarget) => {
      const prev = blockStateRef.current;
      const beforeId =
        targetNow.kind === "near"
          ? targetNow.position === "before"
            ? targetNow.targetId
            : null
          : null;
      let next: BlockState[];
      if (targetNow.kind === "near" && targetNow.position === "after") {
        const dragged = prev.find((b) => b.id === dragIdNow);
        if (!dragged) {
          setDragId(null);
          setDragHeight(null);
          setTargetState(null);
          return;
        }
        const movedBefore = moveBlock(
          prev,
          dragIdNow,
          {
            parent_block_id: targetNow.parent_block_id,
            parent_row_id: targetNow.parent_row_id,
          },
          targetNow.targetId
        );
        if (movedBefore === prev) {
          setDragId(null);
          setDragHeight(null);
          setTargetState(null);
          return;
        }
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
      next = renumberSortOrders(next);
      setBlockState(next);
      setDragId(null);
      setDragHeight(null);
      setTargetState(null);

      // Fire reorderTree with only the blocks that actually changed
      // (parent / sort_order delta) — minimises round-trip churn and
      // keeps the patch list short for postgres echo back to peers.
      const changedBlocks = next
        .filter((b) => {
          const before = prev.find((p) => p.id === b.id);
          if (!before) return true;
          return (
            before.parent_block_id !== b.parent_block_id ||
            before.parent_row_id !== b.parent_row_id ||
            before.sort_order !== b.sort_order
          );
        })
        .map((b) => ({
          id: b.id,
          parent_block_id: b.parent_block_id,
          parent_row_id: b.parent_row_id,
          sort_order: b.sort_order,
        }));
      if (changedBlocks.length === 0) return;
      void reorderTree({
        document_id: document.id,
        blocks: changedBlocks,
        rows: [],
        chips: [],
        header_vars: [],
      }).catch(() => {
        // Server rejected (e.g. result-uniqueness across the proposed
        // grouping). Postgres echo with the prior state will roll back
        // the mirror on next tick.
      });
    },
    [document.id]
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

  // The legacy bulk-save path is gone. Every editable field (document
  // name, block text/summary/result_value, chips, header variables) now
  // commits through its own patchX action; drag-reorders fire
  // reorderTree directly. The parent's `registerHandle` callback is
  // notified once at mount with dirty:false so the workspace's
  // unsaved-changes dialog never prompts. We keep the handle interface
  // until the parents drop it (next commit).
  useEffect(() => {
    registerHandle?.({ dirty: false, save: async () => {} });
  }, [registerHandle]);

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
    startDeleteTransition(async () => {
      await deleteFrameworkDocument(fd);
      onDeleted();
    });
  }

  const nameInvalid = isFramework && !name.trim();

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
              <FieldHighlight
                peers={peers}
                focusKey={{
                  table: "ending_documents",
                  recordId: document.id,
                  field: "name",
                }}
                className="mt-1"
              >
                <Input
                  value={nameField.value}
                  onChange={(e) => nameField.set(e.target.value)}
                  onFocus={nameField.onFocus}
                  onBlur={nameField.onBlur}
                  placeholder="Framework name"
                  className={cn(
                    "h-9",
                    GHOST_FIELD,
                    nameInvalid && "ring-2 ring-destructive",
                    nameField.status === "error" && "ring-2 ring-destructive"
                  )}
                />
              </FieldHighlight>
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
                />
              ) : null}
            </TotalCollapseCtx.Provider>
          </AnalysisCtx.Provider>
        </DragCtx.Provider>
      </div>
    );
  }

  const headerTitle =
    panelTitle ?? (isFramework ? document.name ?? "(unnamed)" : document.kind);

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={headerTitle}
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
 * True when the given block id is one of this document's blocks in the
 * local mirror. Used by the postgres echo handler to scope events to
 * the active document without an extra round-trip.
 */
function isThisDocBlockId(blockId: string, blockState: BlockState[]): boolean {
  return blockState.some((b) => b.id === blockId);
}

/**
 * True when the given row id is one of this document's rows in the
 * local mirror.
 */
function isThisDocRowId(rowId: string, rowState: RowState[]): boolean {
  return rowState.some((r) => r.id === rowId);
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
