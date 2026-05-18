import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTIONS,
  evaluateDocument,
  evaluateDocumentDetailed,
  evaluateFramework,
  evaluateChip,
  evaluateRow,
  matchingRowsByBlock,
  resolveAggregatesDetailed,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
  type PreviewSelections,
} from "./evaluator";
import type { EndingLogicKind } from "@/lib/db/enums";

const textVar = (id: string, name = id): EvalVariable => ({
  id,
  name,
  kind: "text",
  aggregate_ref: null,
});
const numVar = (id: string, name = id): EvalVariable => ({
  id,
  name,
  kind: "number_ref",
  aggregate_ref: null,
});
const aggVar = (
  id: string,
  ref: "class_affinity" | "nation_affinity",
  name = id
): EvalVariable => ({
  id,
  name,
  kind: "aggregate_ref",
  aggregate_ref: ref,
});

const textChip = (
  id: string,
  rowId: string,
  variableId: string,
  textValueId: string,
  operator: "=" | "≠" = "=",
  sortOrder = 0
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: textValueId,
  number_value: null,
  aggregate_value: null,
  sort_order: sortOrder,
});

const numChip = (
  id: string,
  rowId: string,
  variableId: string,
  number: number,
  operator: "=" | "≠" | "<" | "≤" | ">" | "≥",
  sortOrder = 0
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: null,
  number_value: number,
  aggregate_value: null,
  sort_order: sortOrder,
});

const aggChip = (
  id: string,
  rowId: string,
  variableId: string,
  aggregateValue: string,
  operator: "top=" | "top≠" | "bottom=" | "bottom≠",
  sortOrder = 0
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: null,
  number_value: null,
  aggregate_value: aggregateValue,
  sort_order: sortOrder,
});

const textBlock = (
  id: string,
  text: string,
  parentBlockId: string | null = null,
  parentRowId: string | null = null,
  sortOrder = 0
): EvalBlock => ({
  id,
  parent_block_id: parentBlockId,
  parent_row_id: parentRowId,
  block_type: "text",
  text,
  sort_order: sortOrder,
});

const condBlock = (
  id: string,
  parentBlockId: string | null = null,
  parentRowId: string | null = null,
  sortOrder = 0
): EvalBlock => ({
  id,
  parent_block_id: parentBlockId,
  parent_row_id: parentRowId,
  block_type: "condition",
  text: "",
  sort_order: sortOrder,
});

const resultBlock = (
  id: string,
  resultValue: string,
  parentBlockId: string | null = null,
  parentRowId: string | null = null,
  sortOrder = 0
): EvalBlock => ({
  id,
  parent_block_id: parentBlockId,
  parent_row_id: parentRowId,
  block_type: "result",
  text: "",
  result_value: resultValue,
  sort_order: sortOrder,
});

const row = (
  id: string,
  conditionBlockId: string,
  sortOrder = 0
): EvalRow => ({
  id,
  condition_block_id: conditionBlockId,
  sort_order: sortOrder,
});

const textSelections = (
  pairs: Record<string, string | null>
): PreviewSelections => ({ textValueIds: pairs, numbers: {} });

const numSelections = (
  pairs: Record<string, number | null>
): PreviewSelections => ({ textValueIds: {}, numbers: pairs });

// ----------------------------------------------------------------------
// evaluateChip — text variables, equality only
// ----------------------------------------------------------------------

