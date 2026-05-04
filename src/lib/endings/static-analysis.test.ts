import { describe, expect, it } from "vitest";
import type { EvalBlock, EvalChip, EvalRow, EvalVariable } from "./evaluator";
import {
  MAX_ENUMERATION,
  numericRowOverlaps,
  staticShadowedRows,
  uncoveredAssignmentsByBlock,
  type StaticInputs,
  type StaticValue,
} from "./static-analysis";

// ----------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------

const textVar = (id: string): EvalVariable => ({
  id,
  kind: "text",
  aggregate_ref: null,
});
const numVar = (id: string): EvalVariable => ({
  id,
  kind: "number_ref",
  aggregate_ref: null,
});
const aggVar = (
  id: string,
  ref: "class_affinity" | "nation_affinity"
): EvalVariable => ({
  id,
  kind: "aggregate_ref",
  aggregate_ref: ref,
});

const textValue = (id: string, variableId: string): StaticValue => ({
  id,
  variable_id: variableId,
});

const condBlock = (id: string): EvalBlock => ({
  id,
  parent_block_id: null,
  parent_row_id: null,
  block_type: "condition",
  text: "",
  sort_order: 0,
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

const textChip = (
  id: string,
  rowId: string,
  variableId: string,
  textValueId: string,
  operator: "=" | "≠" = "="
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: textValueId,
  number_value: null,
  aggregate_value: null,
  sort_order: 0,
});

const numChip = (
  id: string,
  rowId: string,
  variableId: string,
  number: number,
  operator: "=" | "≠" | "<" | "≤" | ">" | "≥" = "="
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: null,
  number_value: number,
  aggregate_value: null,
  sort_order: 0,
});

const aggChip = (
  id: string,
  rowId: string,
  variableId: string,
  aggregateValue: string,
  operator: "top=" | "top≠" | "bottom=" | "bottom≠"
): EvalChip => ({
  id,
  row_id: rowId,
  variable_id: variableId,
  operator,
  text_value_id: null,
  number_value: null,
  aggregate_value: aggregateValue,
  sort_order: 0,
});

// ----------------------------------------------------------------------
// staticShadowedRows — text variables
// ----------------------------------------------------------------------

describe("staticShadowedRows / text", () => {
  const performer = textVar("VAR_PERFORMER");
  const mood = textVar("VAR_MOOD");
  const cb = condBlock("cb");
  const winter = textValue("VAL_WINTER", performer.id);
  const summer = textValue("VAL_SUMMER", performer.id);
  const stormy = textValue("VAL_STORMY", mood.id);
  const calm = textValue("VAL_CALM", mood.id);

  it("identical chip → second row shadowed", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        textChip("c2", r2.id, performer.id, winter.id),
      ],
      variables: [performer],
      values: [winter, summer],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });

  it("≠ A covers = B (B≠A)", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id, "≠"),
        textChip("c2", r2.id, performer.id, summer.id, "="),
      ],
      variables: [performer],
      values: [winter, summer],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });

  it("= A does not cover = B (different values)", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        textChip("c2", r2.id, performer.id, summer.id),
      ],
      variables: [performer],
      values: [winter, summer],
    });
    expect(out).toEqual([]);
  });

  it("less-restrictive R₁ shadows more-restrictive R₂ (R₂ ⊂ R₁)", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        textChip("c2a", r2.id, performer.id, winter.id),
        textChip("c2b", r2.id, mood.id, stormy.id),
      ],
      variables: [performer, mood],
      values: [winter, summer, stormy, calm],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });

  it("more-restrictive R₁ does NOT shadow less-restrictive R₂", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1a", r1.id, performer.id, winter.id),
        textChip("c1b", r1.id, mood.id, stormy.id),
        textChip("c2", r2.id, performer.id, winter.id),
      ],
      variables: [performer, mood],
      values: [winter, summer, stormy, calm],
    });
    expect(out).toEqual([]);
  });

  it("empty row never shadows and is never shadowed", () => {
    const r1 = row("r1", cb.id, 0); // empty
    const r2 = row("r2", cb.id, 1);
    const r3 = row("r3", cb.id, 2); // empty
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2, r3],
      chips: [textChip("c2", r2.id, performer.id, winter.id)],
      variables: [performer],
      values: [winter, summer],
    });
    expect(out).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// staticShadowedRows — aggregate variables
