import { describe, expect, it } from "vitest";
import type { EvalBlock, EvalChip, EvalRow, EvalVariable } from "./evaluator";
import {
  MAX_ENUMERATION,
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
    // unset is also uncovered (no chip matches an unset variable).
    const outcomes = (block?.uncovered ?? [])
      .map((u) => u[performer.id])
      .sort();
    expect(outcomes).toEqual([c.id, "unset"].sort());
  });

  it("reports 'covered' when = A and ≠ A together cover everything except unset", () => {
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
    // unset still falls through (no chip matches an unset variable).
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered).toEqual([{ [performer.id]: "unset" }]);
  });

  it("two-variable AND row: lists every (var, mood) combo not matched", () => {
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
    // performer dom = {unset, A, B}, mood dom = {unset, stormy, calm}
    // = 9 assignments; only (A, stormy) matches → 8 uncovered.
    expect(block?.status).toBe("has_uncovered");
    expect(block?.uncovered.length).toBe(8);
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
// uncoveredAssignmentsByBlock — number_ref + cap + edge cases
// ----------------------------------------------------------------------

describe("uncoveredAssignmentsByBlock / edges", () => {
  it("status='skipped_numeric' when any row has a number_ref chip", () => {
    const performer = textVar("VAR_PERFORMER");
    const world = numVar("VAR_WORLD");
    const cb = condBlock("cb");
    const winter = textValue("VAL_WINTER", performer.id);
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
      values: [winter],
    });
    const block = out.get(cb.id);
    expect(block?.status).toBe("skipped_numeric");
    expect(block?.uncovered).toEqual([]);
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
    expect(out.get(cb1.id)?.uncovered.map((u) => u[performer.id]).sort()).toEqual(
      [b.id, "unset"].sort()
    );
    expect(out.get(cb2.id)?.uncovered.map((u) => u[performer.id]).sort()).toEqual(
      [a.id, "unset"].sort()
    );
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
