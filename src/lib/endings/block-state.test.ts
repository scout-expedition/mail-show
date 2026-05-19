import { describe, expect, it } from "vitest";
import {
  buildByParentBlock,
  buildChipsByRow,
  buildDeclaredByBlock,
  buildRowsByConditionBlock,
  parentKey,
  parentKeyOf,
  variablesReferencedByConditionBlock,
} from "./block-state";
import {
  makeBlockState,
  makeBlockVariableState,
  makeChipState,
  makeRowState,
} from "../../../tests/fixtures/builders";

describe("parentKey", () => {
  it("should join block and row ids with a colon", () => {
    expect(parentKey("block-7", "row-3")).toBe("block-7:row-3");
  });

  it("should fall back to 'root' for a null block id", () => {
    expect(parentKey(null, "row-3")).toBe("root:row-3");
  });

  it("should fall back to 'root' for a null row id", () => {
    expect(parentKey("block-7", null)).toBe("block-7:root");
  });

  it("should produce the root key when both ids are null", () => {
    expect(parentKey(null, null)).toBe("root:root");
  });
});

describe("parentKeyOf", () => {
  it("should derive the key from a block's parent fields", () => {
    const block = makeBlockState({
      parent_block_id: "block-2",
      parent_row_id: "row-9",
    });
    expect(parentKeyOf(block)).toBe("block-2:row-9");
  });

  it("should produce the root key for a top-level block", () => {
    const block = makeBlockState({
      parent_block_id: null,
      parent_row_id: null,
    });
    expect(parentKeyOf(block)).toBe("root:root");
  });
});