describe("evaluateChip / text", () => {
  const variable = textVar("VAR_PERFORMER");

  it.each([
    ["=", "WINTER", "WINTER", true],
    ["=", "WINTER", "SUMMER", false],
    ["≠", "WINTER", "WINTER", false],
    ["≠", "WINTER", "SUMMER", true],
  ] as const)(
    "operator %s, chip value=%s, selected=%s → %s",
    (op, chipVal, selectedVal, expected) => {
      const chip = textChip("c", "r", variable.id, chipVal, op);
      const sel = textSelections({ [variable.id]: selectedVal });
      expect(evaluateChip(chip, variable, sel)).toBe(expected);
    }
  );

  it("returns false when the variable is unset (no fall-through)", () => {
    const chip = textChip("c", "r", variable.id, "WINTER");
    const sel = textSelections({});
    expect(evaluateChip(chip, variable, sel)).toBe(false);
  });

  it("returns false for numeric operators on text variables", () => {
    const chip = textChip("c", "r", variable.id, "WINTER", "=");
    chip.operator = ">"; // force-mismatched
    const sel = textSelections({ [variable.id]: "WINTER" });
    expect(evaluateChip(chip, variable, sel)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// evaluateChip — number_ref variables, full operator matrix
// ----------------------------------------------------------------------

describe("evaluateChip / number_ref", () => {
  const variable = numVar("VAR_WORLD");

  it.each([
    ["=", 0, 0, true],
    ["=", 0, 1, false],
    ["≠", 0, 1, true],
    ["≠", 0, 0, false],
    ["<", 5, 4, true],
    ["<", 5, 5, false],
    ["<", 5, 6, false],
    ["≤", 5, 5, true],
    ["≤", 5, 6, false],
    [">", 5, 6, true],
    [">", 5, 5, false],
    ["≥", 5, 5, true],
    ["≥", 5, 4, false],
    ["≥", 0, -1, false],
    ["≥", 0, 0, true],
    ["<", 0, -1, true],
  ] as const)(
    "operator %s, target=%s, value=%s → %s",
    (op, target, value, expected) => {
      const chip = numChip("c", "r", variable.id, target, op);
      const sel = numSelections({ [variable.id]: value });
      expect(evaluateChip(chip, variable, sel)).toBe(expected);
    }
  );

  it("returns false when the numeric variable is unset", () => {
    const chip = numChip("c", "r", variable.id, 0, "≥");
    const sel = numSelections({});
    expect(evaluateChip(chip, variable, sel)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// evaluateChip — aggregate_ref variables (Phase 4)
// ----------------------------------------------------------------------

describe("evaluateChip / aggregate_ref", () => {
  // Stand-in number_ref variable IDs for the underlying impact columns.
  // The evaluator looks them up via `selections.numberRefByName`.
  const PROLETARIAT = "var-proletariat";
  const GENTRY = "var-gentry";
  const FOLOS = "var-folos";
  const EMBERLYN = "var-emberlyn";
  const SPOKGRAD = "var-spokgrad";
  const PELICO = "var-pelico";
  const EPICENTER = "var-epicenter";

  function classSelections(
    proletariat: number | null,
    gentry: number | null
  ): PreviewSelections {
    return {
      textValueIds: {},
      numbers: { [PROLETARIAT]: proletariat, [GENTRY]: gentry },
      numberRefByName: new Map<string, string>([
        ["proletariat", PROLETARIAT],
        ["gentry", GENTRY],
      ]),
    };
  }

  function nationSelections(values: {
    folos: number | null;
    emberlyn: number | null;
    spokgrad: number | null;
    pelico: number | null;
    epicenter: number | null;
  }): PreviewSelections {
    return {
      textValueIds: {},
      numbers: {
        [FOLOS]: values.folos,
        [EMBERLYN]: values.emberlyn,
        [SPOKGRAD]: values.spokgrad,
        [PELICO]: values.pelico,
        [EPICENTER]: values.epicenter,
      },
      numberRefByName: new Map<string, string>([
        ["folos", FOLOS],
        ["emberlyn", EMBERLYN],
        ["spokgrad", SPOKGRAD],
        ["pelico", PELICO],
        ["epicenter", EPICENTER],
      ]),
    };
  }

  const klass = aggVar("VAR_CLASS", "class_affinity");
  const nation = aggVar("VAR_NATION", "nation_affinity");

  it.each([
    // class_affinity: proletariat=5, gentry=2
    ["top=", "proletariat", 5, 2, true],
    ["top=", "gentry", 5, 2, false],
    ["top≠", "gentry", 5, 2, true],
    ["top≠", "proletariat", 5, 2, false],
    ["bottom=", "gentry", 5, 2, true],
    ["bottom=", "proletariat", 5, 2, false],
    ["bottom≠", "proletariat", 5, 2, true],
    ["bottom≠", "gentry", 5, 2, false],
    // Reversed scores
    ["top=", "gentry", 1, 4, true],
    ["bottom=", "proletariat", 1, 4, true],
  ] as const)(
    "class_affinity %s %s with proletariat=%s gentry=%s → %s",
    (op, target, proletariat, gentry, expected) => {
      const chip = aggChip("c", "r", klass.id, target as string, op);
      const sel = classSelections(proletariat, gentry);
      expect(evaluateChip(chip, klass, sel)).toBe(expected);
    }
  );

  it("ties produce no match for any aggregate operator", () => {
    const sel = classSelections(5, 5);
    for (const op of ["top=", "top≠", "bottom=", "bottom≠"] as const) {
      const chip = aggChip("c", "r", klass.id, "proletariat", op);
      expect(evaluateChip(chip, klass, sel)).toBe(false);
    }
  });

  it("any underlying score unset → no match", () => {
    const sel = classSelections(null, 2);
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("missing numberRefByName map → no match", () => {
    const sel: PreviewSelections = {
      textValueIds: {},
      numbers: { [PROLETARIAT]: 5, [GENTRY]: 2 },
      // numberRefByName intentionally omitted
    };
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("nation_affinity picks epicenter when it has the highest score", () => {
    const sel = nationSelections({
      folos: 3,
      emberlyn: 1,
      spokgrad: 2,
      pelico: 0,
      epicenter: 4,
    });
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "epicenter", "top="),
        nation,
        sel
      )
    ).toBe(true);
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "folos", "top="),
        nation,
        sel
      )
    ).toBe(false);
  });

  it("nation_affinity picks pelico as the bottom when it has the lowest score", () => {
    const sel = nationSelections({
      folos: 3,
      emberlyn: 1,
      spokgrad: 2,
      pelico: 0,
      epicenter: 4,
    });
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "pelico", "bottom="),
        nation,
        sel
      )
    ).toBe(true);
  });

  it("aggregate_value missing from chip → no match", () => {
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    chip.aggregate_value = null;
    const sel = classSelections(5, 2);
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("non-aggregate operator on an aggregate variable → no match", () => {
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    // Force a numeric operator on an aggregate variable.
    (chip as { operator: string }).operator = "≥";
    const sel = classSelections(5, 2);
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// evaluateRow — AND across chips, empty rows fail
// ----------------------------------------------------------------------

describe("evaluateRow", () => {
  const performer = textVar("PERFORMER");
  const mood = textVar("MOOD");
  const index = new Map([
    [performer.id, performer],
    [mood.id, mood],
  ]);

  it("matches when every chip matches (AND)", () => {
    const chips = [
      textChip("c1", "r", performer.id, "WINTER"),
      textChip("c2", "r", mood.id, "STORMY"),
    ];
    const sel = textSelections({
      [performer.id]: "WINTER",
      [mood.id]: "STORMY",
    });
    expect(evaluateRow(chips, index, sel)).toBe(true);
  });

  it("fails when any chip fails", () => {
    const chips = [
      textChip("c1", "r", performer.id, "WINTER"),
      textChip("c2", "r", mood.id, "STORMY"),
    ];
    const sel = textSelections({
      [performer.id]: "WINTER",
      [mood.id]: "CALM",
    });
    expect(evaluateRow(chips, index, sel)).toBe(false);
  });

  it("returns false for an empty row (no chips → no condition)", () => {
    const sel = textSelections({ [performer.id]: "WINTER" });
    expect(evaluateRow([], index, sel)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// evaluateFramework — full block tree, first-match-wins, nesting
// ----------------------------------------------------------------------

describe("evaluateFramework", () => {
  it("renders text blocks in sort order", () => {
    const blocks: EvalBlock[] = [
      textBlock("b1", "Hello", null, null, 0),
      textBlock("b2", "World", null, null, 1),
    ];
    const out = evaluateFramework({
      blocks,
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual(["Hello", "World"]);
  });

  it("skips text blocks whose trimmed content is empty", () => {
    const blocks: EvalBlock[] = [
      textBlock("b1", "   ", null, null, 0),
      textBlock("b2", "kept", null, null, 1),
    ];
    const out = evaluateFramework({
      blocks,
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual(["kept"]);
  });

  it("emits nothing for a condition block with no rows", () => {
    const blocks: EvalBlock[] = [condBlock("cb1", null, null, 0)];
    const out = evaluateFramework({
      blocks,
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual([]);
  });

  it("emits the matching row's child content (single-chip equality)", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb1");
    const r1 = row("r1", cb.id, 0);
    const child = textBlock("b-child", "winter rose lyric", cb.id, r1.id, 0);
    const out = evaluateFramework({
      blocks: [cb, child],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["winter rose lyric"]);
  });

  it("first-match-wins: only row 1 fires when both rows match", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb1");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const c1 = textChip("c1", r1.id, performer.id, "WINTER");
    const c2 = textChip("c2", r2.id, performer.id, "WINTER"); // same condition
    const child1 = textBlock("b1", "row 1 content", cb.id, r1.id, 0);
    const child2 = textBlock("b2", "row 2 content", cb.id, r2.id, 0);
    const out = evaluateFramework({
      blocks: [cb, child1, child2],
      rows: [r1, r2],
      chips: [c1, c2],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["row 1 content"]);
  });

  it("falls through to row 2 when row 1 doesn't match", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb1");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = evaluateFramework({
      blocks: [
        cb,
        textBlock("b1", "row 1", cb.id, r1.id, 0),
        textBlock("b2", "row 2", cb.id, r2.id, 0),
      ],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, "SUMMER"),
        textChip("c2", r2.id, performer.id, "WINTER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["row 2"]);
  });

  it("emits nothing when no row matches", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb1");
    const r1 = row("r1", cb.id, 0);
    const out = evaluateFramework({
      blocks: [cb, textBlock("b1", "x", cb.id, r1.id, 0)],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: textSelections({ [performer.id]: "SUMMER" }),
    });
    expect(out).toEqual([]);
  });

  it("emits nothing when an unset variable is referenced", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb1");
    const r1 = row("r1", cb.id, 0);
    const out = evaluateFramework({
      blocks: [cb, textBlock("b1", "x", cb.id, r1.id, 0)],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual([]);
  });

  it("resolves nested condition blocks under a row", () => {
    const performer = textVar("PERFORMER");
    const mood = textVar("MOOD");
    const outerCb = condBlock("outer");
    const outerRow = row("outerRow", outerCb.id);
    const innerCb = condBlock("inner", outerCb.id, outerRow.id);
    const innerRow = row("innerRow", innerCb.id);
    const inner = textBlock(
      "leaf",
      "deep paragraph",
      innerCb.id,
      innerRow.id,
      0
    );
    const out = evaluateFramework({
      blocks: [outerCb, innerCb, inner],
      rows: [outerRow, innerRow],
      chips: [
        textChip("c1", outerRow.id, performer.id, "WINTER"),
        textChip("c2", innerRow.id, mood.id, "STORMY"),
      ],
      variables: [performer, mood],
      selections: textSelections({
        [performer.id]: "WINTER",
        [mood.id]: "STORMY",
      }),
    });
    expect(out).toEqual(["deep paragraph"]);
  });

  it("AND across two chips on one row: both must match", () => {
    const performer = textVar("PERFORMER");
    const mood = textVar("MOOD");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id);
    const child = textBlock("b1", "fires", cb.id, r1.id);
    const inputs = {
      blocks: [cb, child],
      rows: [r1],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER", "=", 0),
        textChip("c2", r1.id, mood.id, "STORMY", "=", 1),
      ],
      variables: [performer, mood],
    };
    expect(
      evaluateFramework({
        ...inputs,
        selections: textSelections({
          [performer.id]: "WINTER",
          [mood.id]: "STORMY",
        }),
      })
    ).toEqual(["fires"]);
    expect(
      evaluateFramework({
        ...inputs,
        selections: textSelections({
          [performer.id]: "WINTER",
          [mood.id]: "CALM",
        }),
      })
    ).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// matchingRowsByBlock — Phase 3 hook (overlap detection)
// ----------------------------------------------------------------------

describe("matchingRowsByBlock", () => {
  it("reports every row that would match in isolation, before first-match-wins shadowing", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const r3 = row("r3", cb.id, 2);
    const out = matchingRowsByBlock({
      blocks: [cb],
      rows: [r1, r2, r3],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "WINTER"),
        textChip("c3", r3.id, performer.id, "SUMMER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out.get(cb.id)).toEqual([r1.id, r2.id]);
  });
});

// ----------------------------------------------------------------------
// shadowedRowIds — Phase 3 overlap detection
// ----------------------------------------------------------------------

describe("shadowedRowIds", () => {
  it("returns empty when no rows match", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: textSelections({ [performer.id]: "SUMMER" }),
    });
    expect(out.size).toBe(0);
  });

  it("returns empty when exactly one row matches", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "SUMMER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out.size).toBe(0);
  });

  it("flags later matching rows but not the winner", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const r3 = row("r3", cb.id, 2);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [r1, r2, r3],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "WINTER"),
        textChip("c3", r3.id, performer.id, "WINTER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect([...out].sort()).toEqual([r2.id, r3.id].sort());
  });

  it("only the first match wins per block — sort_order, not array order", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    // Insert in reverse sort_order to verify the evaluator orders by sort_order.
    const rLater = row("rLater", cb.id, 1);
    const rFirst = row("rFirst", cb.id, 0);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [rLater, rFirst],
      chips: [
        textChip("c1", rLater.id, performer.id, "WINTER"),
        textChip("c2", rFirst.id, performer.id, "WINTER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect([...out]).toEqual([rLater.id]);
  });

  it("scopes shadowing per condition block (no cross-block shadowing)", () => {
    const performer = textVar("PERFORMER");
    const cb1 = condBlock("cb1");
    const cb2 = condBlock("cb2");
    const r1 = row("r1", cb1.id, 0);
    const r2 = row("r2", cb2.id, 0);
    const out = shadowedRowIds({
      blocks: [cb1, cb2],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "WINTER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out.size).toBe(0);
  });

  it("does not flag rows that fail to match, even after a winning row", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "SUMMER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out.size).toBe(0);
  });

  it("detects shadowing inside nested condition blocks", () => {
    const performer = textVar("PERFORMER");
    const mood = textVar("MOOD");
    const outer = condBlock("outer");
    const outerRow = row("outerRow", outer.id, 0);
    const inner = condBlock("inner", outer.id, outerRow.id);
    const inner1 = row("inner1", inner.id, 0);
    const inner2 = row("inner2", inner.id, 1);
    const out = shadowedRowIds({
      blocks: [outer, inner],
      rows: [outerRow, inner1, inner2],
      chips: [
        textChip("co", outerRow.id, performer.id, "WINTER"),
        textChip("c1", inner1.id, mood.id, "STORMY"),
        textChip("c2", inner2.id, mood.id, "STORMY"),
      ],
      variables: [performer, mood],
      selections: textSelections({
        [performer.id]: "WINTER",
        [mood.id]: "STORMY",
      }),
    });
    expect([...out]).toEqual([inner2.id]);
  });

  it("flags numeric overlap (≥0 and >-5 both fire for value=2)", () => {
    const world = numVar("WORLD");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = shadowedRowIds({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, "≥"),
        numChip("c2", r2.id, world.id, -5, ">"),
      ],
      variables: [world],
      selections: numSelections({ [world.id]: 2 }),
    });
    expect([...out]).toEqual([r2.id]);
  });
});

// ----------------------------------------------------------------------
// evaluateDocument — generalised walk over text + result leaves
// ----------------------------------------------------------------------

describe("evaluateDocument", () => {
  it("single text leaf at root → returns [text]", () => {
    const out = evaluateDocument({
      blocks: [textBlock("b1", "hello")],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual(["hello"]);
  });

  it("single result leaf at root → returns [result_value]", () => {
    const out = evaluateDocument({
      blocks: [resultBlock("b1", "proletariat")],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual(["proletariat"]);
  });

  it("nested condition+text — chip matches → returns child text", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id);
    const child = textBlock("child", "winter rose lyric", cb.id, r1.id);
    const out = evaluateDocument({
      blocks: [cb, child],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["winter rose lyric"]);
  });

  it("nested condition+result — chip matches → returns child result_value", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id);
    const child = resultBlock("child", "proletariat", cb.id, r1.id);
    const out = evaluateDocument({
      blocks: [cb, child],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["proletariat"]);
  });

  it("empty doc → returns []", () => {
    const out = evaluateDocument({
      blocks: [],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    });
    expect(out).toEqual([]);
  });

  it("first-match-wins across rows: only row 1's children render", () => {
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    // Both rows match the same selection.
    const out = evaluateDocument({
      blocks: [
        cb,
        resultBlock("res1", "framework-A", cb.id, r1.id),
        resultBlock("res2", "framework-B", cb.id, r2.id),
      ],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, "WINTER"),
        textChip("c2", r2.id, performer.id, "WINTER"),
      ],
      variables: [performer],
      selections: textSelections({ [performer.id]: "WINTER" }),
    });
    expect(out).toEqual(["framework-A"]);
  });

  it("cycle guard: a doc whose result references back into itself via a tied aggregate chip → returns empty (no infinite recursion)", () => {
    // class_affinity_top doc: a single row whose chip is `top= proletariat`.
    // Because the underlying scores tie, the chip would consult the same
    // class_affinity_top doc to break the tie — that's the cycle. The
    // evaluator's cycle guard breaks it by returning false, so no row
    // matches and the doc resolves to [].
    const klass = aggVar("VAR_CLASS", "class_affinity");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id);
    const tiebreakDoc: EvalInputs = {
      blocks: [cb, resultBlock("res1", "proletariat", cb.id, r1.id)],
      rows: [r1],
      chips: [aggChip("c1", r1.id, klass.id, "proletariat", "top=")],
      variables: [klass],
      selections: {
        textValueIds: {},
        numbers: { "var-proletariat": 5, "var-gentry": 5 },
        numberRefByName: new Map([
          ["proletariat", "var-proletariat"],
          ["gentry", "var-gentry"],
        ]),
        // The tiebreak_docs here points to the same doc, creating the cycle.
        // We need a self-reference: build a Map and then mutate the
        // selections object so the doc references itself.
      },
    };
    const tiebreak_docs = new Map<EndingLogicKind, EvalInputs>([
      ["class_affinity_top", tiebreakDoc],
    ]);
    tiebreakDoc.selections.tiebreak_docs = tiebreak_docs;

    // Run the doc directly; the chip's own tiebreak resolution would
    // recurse into `class_affinity_top` (itself). The guard short-circuits
    // and the chip returns false, so the row never matches.
    const out = evaluateDocument(tiebreakDoc);
    expect(out).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// Tiebreak resolution — class_affinity, scores 5-5
// ----------------------------------------------------------------------

describe("evaluateChip / aggregate tiebreak resolution", () => {
  const PROLETARIAT = "var-proletariat";
  const GENTRY = "var-gentry";
  const klass = aggVar("VAR_CLASS", "class_affinity");

  function tiedClassSelections(
    extra?: Partial<PreviewSelections>
  ): PreviewSelections {
    return {
      textValueIds: {},
      numbers: { [PROLETARIAT]: 5, [GENTRY]: 5 },
      numberRefByName: new Map([
        ["proletariat", PROLETARIAT],
        ["gentry", GENTRY],
      ]),
      ...extra,
    };
  }

  function buildTiebreakDoc(resultValue: string): EvalInputs {
    // Single root-level result block — always resolves to `resultValue`.
    return {
      blocks: [resultBlock("res", resultValue)],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
  }

  it("empty tiebreak doc (absent map entry) → tied aggregate chip returns false", () => {
    const sel = tiedClassSelections({
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>(),
    });
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("tiebreak doc resolves to proletariat → top= proletariat true", () => {
    const sel = tiedClassSelections({
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["class_affinity_top", buildTiebreakDoc("proletariat")],
      ]),
    });
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(true);
  });

  it("tiebreak doc resolves to proletariat → top= gentry false", () => {
    const sel = tiedClassSelections({
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["class_affinity_top", buildTiebreakDoc("proletariat")],
      ]),
    });
    const chip = aggChip("c", "r", klass.id, "gentry", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("tiebreak doc resolves to proletariat → top≠ gentry true", () => {
    const sel = tiedClassSelections({
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["class_affinity_top", buildTiebreakDoc("proletariat")],
      ]),
    });
    const chip = aggChip("c", "r", klass.id, "gentry", "top≠");
    expect(evaluateChip(chip, klass, sel)).toBe(true);
  });

  it("tiebreak doc returns null (no row matches) → falls back to false", () => {
    // Doc with one row whose chip can't match (unset variable).
    const performer = textVar("PERFORMER");
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id);
    const noMatchDoc: EvalInputs = {
      blocks: [cb, resultBlock("res", "proletariat", cb.id, r1.id)],
      rows: [r1],
      chips: [textChip("c1", r1.id, performer.id, "WINTER")],
      variables: [performer],
      selections: EMPTY_SELECTIONS, // performer unset → no row matches
    };
    const sel = tiedClassSelections({
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["class_affinity_top", noMatchDoc],
      ]),
    });
    const chip = aggChip("c", "r", klass.id, "proletariat", "top=");
    expect(evaluateChip(chip, klass, sel)).toBe(false);
  });

  it("nation 3-way tie (folos=emberlyn=spokgrad=3, pelico=epicenter=0); doc returns emberlyn → top= emberlyn true", () => {
    const FOLOS = "var-folos";
    const EMBERLYN = "var-emberlyn";
    const SPOKGRAD = "var-spokgrad";
    const PELICO = "var-pelico";
    const EPICENTER = "var-epicenter";
    const nation = aggVar("VAR_NATION", "nation_affinity");
    const sel: PreviewSelections = {
      textValueIds: {},
      numbers: {
        [FOLOS]: 3,
        [EMBERLYN]: 3,
        [SPOKGRAD]: 3,
        [PELICO]: 0,
        [EPICENTER]: 0,
      },
      numberRefByName: new Map([
        ["folos", FOLOS],
        ["emberlyn", EMBERLYN],
        ["spokgrad", SPOKGRAD],
        ["pelico", PELICO],
        ["epicenter", EPICENTER],
      ]),
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["nation_affinity_top", buildTiebreakDoc("emberlyn")],
      ]),
    };
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "emberlyn", "top="),
        nation,
        sel
      )
    ).toBe(true);
    // Doc returns emberlyn but chip is for folos → false (winner is emberlyn).
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "folos", "top="),
        nation,
        sel
      )
    ).toBe(false);
  });

  it("nation 3-way tie; doc returns a non-tied option (pelico) → falls back to false", () => {
    const FOLOS = "var-folos";
    const EMBERLYN = "var-emberlyn";
    const SPOKGRAD = "var-spokgrad";
    const PELICO = "var-pelico";
    const EPICENTER = "var-epicenter";
    const nation = aggVar("VAR_NATION", "nation_affinity");
    const sel: PreviewSelections = {
      textValueIds: {},
      numbers: {
        [FOLOS]: 3,
        [EMBERLYN]: 3,
        [SPOKGRAD]: 3,
        [PELICO]: 0,
        [EPICENTER]: 0,
      },
      numberRefByName: new Map([
        ["folos", FOLOS],
        ["emberlyn", EMBERLYN],
        ["spokgrad", SPOKGRAD],
        ["pelico", PELICO],
        ["epicenter", EPICENTER],
      ]),
      // Doc returns "pelico" — but pelico isn't tied (it's at 0 not 3).
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["nation_affinity_top", buildTiebreakDoc("pelico")],
      ]),
    };
    // Chip is for emberlyn — doc said pelico (non-tied option) → fall
    // back to today's "tie → false". emberlyn ≠ pelico anyway.
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "emberlyn", "top="),
        nation,
        sel
      )
    ).toBe(false);
    // Even pelico itself doesn't match — pelico isn't a tied option.
    expect(
      evaluateChip(
        aggChip("c", "r", nation.id, "pelico", "top="),
        nation,
        sel
      )
    ).toBe(false);
  });

  it("tiebreak only fires on tie: scores 5-2 (no tie) → doc never consulted", () => {
    // Doc would resolve to gentry, but scores aren't tied — proletariat
    // wins by score alone, so `top= proletariat` true regardless.
    const sel: PreviewSelections = {
      textValueIds: {},
      numbers: { [PROLETARIAT]: 5, [GENTRY]: 2 },
      numberRefByName: new Map([
        ["proletariat", PROLETARIAT],
        ["gentry", GENTRY],
      ]),
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["class_affinity_top", buildTiebreakDoc("gentry")],
      ]),
    };
    expect(
      evaluateChip(
        aggChip("c", "r", klass.id, "proletariat", "top="),
        klass,
        sel
      )
    ).toBe(true);
    expect(
      evaluateChip(
        aggChip("c", "r", klass.id, "gentry", "top="),
        klass,
        sel
      )
    ).toBe(false);
  });
});

// ----------------------------------------------------------------------
// evaluateFramework backwards-compat — alias delegates to evaluateDocument
// ----------------------------------------------------------------------

describe("evaluateFramework (backwards-compatible alias)", () => {
  it("text-only docs render identically to evaluateDocument", () => {
    const blocks: EvalBlock[] = [
      textBlock("b1", "Hello", null, null, 0),
      textBlock("b2", "World", null, null, 1),
    ];
    const inputs: EvalInputs = {
      blocks,
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    expect(evaluateFramework(inputs)).toEqual(["Hello", "World"]);
    expect(evaluateFramework(inputs)).toEqual(evaluateDocument(inputs));
  });
});

// ----------------------------------------------------------------------
// evaluateDocument — set-narrowing tiebreak (nation tiebreak docs)
// ----------------------------------------------------------------------

describe("evaluateDocument set-narrowing", () => {
  const NATION = "VAR_NATION_AFFINITY";
  const FOLOS = "FOLOS_VALUE";

  const setChip = (
    id: string,
    rowId: string,
    nation: string,
    operator: "set_includes" | "set_excludes",
    sortOrder = 0
  ): EvalChip => ({
    id,
    row_id: rowId,
    variable_id: NATION,
    operator,
    text_value_id: null,
    number_value: null,
    aggregate_value: nation,
    sort_order: sortOrder,
  });

  const fallbackBlock = (id: string, value: string | null): EvalBlock => ({
    id,
    parent_block_id: null,
    parent_row_id: null,
    block_type: "fallback",
    text: "",
    result_value: value,
    sort_order: 999999,
  });

  it("auto-resolves to the only remaining nation after a removal", () => {
    // Initial set: folos, emberlyn. Doc removes emberlyn → folos wins.
    const inputs: EvalInputs = {
      blocks: [resultBlock("rem1", "__remove__:emberlyn", null, null, 0)],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "emberlyn"],
      })
    ).toEqual(["folos"]);
  });

  it("set_includes chip on a condition row gates a removal", () => {
    // condition: tiebreak set includes spokgrad → remove spokgrad.
    // Initial set folos+spokgrad → spokgrad removed → folos wins.
    const cond = condBlock("c1", null, null, 0);
    const r1 = row("r1", "c1", 0);
    const removeSpok = resultBlock(
      "rs",
      "__remove__:spokgrad",
      "c1",
      "r1",
      0
    );
    const inputs: EvalInputs = {
      blocks: [cond, removeSpok],
      rows: [r1],
      chips: [setChip("ch1", "r1", "spokgrad", "set_includes")],
      variables: [aggVar(NATION, "nation_affinity")],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "spokgrad"],
      })
    ).toEqual(["folos"]);
  });

  it("evaluates every matching row in a condition block (not first-match-wins)", () => {
    // Two matching rows; both remove different nations. Working set
    // should narrow to the one not removed.
    const cond = condBlock("c1", null, null, 0);
    const r1 = row("r1", "c1", 0);
    const r2 = row("r2", "c1", 1);
    const removeFolos = resultBlock(
      "rf",
      "__remove__:folos",
      "c1",
      "r1",
      0
    );
    const removeSpok = resultBlock(
      "rs",
      "__remove__:spokgrad",
      "c1",
      "r2",
      0
    );
    const inputs: EvalInputs = {
      blocks: [cond, removeFolos, removeSpok],
      rows: [r1, r2],
      chips: [
        setChip("ch1", "r1", "folos", "set_includes"),
        setChip("ch2", "r2", "spokgrad", "set_includes"),
      ],
      variables: [aggVar(NATION, "nation_affinity")],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "spokgrad", "emberlyn"],
      })
    ).toEqual(["emberlyn"]);
  });

  it("definite result wins immediately, skipping later rows", () => {
    const cond = condBlock("c1", null, null, 0);
    const r1 = row("r1", "c1", 0);
    const r2 = row("r2", "c1", 1);
    // r1 returns epicenter directly; r2's removal should never run.
    const epicenter = resultBlock("ep", "epicenter", "c1", "r1", 0);
    const removeAll = resultBlock(
      "rm",
      "__remove__:emberlyn",
      "c1",
      "r2",
      0
    );
    const inputs: EvalInputs = {
      blocks: [cond, epicenter, removeAll],
      rows: [r1, r2],
      chips: [
        setChip("ch1", "r1", "epicenter", "set_includes"),
        setChip("ch2", "r2", "emberlyn", "set_includes"),
      ],
      variables: [aggVar(NATION, "nation_affinity")],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "emberlyn", "epicenter"],
      })
    ).toEqual(["epicenter"]);
  });

  it("falls through to fallback when working set goes empty", () => {
    // Initial set is just { folos }. Removing folos drains the set to
    // empty (size→0); the auto-resolve check that would normally
    // catch the size-1 transition doesn't fire here because the
    // removal already finalized at size 0. Fallback returns spokgrad.
    const inputs: EvalInputs = {
      blocks: [
        resultBlock("rm", "__remove__:folos", null, null, 0),
        fallbackBlock("fb", "spokgrad"),
      ],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, { initialTiebreakSet: ["folos"] })
    ).toEqual(["spokgrad"]);
  });

  it("__random_remaining__ rolls from the working set", () => {
    // After removing folos, set is { emberlyn }; random_remaining must
    // return emberlyn (only option).
    const inputs: EvalInputs = {
      blocks: [
        resultBlock("rm", "__remove__:folos", null, null, 0),
        resultBlock("rr", "__random_remaining__", null, null, 1),
      ],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "emberlyn"],
      })
    ).toEqual(["emberlyn"]);
  });

  it("set_excludes returns false when the nation is in the set", () => {
    // set_excludes folos with folos in set → row doesn't fire → no removal.
    const cond = condBlock("c1", null, null, 0);
    const r1 = row("r1", "c1", 0);
    const removeEmber = resultBlock(
      "rem",
      "__remove__:emberlyn",
      "c1",
      "r1",
      0
    );
    const inputs: EvalInputs = {
      blocks: [cond, removeEmber, fallbackBlock("fb", "spokgrad")],
      rows: [r1],
      chips: [setChip("ch1", "r1", "folos", "set_excludes")],
      variables: [aggVar(NATION, "nation_affinity")],
      selections: EMPTY_SELECTIONS,
    };
    // Initial set has folos → set_excludes folos is false → no removal
    // → no auto-resolve → fallback fires → spokgrad.
    expect(
      evaluateDocument(inputs, {
        initialTiebreakSet: ["folos", "emberlyn", "spokgrad"],
      })
    ).toEqual(["spokgrad"]);
    // Suppress unused-var lint on the seeded value id constant.
    void FOLOS;
  });
});

