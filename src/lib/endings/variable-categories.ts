// Shared model for the folder-aware variable picker used on the endings
// frameworks/logic editor surfaces (condition-block "add variable"
// button and the @-mention autocomplete in text blocks).
//
// Top-level navigation is a fixed list of five buckets — Ending
// Variables, Impact, Class Affinity, Nation Affinity, Aggregates — that
// shape number_ref / aggregate_ref variables into a stable ordering the
// authors recognize. Text variables live under Ending Variables and
// nest into whatever folder tree the user maintains on /endings/variables.
//
// `buildVariableTree` is pure: it derives a `PickerNode[]` from the
// current `VariableState` list + `EndingVariableFolder` rows. The DB
// rows remain the source of truth; this module only shapes them.

import type { EndingVariableFolder } from "@/lib/db/types";
import type { VariableState } from "./block-state";

export type PickerNode =
  | { type: "category"; id: string; label: string; children: PickerNode[] }
  | { type: "folder"; id: string; label: string; children: PickerNode[] }
  | { type: "variable"; id: string; variable: VariableState };

// Hardcoded order for number_ref categories. Each entry maps the
// human-readable category label to the `number_ref` columns that
// belong inside it, in the order they should be rendered.
const NUMBER_REF_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  columns: ReadonlyArray<string>;
}> = [
  { id: "cat:impact", label: "Impact", columns: ["world_status", "demerits"] },
  {
    id: "cat:class_affinity",
    label: "Class Affinity",
    columns: ["proletariat", "gentry"],
  },
  {
    id: "cat:nation_affinity",
    label: "Nation Affinity",
    columns: ["epicenter", "folos", "emberlyn", "spokgrad", "pelico"],
  },
];

const AGGREGATE_CATEGORY: ReadonlyArray<{ ref: string; label: string }> = [
  { ref: "class_affinity", label: "Class Affinity" },
  { ref: "nation_affinity", label: "Nation Affinity" },
  { ref: "nation_tiebreak_set", label: "Tiebreak Set" },
];

const ENDING_VARIABLES_ID = "cat:ending_variables";
const AGGREGATES_ID = "cat:aggregates";
const SMART_VARIABLES_ID = "cat:smart_variables";

/**
 * Shape a flat list of variables + folders into the picker's top-level
 * navigation. The result is meant to be rendered directly: top-level
 * categories first, then the user's folder tree (under Ending
 * Variables), then loose text variables at root.
 *
 * Variables that don't fit any known number_ref / aggregate_ref column
 * are silently dropped from the category buckets. Folder cycles are
 * tolerated: each folder is visited at most once, and orphans (whose
 * parent is missing) are surfaced at root rather than dropped.
 */
export function buildVariableTree(
  variables: ReadonlyArray<VariableState>,
  folders: ReadonlyArray<EndingVariableFolder>
): PickerNode[] {
  const textVariables = variables.filter((v) => v.kind === "text");
  const numberByRef = new Map<string, VariableState>();
  for (const v of variables) {
    if (v.kind === "number_ref" && v.number_ref) {
      numberByRef.set(v.number_ref, v);
    }
  }
  const aggregateByRef = new Map<string, VariableState>();
  for (const v of variables) {
    if (v.kind === "aggregate_ref" && v.aggregate_ref) {
      aggregateByRef.set(v.aggregate_ref, v);
    }
  }

  const out: PickerNode[] = [];

  out.push({
    type: "category",
    id: ENDING_VARIABLES_ID,
    label: "Ending Variables",
    children: buildEndingVariablesChildren(textVariables, folders),
  });

  for (const cat of NUMBER_REF_CATEGORIES) {
    const children = cat.columns
      .map((col) => numberByRef.get(col))
      .filter((v): v is VariableState => Boolean(v))
      .map<PickerNode>((v) => ({ type: "variable", id: v.id, variable: v }));
    if (children.length === 0) continue;
    out.push({
      type: "category",
      id: cat.id,
      label: cat.label,
      children,
    });
  }

  const smartVariables = variables
    .filter((v) => v.kind === "smart_ref")
    .slice()
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
  if (smartVariables.length > 0) {
    out.push({
      type: "category",
      id: SMART_VARIABLES_ID,
      label: "Smart Variables",
      children: smartVariables.map<PickerNode>((v) => ({
        type: "variable",
        id: v.id,
        variable: v,
      })),
    });
  }

  const aggregateChildren = AGGREGATE_CATEGORY.map(({ ref, label }) => {
    const v = aggregateByRef.get(ref);
    if (!v) return null;
    // Override the row label so authors see "Class Affinity" instead of
    // the raw variable name. Variable identity stays on `v` for commit.
    return { type: "variable" as const, id: v.id, variable: { ...v, name: label } };
  }).filter((x): x is { type: "variable"; id: string; variable: VariableState } => x !== null);
  if (aggregateChildren.length > 0) {
    out.push({
      type: "category",
      id: AGGREGATES_ID,
      label: "Aggregates",
      children: aggregateChildren,
    });
  }

  return out;
}