// ----------------------------------------------------------------------

describe("staticShadowedRows / aggregate", () => {
  const klass = aggVar("VAR_CLASS", "class_affinity");
  const nation = aggVar("VAR_NATION", "nation_affinity");
  const cb = condBlock("cb");

  it("class_affinity: identical top= chips → second shadowed", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        aggChip("c1", r1.id, klass.id, "proletariat", "top="),
        aggChip("c2", r2.id, klass.id, "proletariat", "top="),
      ],
      variables: [klass],
      values: [],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });

  it("class_affinity: top= proletariat does NOT cover top= gentry", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        aggChip("c1", r1.id, klass.id, "proletariat", "top="),
        aggChip("c2", r2.id, klass.id, "gentry", "top="),
      ],
      variables: [klass],
      values: [],
    });
    expect(out).toEqual([]);
  });

  it("class_affinity: top≠ proletariat covers top= gentry", () => {
    // top≠ proletariat is true on outcomes where proletariat is NOT the
    // unique top (so gentry top, with current Phase 4 tie semantics tie
    // → false). top= gentry is true exactly on the gentry-top outcome.
    // So top≠ proletariat ⊇ top= gentry → R₂ shadowed.
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        aggChip("c1", r1.id, klass.id, "proletariat", "top≠"),
        aggChip("c2", r2.id, klass.id, "gentry", "top="),
      ],
      variables: [klass],
      values: [],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });

  it("nation_affinity: top= folos covers top= folos AND bottom= pelico", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        aggChip("c1", r1.id, nation.id, "folos", "top="),
        aggChip("c2a", r2.id, nation.id, "folos", "top="),
        aggChip("c2b", r2.id, nation.id, "pelico", "bottom="),
      ],
      variables: [nation],
      values: [],
    });
    expect(out).toEqual([
      { shadowed_row_id: r2.id, covered_by_row_id: r1.id },
    ]);
  });
});

// ----------------------------------------------------------------------
// staticShadowedRows — mixed kinds (number_ref present)
// ----------------------------------------------------------------------

describe("staticShadowedRows / number_ref", () => {
  const performer = textVar("VAR_PERFORMER");
  const world = numVar("VAR_WORLD");
  const cb = condBlock("cb");
  const winter = textValue("VAL_WINTER", performer.id);

  it("skips analysis when R₂ has a number_ref chip", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        numChip("c2", r2.id, world.id, 0, "≥"),
      ],
      variables: [performer, world],
      values: [winter],
    });
    expect(out).toEqual([]);
  });

  it("skips analysis when R₁ has a number_ref chip", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = staticShadowedRows({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, "≥"),
        textChip("c2", r2.id, performer.id, winter.id),
      ],
      variables: [performer, world],
      values: [winter],
    });
    expect(out).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// uncoveredAssignmentsByBlock — text-only
// ----------------------------------------------------------------------

describe("uncoveredAssignmentsByBlock / text", () => {
  const performer = textVar("VAR_PERFORMER");
  const cb = condBlock("cb");
  const a = textValue("VAL_A", performer.id);
  const b = textValue("VAL_B", performer.id);
  const c = textValue("VAL_C", performer.id);

  it("flags uncovered values", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, a.id),
        textChip("c2", r2.id, performer.id, b.id),
      ],
      variables: [performer],
      values: [a, b, c],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered).toEqual([{ [performer.id]: c.id }]);
  });

  it("reports 'covered' when = A and ≠ A together cover every defined value", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, a.id, "="),
        textChip("c2", r2.id, performer.id, a.id, "≠"),
      ],
      variables: [performer],
      values: [a, b, c],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("covered");
    expect(block?.uncovered).toEqual([]);
  });

  it("two-variable AND row: lists every defined (var, mood) combo not matched", () => {
    const mood = textVar("VAR_MOOD");
    const stormy = textValue("VAL_STORMY", mood.id);
    const calm = textValue("VAL_CALM", mood.id);
    const r1 = row("r1", cb.id, 0);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1],
      chips: [
        textChip("c1a", r1.id, performer.id, a.id),
        textChip("c1b", r1.id, mood.id, stormy.id),
      ],
      variables: [performer, mood],
      values: [a, b, stormy, calm],
    });
    const block = out.get(cb.id);
    // performer dom = {A, B}, mood dom = {stormy, calm}
    // = 4 assignments; only (A, stormy) matches → 3 uncovered.
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered.length).toBe(3);
  });
});

