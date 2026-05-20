import { describe, expect, it } from "vitest";
import {
  buildVariableTree,
  filterPickerTree,
  nodesAtPath,
  type PickerNode,
} from "./variable-categories";
import type { VariableState } from "./block-state";
import type { EndingVariableFolder } from "@/lib/db/types";

function mkVar(
  partial: Partial<VariableState> & Pick<VariableState, "id" | "name" | "kind">
): VariableState {
  return {
    number_ref: null,
    aggregate_ref: null,
    default_value_id: null,
    color_index: 0,
    color_hex: null,
    folder_id: null,
    sort_order: 0,
    ...partial,
  } as VariableState;
}

function mkFolder(
  partial: Partial<EndingVariableFolder> &
    Pick<EndingVariableFolder, "id" | "name">
): EndingVariableFolder {
  return {
    parent_folder_id: null,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...partial,
  } as EndingVariableFolder;
}

describe("buildVariableTree", () => {
  it("places top-level categories in the canonical order", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "a", name: "Atmosphere", kind: "text" }),
        mkVar({
          id: "b",
          name: "World Status",
          kind: "number_ref",
          number_ref: "world_status",
        }),
        mkVar({
          id: "c",
          name: "Proletariat",
          kind: "number_ref",
          number_ref: "proletariat",
        }),
        mkVar({
          id: "d",
          name: "Epicenter",
          kind: "number_ref",
          number_ref: "epicenter",
        }),
        mkVar({
          id: "e",
          name: "Class Affinity",
          kind: "aggregate_ref",
          aggregate_ref: "class_affinity",
        }),
      ],
      []
    );
    const labels = tree.map((n) => (n.type !== "variable" ? n.label : "?"));
    expect(labels).toEqual([
      "Ending Variables",
      "Impact",
      "Class Affinity",
      "Nation Affinity",
      "Aggregates",
    ]);
  });

  it("omits number_ref categories with no matching variables", () => {
    const tree = buildVariableTree(
      [mkVar({ id: "a", name: "Mood", kind: "text" })],
      []
    );
    expect(
      tree.find((n) => n.type === "category" && n.label === "Impact")
    ).toBeUndefined();
    expect(
      tree.find((n) => n.type === "category" && n.label === "Class Affinity")
    ).toBeUndefined();
  });

  it("nests text variables under folders", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "a", name: "Hero", kind: "text", folder_id: "f1" }),
        mkVar({ id: "b", name: "Villain", kind: "text", folder_id: "f1" }),
        mkVar({ id: "c", name: "Loose", kind: "text", folder_id: null }),
      ],
      [mkFolder({ id: "f1", name: "Characters" })]
    );
    const ending = tree[0];
    if (ending.type !== "category") throw new Error("expected category");
    const folder = ending.children.find((n) => n.type === "folder");
    expect(folder?.type).toBe("folder");
    if (folder?.type !== "folder") throw new Error();
    expect(folder.label).toBe("Characters");
    expect(folder.children.map((n) => (n.type === "variable" ? n.variable.name : ""))).toEqual([
      "Hero",
      "Villain",
    ]);
    const loose = ending.children.find(
      (n) => n.type === "variable" && n.variable.name === "Loose"
    );
    expect(loose).toBeDefined();
  });

  it("preserves nested folder structure", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "a", name: "Inner", kind: "text", folder_id: "f-inner" }),
      ],
      [
        mkFolder({ id: "f-outer", name: "Outer" }),
        mkFolder({
          id: "f-inner",
          name: "Inner",
          parent_folder_id: "f-outer",
        }),
      ]
    );
    const ending = tree[0];
    if (ending.type !== "category") throw new Error();
    const outer = ending.children[0];
    if (outer.type !== "folder") throw new Error();
    expect(outer.label).toBe("Outer");
    const inner = outer.children[0];
    if (inner.type !== "folder") throw new Error();
    expect(inner.label).toBe("Inner");
    expect(inner.children[0].type).toBe("variable");
  });

  it("tolerates folder cycles without infinite recursion", () => {
    const tree = buildVariableTree(
      [],
      [
        mkFolder({ id: "a", name: "A", parent_folder_id: "b" }),
        mkFolder({ id: "b", name: "B", parent_folder_id: "a" }),
      ]
    );
    expect(tree.length).toBeGreaterThan(0);
  });

  it("includes folders with missing parents at root", () => {
    const tree = buildVariableTree(
      [mkVar({ id: "a", name: "X", kind: "text", folder_id: "orphan" })],
      [
        mkFolder({
          id: "orphan",
          name: "Orphan",
          parent_folder_id: "missing-parent",
        }),
      ]
    );
    const ending = tree[0];
    if (ending.type !== "category") throw new Error();
    const orphan = ending.children.find(
      (n) => n.type === "folder" && n.label === "Orphan"
    );
    expect(orphan).toBeDefined();
  });
});

describe("nodesAtPath", () => {
  const tree: PickerNode[] = [
    {
      type: "category",
      id: "cat:ending_variables",
      label: "Ending Variables",
      children: [
        {
          type: "folder",
          id: "f1",
          label: "Characters",
          children: [
            {
              type: "variable",
              id: "v1",
              variable: mkVar({ id: "v1", name: "Hero", kind: "text" }),
            },
          ],
        },
      ],
    },
  ];

  it("returns the top level for an empty path", () => {
    expect(nodesAtPath(tree, [])?.length).toBe(1);
  });

  it("drills into a category", () => {
    const level = nodesAtPath(tree, ["cat:ending_variables"]);
    expect(level?.length).toBe(1);
    expect(level?.[0].type).toBe("folder");
  });

  it("drills into a folder", () => {
    const level = nodesAtPath(tree, ["cat:ending_variables", "f1"]);
    expect(level?.length).toBe(1);
    expect(level?.[0].type).toBe("variable");
  });

  it("returns null for a variable leaf", () => {
    expect(nodesAtPath(tree, ["cat:ending_variables", "f1", "v1"])).toBeNull();
  });
});

describe("filterPickerTree", () => {
  const tree = buildVariableTree(
    [
      mkVar({ id: "v-hero", name: "Hero", kind: "text" }),
      mkVar({
        id: "v-ws",
        name: "World Status",
        kind: "number_ref",
        number_ref: "world_status",
      }),
    ],
    [mkFolder({ id: "f1", name: "Characters" })]
  );

  it("returns null for empty queries", () => {
    expect(filterPickerTree(tree, "")).toBeNull();
    expect(filterPickerTree(tree, "   ")).toBeNull();
  });

  it("matches folder names", () => {
    const out = filterPickerTree(tree, "char");
    expect(out?.some((n) => n.type === "folder" && n.label === "Characters")).toBe(true);
  });

  it("matches category labels", () => {
    const out = filterPickerTree(tree, "impa");
    expect(out?.some((n) => n.type === "category" && n.label === "Impact")).toBe(true);
  });

  it("matches variable names and ranks prefix above substring", () => {
    const out = filterPickerTree(tree, "her");
    expect(out?.[0].type).toBe("variable");
    if (out?.[0].type === "variable") {
      expect(out[0].variable.name).toBe("Hero");
    }
  });
});
