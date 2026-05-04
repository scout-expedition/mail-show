// Authoring-side state shapes for the v3 endings frameworks editor.
//
// The workspace keeps frameworks as three flat arrays — blocks, rows,
// chips — mirroring the schema. The two indexers below are the work-horse
// lookups used by the recursive renderer and the drag-drop wiring.

import type {
  AggregateRef,
  EndingChipOperator,
  EndingVariableKind,
} from "@/lib/db/enums";

export interface BlockState {
  id: string;
  framework_id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: "text" | "condition";
  text: string;
  sort_order: number;
}

export interface RowState {
  id: string;
  condition_block_id: string;
  sort_order: number;
}

export interface BlockVariableState {
  id: string;
  condition_block_id: string;
  variable_id: string;
  sort_order: number;
}

/**
 * Group block-variable header rows by their condition block, in
 * sort_order. Used to render the variable chips on a condition block's
 * header and to drive the per-slot row layout.
 */
export function buildDeclaredByBlock(
  blockVariables: BlockVariableState[]
): Map<string, BlockVariableState[]> {
  const out = new Map<string, BlockVariableState[]>();
  for (const bv of blockVariables) {
    const list = out.get(bv.condition_block_id);
    if (list) list.push(bv);
    else out.set(bv.condition_block_id, [bv]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

export interface ChipState {
  id: string;
  row_id: string;
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
  sort_order: number;
}

export interface VariableState {
  id: string;
  name: string;
  kind: EndingVariableKind;
  number_ref: string | null;
  aggregate_ref: AggregateRef | null;
  default_value_id: string | null;
  color_index: number;
  /** Optional hex override (e.g. nation color, impact-column color).
   *  Falls back to the `color_index` palette when null. */
  color_hex: string | null;
  sort_order: number;
}

export type ParentLoc = {
  parent_block_id: string | null;
  parent_row_id: string | null;
};

export type ParentKey = string;

export function parentKey(
  parent_block_id: string | null,
  parent_row_id: string | null
): ParentKey {
  return `${parent_block_id ?? "root"}:${parent_row_id ?? "root"}`;
}

export function parentKeyOf(b: BlockState): ParentKey {
  return parentKey(b.parent_block_id, b.parent_row_id);
}

/**
 * Group blocks by their `(parent_block_id, parent_row_id)` parent key, in
 * sort_order. Used for the recursive block tree render.
 */
export function buildByParentBlock(
  blocks: BlockState[]
): Map<ParentKey, BlockState[]> {
  const out = new Map<ParentKey, BlockState[]>();
  for (const b of blocks) {
    const key = parentKeyOf(b);
    const list = out.get(key);
    if (list) list.push(b);
    else out.set(key, [b]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

/**
 * Group rows by their condition block, in sort_order. Used to render the
 * stacked rows of a condition block.
 */
export function buildRowsByConditionBlock(
  rows: RowState[]
): Map<string, RowState[]> {
  const out = new Map<string, RowState[]>();
  for (const r of rows) {
    const list = out.get(r.condition_block_id);
    if (list) list.push(r);
    else out.set(r.condition_block_id, [r]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

/**
 * Group chips by their owning row, in sort_order. Used to render the
 * chip list inside a row's left column.
 */
export function buildChipsByRow(chips: ChipState[]): Map<string, ChipState[]> {
  const out = new Map<string, ChipState[]>();
  for (const c of chips) {
    const list = out.get(c.row_id);
    if (list) list.push(c);
    else out.set(c.row_id, [c]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

/**
 * Variables actually referenced by any chip in a framework. The
 * authoring header for a condition block lists chips per variable, but
 * the *set* of variables a given block branches on is derived from its
 * rows' chips — there's no parallel "block.variables" array.
 */
export function variablesReferencedByConditionBlock(
  blockId: string,
  rows: RowState[],
  chips: ChipState[]
): string[] {
  const rowIds = new Set(
    rows.filter((r) => r.condition_block_id === blockId).map((r) => r.id)
  );
  const out = new Set<string>();
  for (const c of chips) {
    if (!rowIds.has(c.row_id)) continue;
    out.add(c.variable_id);
  }
  return [...out];
}