describe("buildByParentBlock", () => {
  describe("when given no blocks", () => {
    it("should return an empty map", () => {
      expect(buildByParentBlock([]).size).toBe(0);
    });
  });

  describe("when all blocks share one parent", () => {
    it("should group them under a single key", () => {
      const blocks = [
        makeBlockState({ id: "a", parent_block_id: "p", parent_row_id: "r" }),
        makeBlockState({ id: "b", parent_block_id: "p", parent_row_id: "r" }),
      ];
      const grouped = buildByParentBlock(blocks);
      expect(grouped.get("p:r")?.map((b) => b.id)).toEqual(["a", "b"]);
    });
  });

  describe("when blocks have different parents", () => {
    it("should split them into separate keyed groups", () => {
      const blocks = [
        makeBlockState({ id: "a", parent_block_id: "p1", parent_row_id: "r1" }),
        makeBlockState({ id: "b", parent_block_id: "p2", parent_row_id: "r2" }),
      ];
      const grouped = buildByParentBlock(blocks);
      expect(grouped.get("p1:r1")?.map((b) => b.id)).toEqual(["a"]);
      expect(grouped.get("p2:r2")?.map((b) => b.id)).toEqual(["b"]);
    });
  });

  describe("when input order does not match sort_order", () => {
    it("should sort each group ascending by sort_order", () => {
      const blocks = [
        makeBlockState({ id: "third", sort_order: 30 }),
        makeBlockState({ id: "first", sort_order: 10 }),
        makeBlockState({ id: "second", sort_order: 20 }),
      ];
      const grouped = buildByParentBlock(blocks);
      expect(grouped.get("root:root")?.map((b) => b.id)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  describe("when blocks mix root and nested parents", () => {
    it("should key root blocks separately from nested blocks", () => {
      const blocks = [
        makeBlockState({ id: "root-block" }),
        makeBlockState({
          id: "nested-block",
          parent_block_id: "cond",
          parent_row_id: "row",
        }),
      ];
      const grouped = buildByParentBlock(blocks);
      expect(grouped.get("root:root")?.map((b) => b.id)).toEqual([
        "root-block",
      ]);
      expect(grouped.get("cond:row")?.map((b) => b.id)).toEqual([
        "nested-block",
      ]);
    });
  });
});

describe("buildDeclaredByBlock", () => {
  describe("when given no block variables", () => {
    it("should return an empty map", () => {
      expect(buildDeclaredByBlock([]).size).toBe(0);
    });
  });

  describe("when block variables belong to different blocks", () => {
    it("should group them by condition_block_id", () => {
      const blockVars = [
        makeBlockVariableState({ id: "bv-a", condition_block_id: "block-1" }),
        makeBlockVariableState({ id: "bv-b", condition_block_id: "block-2" }),
      ];
      const grouped = buildDeclaredByBlock(blockVars);
      expect(grouped.get("block-1")?.map((bv) => bv.id)).toEqual(["bv-a"]);
      expect(grouped.get("block-2")?.map((bv) => bv.id)).toEqual(["bv-b"]);
    });
  });

  describe("when input order does not match sort_order", () => {
    it("should sort each block's variables ascending by sort_order", () => {
      const blockVars = [
        makeBlockVariableState({ id: "late", sort_order: 5 }),
        makeBlockVariableState({ id: "early", sort_order: 1 }),
      ];
      const grouped = buildDeclaredByBlock(blockVars);
      expect(grouped.get("block-1")?.map((bv) => bv.id)).toEqual([
        "early",
        "late",
      ]);
    });
  });
});

describe("buildRowsByConditionBlock", () => {
  describe("when given no rows", () => {
    it("should return an empty map", () => {
      expect(buildRowsByConditionBlock([]).size).toBe(0);
    });
  });

  describe("when rows belong to different condition blocks", () => {
    it("should group them by condition_block_id", () => {
      const rows = [
        makeRowState({ id: "r-a", condition_block_id: "block-1" }),
        makeRowState({ id: "r-b", condition_block_id: "block-2" }),
      ];
      const grouped = buildRowsByConditionBlock(rows);
      expect(grouped.get("block-1")?.map((r) => r.id)).toEqual(["r-a"]);
      expect(grouped.get("block-2")?.map((r) => r.id)).toEqual(["r-b"]);
    });
  });

  describe("when input order does not match sort_order", () => {
    it("should sort each block's rows ascending by sort_order", () => {
      const rows = [
        makeRowState({ id: "bottom", sort_order: 2 }),
        makeRowState({ id: "top", sort_order: 0 }),
        makeRowState({ id: "middle", sort_order: 1 }),
      ];
      const grouped = buildRowsByConditionBlock(rows);
      expect(grouped.get("block-1")?.map((r) => r.id)).toEqual([
        "top",
        "middle",
        "bottom",
      ]);
    });
  });
});

describe("buildChipsByRow", () => {
  describe("when given no chips", () => {
    it("should return an empty map", () => {
      expect(buildChipsByRow([]).size).toBe(0);
    });
  });

  describe("when chips belong to different rows", () => {
    it("should group them by row_id", () => {
      const chips = [
        makeChipState({ id: "c-a", row_id: "row-1" }),
        makeChipState({ id: "c-b", row_id: "row-2" }),
      ];
      const grouped = buildChipsByRow(chips);
      expect(grouped.get("row-1")?.map((c) => c.id)).toEqual(["c-a"]);
      expect(grouped.get("row-2")?.map((c) => c.id)).toEqual(["c-b"]);
    });
  });

  describe("when input order does not match sort_order", () => {
    it("should sort each row's chips ascending by sort_order", () => {
      const chips = [
        makeChipState({ id: "right", sort_order: 9 }),
        makeChipState({ id: "left", sort_order: 3 }),
      ];
      const grouped = buildChipsByRow(chips);
      expect(grouped.get("row-1")?.map((c) => c.id)).toEqual(["left", "right"]);
    });
  });
});

describe("variablesReferencedByConditionBlock", () => {
  describe("when the block has no rows", () => {
    it("should return an empty list", () => {
      const chips = [makeChipState({ row_id: "row-other" })];
      expect(variablesReferencedByConditionBlock("block-1", [], chips)).toEqual(
        []
      );
    });
  });

  describe("when the block's rows have no chips", () => {
    it("should return an empty list", () => {
      const rows = [makeRowState({ id: "row-1", condition_block_id: "block-1" })];
      expect(variablesReferencedByConditionBlock("block-1", rows, [])).toEqual(
        []
      );
    });
  });

  describe("when chips reference the same variable more than once", () => {
    it("should return that variable id only once", () => {
      const rows = [
        makeRowState({ id: "row-1", condition_block_id: "block-1" }),
        makeRowState({ id: "row-2", condition_block_id: "block-1" }),
      ];
      const chips = [
        makeChipState({ id: "c1", row_id: "row-1", variable_id: "var-x" }),
        makeChipState({ id: "c2", row_id: "row-2", variable_id: "var-x" }),
      ];
      expect(
        variablesReferencedByConditionBlock("block-1", rows, chips)
      ).toEqual(["var-x"]);
    });
  });

  describe("when chips reference several distinct variables", () => {
    it("should return every distinct variable id", () => {
      const rows = [makeRowState({ id: "row-1", condition_block_id: "block-1" })];
      const chips = [
        makeChipState({ id: "c1", row_id: "row-1", variable_id: "var-a" }),
        makeChipState({ id: "c2", row_id: "row-1", variable_id: "var-b" }),
      ];
      expect(
        variablesReferencedByConditionBlock("block-1", rows, chips).sort()
      ).toEqual(["var-a", "var-b"]);
    });
  });

  describe("when chips sit on rows owned by other blocks", () => {
    it("should exclude variables referenced only outside the block", () => {
      const rows = [
        makeRowState({ id: "mine", condition_block_id: "block-1" }),
        makeRowState({ id: "theirs", condition_block_id: "block-2" }),
      ];
      const chips = [
        makeChipState({ id: "c1", row_id: "mine", variable_id: "var-mine" }),
        makeChipState({
          id: "c2",
          row_id: "theirs",
          variable_id: "var-theirs",
        }),
      ];
      expect(
        variablesReferencedByConditionBlock("block-1", rows, chips)
      ).toEqual(["var-mine"]);
    });
  });
});