// ----------------------------------------------------------------------
// uncoveredAssignmentsByBlock — aggregate
// ----------------------------------------------------------------------

describe("uncoveredAssignmentsByBlock / aggregate", () => {
  const klass = aggVar("VAR_CLASS", "class_affinity");
  const cb = condBlock("cb");

  it("class_affinity: top= proletariat + top= gentry leaves tie uncovered", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        aggChip("c1", r1.id, klass.id, "proletariat", "top="),
        aggChip("c2", r2.id, klass.id, "gentry", "top="),
      ],
      variables: [klass],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered).toEqual([{ [klass.id]: "tie" }]);
  });

  it("class_affinity: even with top≠ chips, tie stays uncovered (Phase 4 semantics)", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const r3 = row("r3", cb.id, 2);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2, r3],
      chips: [
        aggChip("c1", r1.id, klass.id, "proletariat", "top="),
        aggChip("c2", r2.id, klass.id, "gentry", "top="),
        aggChip("c3", r3.id, klass.id, "proletariat", "top≠"),
      ],
      variables: [klass],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered).toEqual([{ [klass.id]: "tie" }]);
  });
});

// ----------------------------------------------------------------------
// uncoveredAssignmentsByBlock — numeric interval analysis
// ----------------------------------------------------------------------

describe("uncoveredAssignmentsByBlock / numeric interval", () => {
  const world = numVar("VAR_WORLD");
  const cb = condBlock("cb");

  it("x > 0 and x < 0 → uncovered at x = 0", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, ">"),
        numChip("c2", r2.id, world.id, 0, "<"),
      ],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(false);
    expect(block?.status).toBe("has_uncovered");
    expect(block?.numericGaps).toEqual([
      {
        variable_id: world.id,
        low: 0,
        high: 0,
        lowInclusive: true,
        highInclusive: true,
      },
    ]);
  });

  it("x > 3 and x < 0 → uncovered between 0 ≤ x ≤ 3", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 3, ">"),
        numChip("c2", r2.id, world.id, 0, "<"),
      ],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(false);
    expect(block?.numericGaps).toEqual([
      {
        variable_id: world.id,
        low: 0,
        high: 3,
        lowInclusive: true,
        highInclusive: true,
      },
    ]);
  });

  it("(x > 0 ∧ x < 2) and x ≥ 2 → uncovered x ≤ 0", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1a", r1.id, world.id, 0, ">"),
        numChip("c1b", r1.id, world.id, 2, "<"),
        numChip("c2", r2.id, world.id, 2, "≥"),
      ],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(false);
    expect(block?.numericGaps).toEqual([
      {
        variable_id: world.id,
        low: -Infinity,
        high: 0,
        lowInclusive: false,
        highInclusive: true,
      },
    ]);
  });

  it("x ≥ 0 and x < 0 fully cover the line", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, "≥"),
        numChip("c2", r2.id, world.id, 0, "<"),
      ],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(false);
    expect(block?.status).toBe("covered");
    expect(block?.numericGaps).toEqual([]);
  });

  it("≠ 5 leaves only x = 5 uncovered", () => {
    const r1 = row("r1", cb.id, 0);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1],
      chips: [numChip("c1", r1.id, world.id, 5, "≠")],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.numericGaps).toEqual([
      {
        variable_id: world.id,
        low: 5,
        high: 5,
        lowInclusive: true,
        highInclusive: true,
      },
    ]);
  });

  it("two scattered = chips leave three open intervals uncovered", () => {
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, "="),
        numChip("c2", r2.id, world.id, 5, "="),
      ],
      variables: [world],
      values: [],
    });
    const block = out.get(cb.id);
    // Uncovered: (-∞, 0), (0, 5), (5, ∞)
    expect(block?.numericGaps?.length).toBe(3);
  });
});

// ----------------------------------------------------------------------
// numericRowOverlaps — partial / full overlap on single-numeric blocks
// ----------------------------------------------------------------------