function buildEndingVariablesChildren(
  textVariables: ReadonlyArray<VariableState>,
  folders: ReadonlyArray<EndingVariableFolder>
): PickerNode[] {
  // Group folders by parent. Sort each parent's children by
  // (sort_order, name) — same convention as the variables page.
  const childFoldersByParent = new Map<string | null, EndingVariableFolder[]>();
  for (const f of folders) {
    const key = f.parent_folder_id ?? null;
    const list = childFoldersByParent.get(key) ?? [];
    list.push(f);
    childFoldersByParent.set(key, list);
  }
  for (const list of childFoldersByParent.values()) {
    list.sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
  }

  // Group text variables by folder_id (null = root).
  const variablesByFolder = new Map<string | null, VariableState[]>();
  for (const v of textVariables) {
    const key = v.folder_id ?? null;
    const list = variablesByFolder.get(key) ?? [];
    list.push(v);
    variablesByFolder.set(key, list);
  }
  for (const list of variablesByFolder.values()) {
    list.sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
  }

  // Recursive folder render with cycle guard.
  const visited = new Set<string>();
  function renderFolder(folder: EndingVariableFolder): PickerNode {
    visited.add(folder.id);
    const subFolders = (childFoldersByParent.get(folder.id) ?? []).filter(
      (f) => !visited.has(f.id)
    );
    const children: PickerNode[] = [
      ...subFolders.map(renderFolder),
      ...(variablesByFolder.get(folder.id) ?? []).map<PickerNode>((v) => ({
        type: "variable",
        id: v.id,
        variable: v,
      })),
    ];
    return {
      type: "folder",
      id: folder.id,
      label: folder.name,
      children,
    };
  }

  const rootFolders = childFoldersByParent.get(null) ?? [];
  const out: PickerNode[] = [
    ...rootFolders.map(renderFolder),
    ...(variablesByFolder.get(null) ?? []).map<PickerNode>((v) => ({
      type: "variable",
      id: v.id,
      variable: v,
    })),
  ];

  // Pick up orphan folders (parent_folder_id points to a missing
  // folder) at root so the variables underneath aren't lost.
  for (const f of folders) {
    if (visited.has(f.id)) continue;
    if (f.parent_folder_id == null) continue;
    if (!folders.some((other) => other.id === f.parent_folder_id)) {
      out.push(renderFolder(f));
    }
  }

  return out;
}

/**
 * Walk a path of node ids into the tree, returning the children at
 * that depth, or `null` if the path resolves to a leaf (variable) or
 * an invalid id. Used by the picker to render the current "level"
 * when the query is empty.
 */
export function nodesAtPath(
  tree: ReadonlyArray<PickerNode>,
  path: ReadonlyArray<string>
): PickerNode[] | null {
  let level: ReadonlyArray<PickerNode> = tree;
  for (const id of path) {
    const next = level.find((n) => n.id === id);
    if (!next) return null;
    if (next.type === "variable") return null;
    level = next.children;
  }
  return [...level];
}

/**
 * Filter the entire tree (across all levels) by a query string,
 * returning a flat list of nodes whose label or variable name matches.
 * Folder and category nodes match by their label so authors can type a
 * folder name to drill in directly. Variables match by name. Match
 * order: prefix matches first, then substring matches, alphabetical
 * within each group. Empty query returns null (caller should use
 * `nodesAtPath` instead).
 */
export function filterPickerTree(
  tree: ReadonlyArray<PickerNode>,
  query: string
): PickerNode[] | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;

  const flat: PickerNode[] = [];
  function walk(level: ReadonlyArray<PickerNode>) {
    for (const node of level) {
      flat.push(node);
      if (node.type !== "variable") walk(node.children);
    }
  }
  walk(tree);

  const prefix: PickerNode[] = [];
  const substring: PickerNode[] = [];
  for (const node of flat) {
    const label =
      node.type === "variable" ? node.variable.name : node.label;
    const lower = label.toLowerCase();
    if (lower.startsWith(q)) prefix.push(node);
    else if (lower.includes(q)) substring.push(node);
  }
  const byLabel = (a: PickerNode, b: PickerNode) => {
    const la = a.type === "variable" ? a.variable.name : a.label;
    const lb = b.type === "variable" ? b.variable.name : b.label;
    return la.localeCompare(lb);
  };
  prefix.sort(byLabel);
  substring.sort(byLabel);
  return [...prefix, ...substring];
}
