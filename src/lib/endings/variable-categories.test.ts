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
      "Variables",
      "Impact",
      "Class Affinity",
      "Nation Affinity",
    ]);
  });

  it("uses id cat:variables for the top-level Variables category", () => {
    const tree = buildVariableTree([], []);
    expect(tree[0].type).toBe("category");
    if (tree[0].type !== "category") throw new Error();
    expect(tree[0].id).toBe("cat:variables");
    expect(tree[0].label).toBe("Variables");
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

  it("inlines class_affinity aggregate into Class Affinity bucket, last", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "p", name: "Proletariat", kind: "number_ref", number_ref: "proletariat" }),
        mkVar({ id: "g", name: "Gentry", kind: "number_ref", number_ref: "gentry" }),
        mkVar({ id: "ca", name: "CA Agg", kind: "aggregate_ref", aggregate_ref: "class_affinity" }),
      ],
      []
    );
    const classCat = tree.find((n) => n.type === "category" && n.id === "cat:class_affinity");
    if (!classCat || classCat.type !== "category") throw new Error("Class Affinity category missing");
    const childNames = classCat.children.map((n) =>
      n.type === "variable" ? n.variable.name : "?"
    );
    // aggregate appended last with overridden label
    expect(childNames).toEqual(["Proletariat", "Gentry", "Class Affinity"]);
  });

  it("inlines nation_affinity aggregate and tiebreak into Nation Affinity bucket, in order", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "ep", name: "Epicenter", kind: "number_ref", number_ref: "epicenter" }),
        mkVar({ id: "na", name: "NA Agg", kind: "aggregate_ref", aggregate_ref: "nation_affinity" }),
        mkVar({ id: "tb", name: "TB", kind: "aggregate_ref", aggregate_ref: "nation_tiebreak_set" }),
      ],
      []
    );
    const nationCat = tree.find((n) => n.type === "category" && n.id === "cat:nation_affinity");
    if (!nationCat || nationCat.type !== "category") throw new Error("Nation Affinity category missing");
    const childNames = nationCat.children.map((n) =>
      n.type === "variable" ? n.variable.name : "?"
    );
    expect(childNames).toEqual(["Epicenter", "Nation Affinity", "Tiebreak Set"]);
  });

  it("shows Class Affinity bucket when only the aggregate exists (no proletariat/gentry)", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "ca", name: "CA Agg", kind: "aggregate_ref", aggregate_ref: "class_affinity" }),
      ],
      []
    );
    const classCat = tree.find((n) => n.type === "category" && n.id === "cat:class_affinity");
    expect(classCat).toBeDefined();
    if (!classCat || classCat.type !== "category") throw new Error();
    expect(classCat.children).toHaveLength(1);
    expect(classCat.children[0].type).toBe("variable");
    if (classCat.children[0].type === "variable") {
      expect(classCat.children[0].variable.name).toBe("Class Affinity");
    }
  });

  it("does not produce a standalone Aggregates category", () => {
    const tree = buildVariableTree(
      [
        mkVar({ id: "ca", name: "CA", kind: "aggregate_ref", aggregate_ref: "class_affinity" }),
        mkVar({ id: "na", name: "NA", kind: "aggregate_ref", aggregate_ref: "nation_affinity" }),
        mkVar({ id: "tb", name: "TB", kind: "aggregate_ref", aggregate_ref: "nation_tiebreak_set" }),
      ],
      []
    );
    expect(
      tree.find((n) => n.type === "category" && n.label === "Aggregates")
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
      id: "cat:variables",
      label: "Variables",
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
    const level = nodesAtPath(tree, ["cat:variables"]);
    expect(level?.length).toBe(1);
    expect(level?.[0].type).toBe("folder");
  });

  it("drills into a folder", () => {
    const level = nodesAtPath(tree, ["cat:variables", "f1"]);
    expect(level?.length).toBe(1);
    expect(level?.[0].type).toBe("variable");
  });

  it("returns null for a variable leaf", () => {
    expect(nodesAtPath(tree, ["cat:variables", "f1", "v1"])).toBeNull();
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

  it("does not include category nodes in search results", () => {
    // "impa" would match "Impact" (a category label), but categories are excluded
    const out = filterPickerTree(tree, "impa");
    expect(out?.some((n) => n.type === "category")).toBe(false);
    // "var" matches "Variables" category label — also excluded
    const out2 = filterPickerTree(tree, "var");
    expect(out2?.some((n) => n.type === "category")).toBe(false);
  });

  it("matches variable names and ranks prefix above substring", () => {
    const out = filterPickerTree(tree, "her");
    expect(out?.[0].type).toBe("variable");
    if (out?.[0].type === "variable") {
      expect(out[0].variable.name).toBe("Hero");
    }
  });
});