describe("numericRowOverlaps", () => {
  const world = numVar("VAR_WORLD");
  const cb = condBlock("cb");

  it("flags partial overlap when row 2's range extends row 1's", () => {
    // Row 1: x < 3 → covers (-∞, 3). Row 2: x < 5 → covers (-∞, 5).
    // Row 2's dead portion (already covered by row 1) is (-∞, 3).
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const overlaps = numericRowOverlaps({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 3, "<"),
        numChip("c2", r2.id, world.id, 5, "<"),
      ],
      variables: [world],
      values: [],
    });
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].row_id).toBe(r2.id);
    expect(overlaps[0].earlier_row_ids).toEqual([r1.id]);
    expect(overlaps[0].fullShadow).toBe(false);
    expect(overlaps[0].intervals).toEqual([
      {
        variable_id: world.id,
        low: -Infinity,
        high: 3,
        lowInclusive: false,
        highInclusive: false,
      },
    ]);
  });

  it("fullShadow=true when row 2's range is contained in row 1's", () => {
    // Row 1: x ≤ 5. Row 2: x < 3. Row 2's range ⊂ Row 1's range.
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const overlaps = numericRowOverlaps({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 5, "≤"),
        numChip("c2", r2.id, world.id, 3, "<"),
      ],
      variables: [world],
      values: [],
    });
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].fullShadow).toBe(true);
  });

  it("disjoint ranges produce no overlap", () => {
    // Row 1: x < 0. Row 2: x > 0. No intersection.
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const overlaps = numericRowOverlaps({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        numChip("c1", r1.id, world.id, 0, "<"),
        numChip("c2", r2.id, world.id, 0, ">"),
      ],
      variables: [world],
      values: [],
    });
    expect(overlaps).toEqual([]);
  });

  it("aggregates earlier rows: row 3 overlaps union of rows 1 + 2", () => {
    // Row 1: x = 0. Row 2: x = 5. Row 3: x ≥ 0 (covers both 0 and 5).
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const r3 = row("r3", cb.id, 2);
    const overlaps = numericRowOverlaps({
      blocks: [cb],
      rows: [r1, r2, r3],
      chips: [
        numChip("c1", r1.id, world.id, 0, "="),
        numChip("c2", r2.id, world.id, 5, "="),
        numChip("c3", r3.id, world.id, 0, "≥"),
      ],
      variables: [world],
      values: [],
    });
    // r3 has dead points at x=0 and x=5 (covered by r1 and r2).
    const r3Overlap = overlaps.find((o) => o.row_id === r3.id);
    expect(r3Overlap).toBeDefined();
    expect(r3Overlap?.earlier_row_ids).toEqual([r1.id, r2.id]);
    expect(r3Overlap?.fullShadow).toBe(false);
    // Two singleton intervals (point sets at 0 and 5) — neither merges.
    expect(r3Overlap?.intervals.length).toBe(2);
  });

  it("does not run on mixed (numeric + finite) blocks", () => {
    const performer = textVar("VAR_P");
    const winter = textValue("VAL_W", performer.id);
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const overlaps = numericRowOverlaps({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        numChip("c2", r2.id, world.id, 0, ">"),
      ],
      variables: [performer, world],
      values: [winter],
    });
    expect(overlaps).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// uncoveredAssignmentsByBlock — number_ref + cap + edge cases
// ----------------------------------------------------------------------

describe("uncoveredAssignmentsByBlock / edges", () => {
  it("ignores numeric chips and reports partial coverage", () => {
    // Row 1 (`performer = winter`) covers performer=winter; row 2's
    // numeric chip is treated as a wildcard so it covers the rest.
    // Result: every finite assignment is "covered" (lower bound) and
    // the partial flag is set so the UI surfaces the caveat.
    const performer = textVar("VAR_PERFORMER");
    const world = numVar("VAR_WORLD");
    const cb = condBlock("cb");
    const winter = textValue("VAL_WINTER", performer.id);
    const summer = textValue("VAL_SUMMER", performer.id);
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        numChip("c2", r2.id, world.id, 0, "≥"),
      ],
      variables: [performer, world],
      values: [winter, summer],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(true);
    // Row 2's numeric-only chip is a wildcard → covers all finite assignments.
    expect(block?.status).toBe("covered");
  });

  it("partial flag set when numeric chip mixes with finite chips on the same row", () => {
    // Row 1: performer=winter ∧ world>=0 → finite-only constraint:
    // performer=winter (numeric ignored). Row 2: performer=summer.
    // performer values {winter, summer, autumn} → autumn uncovered.
    const performer = textVar("VAR_PERFORMER");
    const world = numVar("VAR_WORLD");
    const cb = condBlock("cb");
    const winter = textValue("VAL_WINTER", performer.id);
    const summer = textValue("VAL_SUMMER", performer.id);
    const autumn = textValue("VAL_AUTUMN", performer.id);
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1a", r1.id, performer.id, winter.id),
        numChip("c1b", r1.id, world.id, 0, "≥"),
        textChip("c2", r2.id, performer.id, summer.id),
      ],
      variables: [performer, world],
      values: [winter, summer, autumn],
    });
    const block = out.get(cb.id);
    expect(block?.partial).toBe(true);
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered).toEqual([{ [performer.id]: autumn.id }]);
  });

  it("status='no_finite_vars' when no row has any chips", () => {
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1, r2],
      chips: [],
      variables: [],
      values: [],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("no_finite_vars");
  });

  it("status='cap_exceeded' when cartesian product would exceed MAX_ENUMERATION", () => {
    // Build many text variables, each with enough values that the
    // product crosses the cap. With 14 vars × 2 values each = 16384 > 10000.
    const cb = condBlock("cb");
    const r1 = row("r1", cb.id, 0);
    const N = 14;
    const variables: EvalVariable[] = [];
    const values: StaticValue[] = [];
    const chips: EvalChip[] = [];
    for (let i = 0; i < N; i++) {
      const v = textVar(`v${i}`);
      variables.push(v);
      const a = textValue(`v${i}-a`, v.id);
      const b = textValue(`v${i}-b`, v.id);
      values.push(a, b);
      chips.push(textChip(`c${i}`, r1.id, v.id, a.id));
    }
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb],
      rows: [r1],
      chips,
      variables,
      values,
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("cap_exceeded");
  });

  it("MAX_ENUMERATION export is a finite positive number", () => {
    expect(typeof MAX_ENUMERATION).toBe("number");
    expect(MAX_ENUMERATION).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_ENUMERATION)).toBe(true);
  });

  it("scopes uncovered analysis per condition block (no cross-block bleed)", () => {
    const performer = textVar("VAR_PERFORMER");
    const a = textValue("VAL_A", performer.id);
    const b = textValue("VAL_B", performer.id);
    const cb1 = condBlock("cb1");
    const cb2 = condBlock("cb2");
    const r1 = row("r1", cb1.id, 0);
    const r2 = row("r2", cb2.id, 0);
    const out = uncoveredAssignmentsByBlock({
      blocks: [cb1, cb2],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, a.id),
        textChip("c2", r2.id, performer.id, b.id),
      ],
      variables: [performer],
      values: [a, b],
    });
    expect(out.get(cb1.id)?.status).toBe("has_uncovered");
    expect(out.get(cb2.id)?.status).toBe("has_uncovered");
    // Each block's uncovered list is independent of the other's chip set.
    expect(out.get(cb1.id)?.uncovered).toEqual([{ [performer.id]: b.id }]);
    expect(out.get(cb2.id)?.uncovered).toEqual([{ [performer.id]: a.id }]);
  });
});

// ----------------------------------------------------------------------
// Sanity: pure function, same StaticInputs returns same output
// ----------------------------------------------------------------------

describe("staticShadowedRows / determinism", () => {
  it("same input → same output across calls", () => {
    const performer = textVar("VAR_PERFORMER");
    const cb = condBlock("cb");
    const winter = textValue("VAL_WINTER", performer.id);
    const summer = textValue("VAL_SUMMER", performer.id);
    const r1 = row("r1", cb.id, 0);
    const r2 = row("r2", cb.id, 1);
    const input: StaticInputs = {
      blocks: [cb],
      rows: [r1, r2],
      chips: [
        textChip("c1", r1.id, performer.id, winter.id),
        textChip("c2", r2.id, performer.id, winter.id),
      ],
      variables: [performer],
      values: [winter, summer],
    };
    const a = staticShadowedRows(input);
    const b = staticShadowedRows(input);
    expect(a).toEqual(b);
  });
});