// ----------------------------------------------------------------------
// evaluateDocumentDetailed — exposes rollPool / rollSentinel for the
// preview UI when a narrowing-mode random sentinel resolves; the
// runtime `evaluateDocument` would have rolled it eagerly.
// ----------------------------------------------------------------------

describe("evaluateDocumentDetailed", () => {
  it("non-narrowing path returns null rollPool / rollSentinel", () => {
    const inputs: EvalInputs = {
      blocks: [resultBlock("res", "proletariat")],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const out = evaluateDocumentDetailed(inputs);
    expect(out.paragraphs).toEqual(["proletariat"]);
    expect(out.rollPool).toBeNull();
    expect(out.rollSentinel).toBeNull();
  });

  it("narrowing path with concrete result returns null rollPool", () => {
    // Initial set { folos, emberlyn }; doc removes emberlyn → folos
    // wins by auto-resolve. No random sentinel involved.
    const inputs: EvalInputs = {
      blocks: [resultBlock("rm", "__remove__:emberlyn", null, null, 0)],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const out = evaluateDocumentDetailed(inputs, {
      initialTiebreakSet: ["folos", "emberlyn"],
    });
    expect(out.paragraphs).toEqual(["folos"]);
    expect(out.rollPool).toBeNull();
    expect(out.rollSentinel).toBeNull();
  });

  it("narrowing path with __random_remaining__ returns the working set as rollPool", () => {
    // Initial set { folos, emberlyn, spokgrad }; doc removes spokgrad
    // first, then __random_remaining__ — pool is the post-removal set.
    const inputs: EvalInputs = {
      blocks: [
        resultBlock("rm", "__remove__:spokgrad", null, null, 0),
        resultBlock("rr", "__random_remaining__", null, null, 1),
      ],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const out = evaluateDocumentDetailed(inputs, {
      initialTiebreakSet: ["folos", "emberlyn", "spokgrad"],
    });
    expect(out.rollSentinel).toBe("__random_remaining__");
    expect(out.rollPool).toEqual(
      expect.arrayContaining(["folos", "emberlyn"])
    );
    expect(out.rollPool).toHaveLength(2);
    // Paragraphs surface the sentinel verbatim — caller is expected to
    // roll. evaluateDocument (eager path) returns a concrete value
    // instead; we don't assert paragraphs here beyond the sentinel.
    expect(out.paragraphs).toEqual(["__random_remaining__"]);
  });

  it("narrowing fallback path with __random_remaining__ returns rollPool from final working set", () => {
    // Tree exhausts without picking; fallback is __random_remaining__.
    // Working set = original tied set.
    const inputs: EvalInputs = {
      blocks: [
        {
          id: "fb",
          parent_block_id: null,
          parent_row_id: null,
          block_type: "fallback",
          text: "",
          result_value: "__random_remaining__",
          sort_order: 999999,
        },
      ],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const out = evaluateDocumentDetailed(inputs, {
      initialTiebreakSet: ["folos", "emberlyn", "pelico"],
    });
    expect(out.rollSentinel).toBe("__random_remaining__");
    expect(out.rollPool).toEqual(
      expect.arrayContaining(["folos", "emberlyn", "pelico"])
    );
    expect(out.rollPool).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------
// resolveAggregatesDetailed — fromRandom + rollPool plumbing for the
// framework preview's nation-tiebreak reroll button. Verifies the
// narrowing-random branch threads the working set up as the chip's
// rollPool.
// ----------------------------------------------------------------------

describe("resolveAggregatesDetailed / nation tiebreak random", () => {
  const FOLOS = "var-folos";
  const EMBERLYN = "var-emberlyn";
  const SPOKGRAD = "var-spokgrad";
  const PELICO = "var-pelico";
  const EPICENTER = "var-epicenter";
  const nation = aggVar("VAR_NATION", "nation_affinity");

  function tiedNationSelections(
    tiebreakDoc: EvalInputs
  ): PreviewSelections {
    return {
      textValueIds: {},
      numbers: {
        [FOLOS]: 3,
        [EMBERLYN]: 3,
        [SPOKGRAD]: 3,
        [PELICO]: 0,
        [EPICENTER]: 0,
      },
      numberRefByName: new Map([
        ["folos", FOLOS],
        ["emberlyn", EMBERLYN],
        ["spokgrad", SPOKGRAD],
        ["pelico", PELICO],
        ["epicenter", EPICENTER],
      ]),
      tiebreak_docs: new Map<EndingLogicKind, EvalInputs>([
        ["nation_affinity_top", tiebreakDoc],
      ]),
    };
  }

  it("nation tiebreak doc resolving to __random_remaining__ → fromRandom + rollPool from working set", () => {
    const tiebreakDoc: EvalInputs = {
      blocks: [resultBlock("rr", "__random_remaining__")],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const sel = tiedNationSelections(tiebreakDoc);
    const variableIndex = new Map([[nation.id, nation]]);
    const chips: EvalChip[] = [
      aggChip("c", "r", nation.id, "folos", "top="),
    ];
    const out = resolveAggregatesDetailed(chips, variableIndex, sel);
    const res = out.get("nation_affinity|top");
    expect(res).toBeDefined();
    expect(res?.fromRandom).toBe(true);
    expect(res?.rollPool).toEqual(
      expect.arrayContaining(["folos", "emberlyn", "spokgrad"])
    );
    expect(res?.rollPool).toHaveLength(3);
    // The rolled value must be one of the tied options.
    expect(["folos", "emberlyn", "spokgrad"]).toContain(res?.value);
  });

  it("nation tiebreak doc resolving to a concrete tied option → fromRandom false", () => {
    const tiebreakDoc: EvalInputs = {
      blocks: [resultBlock("res", "emberlyn")],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const sel = tiedNationSelections(tiebreakDoc);
    const variableIndex = new Map([[nation.id, nation]]);
    const chips: EvalChip[] = [
      aggChip("c", "r", nation.id, "emberlyn", "top="),
    ];
    const out = resolveAggregatesDetailed(chips, variableIndex, sel);
    const res = out.get("nation_affinity|top");
    expect(res?.fromRandom).toBe(false);
    expect(res?.value).toBe("emberlyn");
    expect(res?.rollPool).toBeUndefined();
  });

  it("narrowing chain (__remove__: + __random_remaining__) surfaces the post-removal working set as rollPool", () => {
    // Tiebreak doc removes spokgrad first, then random_remaining over
    // what survives. Pool should be { folos, emberlyn } — the tied set
    // minus spokgrad.
    const tiebreakDoc: EvalInputs = {
      blocks: [
        resultBlock("rm", "__remove__:spokgrad", null, null, 0),
        resultBlock("rr", "__random_remaining__", null, null, 1),
      ],
      rows: [],
      chips: [],
      variables: [],
      selections: EMPTY_SELECTIONS,
    };
    const sel = tiedNationSelections(tiebreakDoc);
    const variableIndex = new Map([[nation.id, nation]]);
    const chips: EvalChip[] = [
      aggChip("c", "r", nation.id, "folos", "top="),
    ];
    const out = resolveAggregatesDetailed(chips, variableIndex, sel);
    const res = out.get("nation_affinity|top");
    expect(res?.fromRandom).toBe(true);
    expect(res?.rollPool).toEqual(
      expect.arrayContaining(["folos", "emberlyn"])
    );
    expect(res?.rollPool).toHaveLength(2);
    expect(["folos", "emberlyn"]).toContain(res?.value);
  });
});

describe("text substitution: @[Name]", () => {
  // All cases run through `evaluateFramework`, which funnels every text
  // block through `renderBlocks` → `substituteVariables`. Asserting at
  // this level proves the wiring (Indexes builds the name + value maps;
  // selections + values flow through) end-to-end.

  function buildInputs(
    text: string,
    variables: EvalVariable[],
    selections: PreviewSelections,
    values: Array<{ id: string; variable_id: string; value: string }> = []
  ): EvalInputs {
    return {
      blocks: [textBlock("t1", text)],
      rows: [],
      chips: [],
      variables,
      selections,
      values: values.map((v) => ({
        id: v.id,
        variable_id: v.variable_id,
        value: v.value,
        sort_order: 0,
      })),
    };
  }

  it("substitutes a text variable's selected value", () => {
    const v = textVar("v1", "Mainstage Performer");
    const out = evaluateFramework(
      buildInputs(
        "The concert was headlined by @[Mainstage Performer].",
        [v],
        textSelections({ v1: "val-winterose" }),
        [{ id: "val-winterose", variable_id: "v1", value: "Winterose" }]
      )
    );
    expect(out).toEqual(["The concert was headlined by Winterose."]);
  });

  it("leaves token literal when text variable has no selection", () => {
    const v = textVar("v1", "Mainstage Performer");
    const out = evaluateFramework(
      buildInputs(
        "Headlined by @[Mainstage Performer].",
        [v],
        textSelections({ v1: null }),
        [{ id: "val-x", variable_id: "v1", value: "Winterose" }]
      )
    );
    expect(out).toEqual(["Headlined by @[Mainstage Performer]."]);
  });

  it("substitutes a number_ref variable", () => {
    const v = numVar("v1", "Demerits");
    const out = evaluateFramework(
      buildInputs(
        "You earned @[Demerits] demerits.",
        [v],
        numSelections({ v1: 7 })
      )
    );
    expect(out).toEqual(["You earned 7 demerits."]);
  });

  it("leaves token literal when number_ref variable has no value", () => {
    const v = numVar("v1", "Demerits");
    const out = evaluateFramework(
      buildInputs("Score: @[Demerits].", [v], numSelections({ v1: null }))
    );
    expect(out).toEqual(["Score: @[Demerits]."]);
  });

  it("substitutes an aggregate_ref variable using VARIABLE_LABELS", () => {
    const v = aggVar("v1", "class_affinity", "Class Winner");
    const selections: PreviewSelections = {
      textValueIds: {},
      numbers: {},
      resolved_aggregates: new Map([["class_affinity|top", "proletariat"]]),
    };
    const out = evaluateFramework(
      buildInputs("The winning class is @[Class Winner].", [v], selections)
    );
    // VARIABLE_LABELS.proletariat = "Working Class"
    expect(out).toEqual(["The winning class is Working Class."]);
  });

  it("leaves token literal when aggregate is unresolved", () => {
    const v = aggVar("v1", "class_affinity", "Class Winner");
    const out = evaluateFramework(
      buildInputs("Class: @[Class Winner].", [v], {
        textValueIds: {},
        numbers: {},
      })
    );
    expect(out).toEqual(["Class: @[Class Winner]."]);
  });

  it("leaves token literal when variable name is unknown", () => {
    const v = textVar("v1", "RealName");
    const out = evaluateFramework(
      buildInputs(
        "Hello @[Unknown Var].",
        [v],
        textSelections({ v1: "val-a" }),
        [{ id: "val-a", variable_id: "v1", value: "X" }]
      )
    );
    expect(out).toEqual(["Hello @[Unknown Var]."]);
  });

  it("substitutes multiple tokens in the same text", () => {
    const a = textVar("v1", "First");
    const b = textVar("v2", "Second");
    const out = evaluateFramework(
      buildInputs(
        "First: @[First], Second: @[Second].",
        [a, b],
        textSelections({ v1: "val-a", v2: "val-b" }),
        [
          { id: "val-a", variable_id: "v1", value: "Alpha" },
          { id: "val-b", variable_id: "v2", value: "Bravo" },
        ]
      )
    );
    expect(out).toEqual(["First: Alpha, Second: Bravo."]);
  });

  it("substitutes a token mid-sentence after punctuation", () => {
    const v = textVar("v1", "Name");
    const out = evaluateFramework(
      buildInputs(
        "Hello, @[Name]! Welcome.",
        [v],
        textSelections({ v1: "val-bob" }),
        [{ id: "val-bob", variable_id: "v1", value: "Bob" }]
      )
    );
    expect(out).toEqual(["Hello, Bob! Welcome."]);
  });

  it("does not substitute inside an email-like address", () => {
    // The negative lookbehind keeps `email@[host.com]` from triggering
    // substitution even though `host.com` is technically a valid name
    // pattern.
    const v = textVar("v1", "host.com");
    const out = evaluateFramework(
      buildInputs(
        "Contact me at user@[host.com].",
        [v],
        textSelections({ v1: "val-x" }),
        [{ id: "val-x", variable_id: "v1", value: "example.org" }]
      )
    );
    expect(out).toEqual(["Contact me at user@[host.com]."]);
  });

  it("does not substitute @@[Name] (double-at)", () => {
    const v = textVar("v1", "Name");
    const out = evaluateFramework(
      buildInputs(
        "Literal @@[Name] stays.",
        [v],
        textSelections({ v1: "val-x" }),
        [{ id: "val-x", variable_id: "v1", value: "X" }]
      )
    );
    expect(out).toEqual(["Literal @@[Name] stays."]);
  });

  it("leaves empty brackets @[] literal", () => {
    const out = evaluateFramework(
      buildInputs("Empty @[] token.", [], { textValueIds: {}, numbers: {} })
    );
    expect(out).toEqual(["Empty @[] token."]);
  });

  it("handles names with spaces and punctuation", () => {
    const v = textVar("v1", "City of Brass");
    const out = evaluateFramework(
      buildInputs(
        "Welcome to @[City of Brass].",
        [v],
        textSelections({ v1: "val-c" }),
        [{ id: "val-c", variable_id: "v1", value: "the capital" }]
      )
    );
    expect(out).toEqual(["Welcome to the capital."]);
  });

  it("nested brackets resolve to the inner name (regex stops at first `]`)", () => {
    // `@[Foo[Bar]]` matches `@[Foo[Bar]` capturing `Foo[Bar`. That's not
    // a real variable name → token left literal.
    const v = textVar("v1", "RealName");
    const out = evaluateFramework(
      buildInputs(
        "Nested @[Foo[Bar]] stays.",
        [v],
        textSelections({ v1: "val-a" }),
        [{ id: "val-a", variable_id: "v1", value: "X" }]
      )
    );
    expect(out[0]).toContain("@[Foo[Bar]");
  });

  it("legacy callers without `values` see no substitution but no crash", () => {
    // The `values` field on EvalInputs is optional. Callers that omit it
    // (older tests, static-analysis paths) get an empty `valuesById`
    // map — text variables can't resolve, so tokens stay literal.
    const v = textVar("v1", "Name");
    const out = evaluateFramework({
      blocks: [textBlock("t1", "Hi @[Name].")],
      rows: [],
      chips: [],
      variables: [v],
      selections: textSelections({ v1: "val-x" }),
      // values intentionally omitted
    });
    expect(out).toEqual(["Hi @[Name]."]);
  });
});
