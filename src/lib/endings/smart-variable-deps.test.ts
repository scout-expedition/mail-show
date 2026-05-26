import { describe, expect, it } from "vitest";
import { referencedVariableIdsForDoc } from "./smart-variable-deps";
import { AGGREGATE_OPTIONS_BY_REF } from "@/lib/db/enums";
import type { BlockState, ChipState, VariableState } from "./block-state";

// ---------------------------------------------------------------------------
// Minimal fixture builders — keep tests readable without duplicating data.
// ---------------------------------------------------------------------------

function makeVar(
  id: string,
  name: string,
  kind: VariableState["kind"],
  opts: {
    number_ref?: string | null;
    aggregate_ref?: VariableState["aggregate_ref"];
  } = {}
): VariableState {
  return {
    id,
    name,
    kind,
    number_ref: opts.number_ref ?? null,
    aggregate_ref: opts.aggregate_ref ?? null,
    default_value_id: null,
    color_index: 0,
    color_hex: null,
    folder_id: null,
    sort_order: 0,
  };
}

function makeChip(variableId: string): ChipState {
  return {
    id: `chip-${variableId}`,
    row_id: "r1",
    variable_id: variableId,
    operator: "=",
    text_value_id: null,
    number_value: null,
    aggregate_value: null,
    sort_order: 0,
  };
}

function makeTextBlock(id: string, text: string): BlockState {
  return {
    id,
    document_id: "doc-1",
    parent_block_id: null,
    parent_row_id: null,
    block_type: "text",
    text,
    result_value: null,
    summary: "",
    sort_order: 0,
  };
}

// ---------------------------------------------------------------------------
// referencedVariableIdsForDoc
// ---------------------------------------------------------------------------

describe("referencedVariableIdsForDoc", () => {
  describe("when the doc has only text and number_ref chips", () => {
    it("should include exactly the variable ids referenced by chips", () => {
      const textV = makeVar("v-text", "Performer", "text");
      const numV = makeVar("v-num", "Demerits", "number_ref", {
        number_ref: "demerits",
      });
      const result = referencedVariableIdsForDoc({
        blocks: [],
        chips: [makeChip(textV.id), makeChip(numV.id)],
        variables: [textV, numV],
      });
      expect(result.has(textV.id)).toBe(true);
      expect(result.has(numV.id)).toBe(true);
      expect(result.size).toBe(2);
    });
  });

  describe("when the doc has an aggregate_ref chip", () => {
    it("should include the aggregate_ref variable id AND all underlying impact column variable ids it expands to", () => {
      // Build number_ref variables for each class_affinity impact column.
      const aggCols = AGGREGATE_OPTIONS_BY_REF.class_affinity; // ["proletariat", "gentry"]
      const columnVars = aggCols.map((col) =>
        makeVar(`v-${col}`, col, "number_ref", { number_ref: col })
      );
      const aggV = makeVar("v-class", "Class Affinity", "aggregate_ref", {
        aggregate_ref: "class_affinity",
      });

      const result = referencedVariableIdsForDoc({
        blocks: [],
        chips: [makeChip(aggV.id)],
        variables: [aggV, ...columnVars],
      });

      // The aggregate_ref variable itself must be included.
      expect(result.has(aggV.id)).toBe(true);

      // Every underlying impact column variable must also be included.
      for (const v of columnVars) {
        expect(result.has(v.id)).toBe(true);
      }

      // Total: 1 aggregate + 2 underlying columns.
      expect(result.size).toBe(1 + columnVars.length);
    });

    it("should expand nation_affinity to all five impact column variable ids", () => {
      const aggCols = AGGREGATE_OPTIONS_BY_REF.nation_affinity;
      const columnVars = aggCols.map((col) =>
        makeVar(`v-${col}`, col, "number_ref", { number_ref: col })
      );
      const aggV = makeVar("v-nation", "Nation Affinity", "aggregate_ref", {
        aggregate_ref: "nation_affinity",
      });

      const result = referencedVariableIdsForDoc({
        blocks: [],
        chips: [makeChip(aggV.id)],
        variables: [aggV, ...columnVars],
      });

      expect(result.has(aggV.id)).toBe(true);
      expect(result.size).toBe(1 + aggCols.length);
    });
  });

  describe("when the doc has chips referencing a smart_ref variable", () => {
    it("should include the smart_ref id but NOT recurse into the smart variable's own doc", () => {
      // The smart_ref variable references another doc — the function must
      // include the smart_ref itself but must not follow smart_variable_doc_id.
      const smartV = makeVar("v-smart", "Outcome", "smart_ref");
      (smartV as VariableState & { smart_variable_doc_id: string }).smart_variable_doc_id =
        "other-doc-uuid";

      // A second text variable that would appear if recursion happened.
      const innerV = makeVar("v-inner", "InnerVar", "text");

      const result = referencedVariableIdsForDoc({
        blocks: [],
        chips: [makeChip(smartV.id)],
        variables: [smartV, innerV],
      });

      expect(result.has(smartV.id)).toBe(true);
      // inner var is not referenced by any chip or text token — must be absent.
      expect(result.has(innerV.id)).toBe(false);
      expect(result.size).toBe(1);
    });
  });

  describe("when text blocks contain @[VarName] tokens", () => {
    it("should include the variable id for each matched token", () => {
      const varA = makeVar("v-a", "Performer", "text");
      const varB = makeVar("v-b", "City", "text");

      const result = referencedVariableIdsForDoc({
        blocks: [
          makeTextBlock("b1", "Hello @[Performer] from @[City]!"),
        ],
        chips: [],
        variables: [varA, varB],
      });

      expect(result.has(varA.id)).toBe(true);
      expect(result.has(varB.id)).toBe(true);
      expect(result.size).toBe(2);
    });

    it("should not include a variable id for an unrecognised token name", () => {
      const varA = makeVar("v-a", "Performer", "text");

      const result = referencedVariableIdsForDoc({
        blocks: [makeTextBlock("b1", "Hi @[UnknownName]!")],
        chips: [],
        variables: [varA],
      });

      expect(result.size).toBe(0);
    });
  });

  describe("when the doc is empty", () => {
    it("should return an empty set", () => {
      const result = referencedVariableIdsForDoc({
        blocks: [],
        chips: [],
        variables: [],
      });
      expect(result.size).toBe(0);
    });
  });
});
