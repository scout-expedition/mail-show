import { describe, expect, it } from "vitest";
import { computeDefaultChipFor } from "./default-chip";
import type { ChipState, VariableState } from "./block-state";
import type { EndingVariableValue } from "@/lib/db/types";

function mkVar(over: Partial<VariableState> = {}): VariableState {
  return {
    id: "v1",
    name: "var",
    kind: "text",
    number_ref: null,
    aggregate_ref: null,
    default_value_id: null,
    color_index: 0,
    color_hex: null,
    folder_id: null,
    sort_order: 0,
    ...over,
  };
}

function mkValue(over: Partial<EndingVariableValue>): EndingVariableValue {
  return {
    id: "val1",
    variable_id: "v1",
    value: "x",
    sort_order: 0,
    ...over,
  };
}

function mkChip(over: Partial<ChipState> = {}): ChipState {
  return {
    id: "c1",
    row_id: "r1",
    variable_id: "v1",
    operator: "=",
    text_value_id: null,
    number_value: null,
    aggregate_value: null,
    sort_order: 0,
    ...over,
  };
}

describe("computeDefaultChipFor", () => {
  describe("text variables", () => {
    it("returns null when the variable has zero values defined", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "text" }),
        values: [],
        usedValuesOnBlock: [],
      });
      expect(out).toBeNull();
    });

    it("picks the first value in sort_order when nothing is used", () => {
      const values = [
        mkValue({ id: "vlt-b", sort_order: 1 }),
        mkValue({ id: "vlt-a", sort_order: 0 }),
        mkValue({ id: "vlt-c", sort_order: 2 }),
      ];
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "text" }),
        values,
        usedValuesOnBlock: [],
      });
      expect(out).toEqual({
        operator: "=",
        text_value_id: "vlt-a",
        number_value: null,
        aggregate_value: null,
      });
    });

    it("skips values already used by other chips on the same block", () => {
      const values = [
        mkValue({ id: "vlt-a", sort_order: 0 }),
        mkValue({ id: "vlt-b", sort_order: 1 }),
        mkValue({ id: "vlt-c", sort_order: 2 }),
      ];
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "text" }),
        values,
        usedValuesOnBlock: [
          mkChip({ id: "c-a", text_value_id: "vlt-a" }),
          mkChip({ id: "c-b", text_value_id: "vlt-b" }),
        ],
      });
      expect(out?.text_value_id).toBe("vlt-c");
    });

    it("only considers chips on this variable when computing the used set", () => {
      const values = [mkValue({ id: "vlt-a" }), mkValue({ id: "vlt-b", sort_order: 1 })];
      const out = computeDefaultChipFor({
        variable: mkVar({ id: "v1", kind: "text" }),
        values,
        usedValuesOnBlock: [
          mkChip({ variable_id: "v-other", text_value_id: "vlt-a" }),
        ],
      });
      // "vlt-a" was used by a chip on a DIFFERENT variable — must not skip it.
      expect(out?.text_value_id).toBe("vlt-a");
    });

    it("wraps to the variable's default_value_id when every value is used", () => {
      const values = [mkValue({ id: "vlt-a" }), mkValue({ id: "vlt-b", sort_order: 1 })];
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "text", default_value_id: "vlt-b" }),
        values,
        usedValuesOnBlock: [
          mkChip({ id: "c-a", text_value_id: "vlt-a" }),
          mkChip({ id: "c-b", text_value_id: "vlt-b" }),
        ],
      });
      expect(out?.text_value_id).toBe("vlt-b");
    });

    it("falls back to the first value when default_value_id is null and everything is used", () => {
      const values = [mkValue({ id: "vlt-a", sort_order: 0 }), mkValue({ id: "vlt-b", sort_order: 1 })];
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "text", default_value_id: null }),
        values,
        usedValuesOnBlock: [
          mkChip({ id: "c-a", text_value_id: "vlt-a" }),
          mkChip({ id: "c-b", text_value_id: "vlt-b" }),
        ],
      });
      expect(out?.text_value_id).toBe("vlt-a");
    });
  });

  describe("number_ref variables", () => {
    it("always returns 0 with `=` operator", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "number_ref", number_ref: "proletariat" }),
        values: [],
        usedValuesOnBlock: [],
      });
      expect(out).toEqual({
        operator: "=",
        text_value_id: null,
        number_value: 0,
        aggregate_value: null,
      });
    });
  });

  describe("aggregate_ref variables", () => {
    it("returns null when aggregate_ref is missing", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "aggregate_ref", aggregate_ref: null }),
        values: [],
        usedValuesOnBlock: [],
      });
      expect(out).toBeNull();
    });

    it("uses `top=` operator for class_affinity/nation_affinity", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({
          kind: "aggregate_ref",
          aggregate_ref: "class_affinity",
        }),
        values: [],
        usedValuesOnBlock: [],
      });
      expect(out?.operator).toBe("top=");
      expect(out?.aggregate_value).toBeDefined();
    });

    it("uses `set_includes` operator for nation_tiebreak_set", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({
          kind: "aggregate_ref",
          aggregate_ref: "nation_tiebreak_set",
        }),
        values: [],
        usedValuesOnBlock: [],
      });
      expect(out?.operator).toBe("set_includes");
    });

    it("picks the next unused aggregate option", () => {
      // nation_affinity options include known nation columns; pick the
      // first unused by skipping the first option as already-used.
      const first = computeDefaultChipFor({
        variable: mkVar({
          kind: "aggregate_ref",
          aggregate_ref: "nation_affinity",
        }),
        values: [],
        usedValuesOnBlock: [],
      })!;
      const firstOption = first.aggregate_value!;
      const second = computeDefaultChipFor({
        variable: mkVar({
          kind: "aggregate_ref",
          aggregate_ref: "nation_affinity",
        }),
        values: [],
        usedValuesOnBlock: [
          mkChip({ aggregate_value: firstOption, text_value_id: null }),
        ],
      });
      expect(second?.aggregate_value).not.toBe(firstOption);
    });
  });

  describe("smart_ref variables", () => {
    it("seeds with empty string when no returns are known", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "smart_ref" }),
        values: [],
        smartReturns: [],
        usedValuesOnBlock: [],
      });
      expect(out).toEqual({
        operator: "=",
        text_value_id: null,
        number_value: null,
        aggregate_value: "",
      });
    });

    it("picks the next unused return string", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "smart_ref" }),
        values: [],
        smartReturns: ["alpha", "beta", "gamma"],
        usedValuesOnBlock: [
          mkChip({ aggregate_value: "alpha" }),
          mkChip({ aggregate_value: "beta" }),
        ],
      });
      expect(out?.aggregate_value).toBe("gamma");
    });

    it("wraps to the first return when all are used", () => {
      const out = computeDefaultChipFor({
        variable: mkVar({ kind: "smart_ref" }),
        values: [],
        smartReturns: ["alpha", "beta"],
        usedValuesOnBlock: [
          mkChip({ aggregate_value: "alpha" }),
          mkChip({ aggregate_value: "beta" }),
        ],
      });
      expect(out?.aggregate_value).toBe("alpha");
    });
  });
});
