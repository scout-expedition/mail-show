// Shared model for the folder-aware variable picker used on the endings
// frameworks/logic editor surfaces (condition-block "add variable"
// button and the @-mention autocomplete in text blocks).
//
// Top-level navigation is a fixed list of five buckets — Variables,
// Smart Variables, Impact, Class Affinity, Nation Affinity — that
// shape number_ref / aggregate_ref variables into a stable ordering the
// authors recognize. Text variables live under Variables and nest into
// whatever folder tree the user maintains on /endings/variables.
//
// `buildVariableTree` is pure: it derives a `PickerNode[]` from the
// current `VariableState` list + `EndingVariableFolder` rows. The DB
// rows remain the source of truth; this module only shapes them.

import type { EndingVariableFolder } from "@/lib/db/types";
import type { VariableState } from "./block-state";
import type { NationIconRef } from "./variable-kind-icon";

export type PickerNode =
  | { type: "category"; id: string; label: string; children: PickerNode[] }
  | { type: "folder"; id: string; label: string; children: PickerNode[] }
  | { type: "variable"; id: string; variable: VariableState };

const VARIABLES_ID = "cat:variables";
const SMART_VARIABLES_ID = "cat:smart_variables";

/**
 * Shape a flat list of variables + folders into the picker's top-level
 * navigation. The result is meant to be rendered directly: top-level
 * categories first, then the user's folder tree (under Variables),
 * then loose text variables at root.
 *
 * Variables that don't fit any known number_ref / aggregate_ref column
 * are silently dropped from the category buckets. Folder cycles are
 * tolerated: each folder is visited at most once, and orphans (whose
 * parent is missing) are surfaced at root rather than dropped.
 *
 * `nations` is NOT consumed here — callers should pass the same array
 * straight to `<VariablePickerPanel nations={…} />`, which uses it for
 * per-nation icon resolution. Threaded through this signature so the
 * call-sites have a single source of truth and can't accidentally
 * default to `[]` (which would make every nation row fall back to a
 * generic globe icon).
 */
export function buildVariableTree(
  variables: ReadonlyArray<VariableState>,
  folders: ReadonlyArray<EndingVariableFolder>,
  nations: ReadonlyArray<NationIconRef> = []
): PickerNode[] {
  void nations; // consumed by variable-picker-panel, not here

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

  // 1. Variables (text variables in folder tree)
  out.push({
    type: "category",
    id: VARIABLES_ID,
    label: "Variables",
    children: buildEndingVariablesChildren(textVariables, folders),
  });

  // 2. Smart Variables (only if any)
  const smartVariableChildren = buildSmartVariablesChildren(variables);
  if (smartVariableChildren.length > 0) {
    out.push({
      type: "category",
      id: SMART_VARIABLES_ID,
      label: "Smart Variables",
      children: smartVariableChildren,
    });
  }

  // 3. Impact — world_status, demerits (no aggregates)
  const impactChildren = (["world_status", "demerits"] as const)
    .map((col) => numberByRef.get(col))
    .filter((v): v is VariableState => Boolean(v))
    .map<PickerNode>((v) => ({ type: "variable", id: v.id, variable: v }));
  if (impactChildren.length > 0) {
    out.push({
      type: "category",
      id: "cat:impact",
      label: "Impact",
      children: impactChildren,
    });
  }

  // 4. Class Affinity — proletariat, gentry, then class_affinity aggregate last
  const classAggregateVar = aggregateByRef.get("class_affinity");
  const classAggregateNode: PickerNode[] = classAggregateVar
    ? [
        {
          type: "variable",
          id: classAggregateVar.id,
          // Override label so authors see "Class Affinity" (not raw variable name).
          // Variable identity stays on `classAggregateVar` for commit.
          variable: { ...classAggregateVar, name: "Class Affinity" },
        },
      ]
    : [];
  const classChildren: PickerNode[] = [
    ...(["proletariat", "gentry"] as const)
      .map((col) => numberByRef.get(col))
      .filter((v): v is VariableState => Boolean(v))
      .map<PickerNode>((v) => ({ type: "variable", id: v.id, variable: v })),
    ...classAggregateNode,
  ];
  if (classChildren.length > 0) {
    out.push({
      type: "category",
      id: "cat:class_affinity",
      label: "Class Affinity",
      children: classChildren,
    });
  }

  // 5. Nation Affinity — five nation columns, then nation_affinity aggregate, then nation_tiebreak_set
  const nationAggregateVar = aggregateByRef.get("nation_affinity");
  const tiebreakVar = aggregateByRef.get("nation_tiebreak_set");
  const nationAggregateNodes: PickerNode[] = [
    ...(nationAggregateVar
      ? [
          {
            type: "variable" as const,
            id: nationAggregateVar.id,
            variable: { ...nationAggregateVar, name: "Nation Affinity" },
          },
        ]
      : []),
    ...(tiebreakVar
      ? [
          {
            type: "variable" as const,
            id: tiebreakVar.id,
            variable: { ...tiebreakVar, name: "Tiebreak Set" },
          },
        ]
      : []),
  ];
  const nationChildren: PickerNode[] = [
    ...(["epicenter", "folos", "emberlyn", "spokgrad", "pelico"] as const)
      .map((col) => numberByRef.get(col))
      .filter((v): v is VariableState => Boolean(v))
      .map<PickerNode>((v) => ({ type: "variable", id: v.id, variable: v })),
    ...nationAggregateNodes,
  ];
  if (nationChildren.length > 0) {
    out.push({
      type: "category",
      id: "cat:nation_affinity",
      label: "Nation Affinity",
      children: nationChildren,
    });
  }

  return out;
}

function buildSmartVariablesChildren(
  variables: ReadonlyArray<VariableState>
): PickerNode[] {
  return variables
    .filter((v) => v.kind === "smart_ref")
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map<PickerNode>((v) => ({ type: "variable", id: v.id, variable: v }));
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
 * Category nodes are excluded from search results — they are navigation
 * landmarks only, not insertable references. Folder nodes match by
 * their label so authors can type a folder name to drill in directly.
 * Variables match by name. Match order: prefix matches first, then
 * substring matches, alphabetical within each group. Empty query
 * returns null (caller should use `nodesAtPath` instead).
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

  // Exclude top-level category nodes from search results.
  const searchable = flat.filter((n) => n.type !== "category");

  const prefix: PickerNode[] = [];
  const substring: PickerNode[] = [];
  for (const node of searchable) {
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
