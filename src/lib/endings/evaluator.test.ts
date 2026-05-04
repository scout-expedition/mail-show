import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTIONS,
  evaluateFramework,
  evaluateChip,
  evaluateRow,
  matchingRowsByBlock,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalRow,
  type EvalVariable,
  type PreviewSelections,
} from "./evaluator";

const textVar = (id: string): EvalVariable => ({ id, kind: "text" });
const numVar = (id: string): EvalVariable => ({ id, kind: "number_ref" });

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
