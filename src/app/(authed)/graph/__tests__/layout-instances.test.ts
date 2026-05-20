import { describe, expect, it } from "vitest";
import {
  partitionGroupInstances,
  type PartitionGroup,
  type PartitionLetter,
} from "../layout-instances";

// Tiny constructors so the test bodies stay readable.
function group(id: string, delivery_day_id: string | null): PartitionGroup {
  return { id, delivery_day_id };
}
function letter(
  id: string,
  variant: string | null,
  piece: number | null,
  effective_day_id: string | null
): PartitionLetter {
  return { id, variant, piece, effective_day_id };
}

describe("partitionGroupInstances", () => {
  it("scenario (i): letter in group's default day → primary instance only", () => {
    const g = group("G1", "day1");
    const ls = [letter("L1", "a", null, "day1")];
    const instances = partitionGroupInstances(g, ls);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toEqual({
      rowId: "day1",
      dayKey: null, // null marks the primary instance
      variants: ["a"],
    });
  });

  it("scenario (ii): letter with override to a *later* day → secondary instance on the override day", () => {
    const g = group("G1", "day1");
    // Letter overrides to day3 (later than the group's home day1)
    const ls = [letter("L1", "a", null, "day3")];
    const instances = partitionGroupInstances(g, ls);
    // Two instances: primary (empty) on day1 + secondary on day3 with variant "a".
    expect(instances).toHaveLength(2);
    const primary = instances.find((i) => i.rowId === "day1");
    const secondary = instances.find((i) => i.rowId === "day3");
    expect(primary).toEqual({
      rowId: "day1",
      dayKey: null,
      variants: [],
    });
    expect(secondary).toEqual({
      rowId: "day3",
      dayKey: "day3",
      variants: ["a"],
    });
  });

  it("scenario (iii): letter with override to an *earlier* day → secondary instance on the earlier day", () => {
    const g = group("G1", "day5");
    // Letter overrides BACK to day2 — earlier than the group's home day.
    const ls = [letter("L1", "a", null, "day2")];
    const instances = partitionGroupInstances(g, ls);
    expect(instances).toHaveLength(2);
    const primary = instances.find((i) => i.rowId === "day5");
    const secondary = instances.find((i) => i.rowId === "day2");
    expect(primary).toEqual({
      rowId: "day5",
      dayKey: null,
      variants: [],
    });
    expect(secondary).toEqual({
      rowId: "day2",
      dayKey: "day2",
      variants: ["a"],
    });
  });

  it("scenario (iv): multiple letters splitting a group across days", () => {
    const g = group("G1", "day1");
    const ls = [
      letter("L1", "a", null, "day1"), // home day
      letter("L2", "b", null, "day3"), // override to day3
      letter("L3", "c", null, "day3"), // override to day3 (same as b)
      letter("L4", "d", null, "day5"), // override to day5
    ];
    const instances = partitionGroupInstances(g, ls);
    // Three rows: home day1 (with "a"), day3 (with "b" and "c"), day5 (with "d")
    expect(instances).toHaveLength(3);
    const home = instances.find((i) => i.rowId === "day1");
    const mid = instances.find((i) => i.rowId === "day3");
    const late = instances.find((i) => i.rowId === "day5");
    expect(home).toEqual({
      rowId: "day1",
      dayKey: null,
      variants: ["a"],
    });
    expect(mid?.dayKey).toBe("day3");
    expect(mid?.variants.sort()).toEqual(["b", "c"]);
    expect(late).toEqual({
      rowId: "day5",
      dayKey: "day5",
      variants: ["d"],
    });
  });

  it("group with no letters still emits a primary instance for the home pill", () => {
    const g = group("G1", "day1");
    const instances = partitionGroupInstances(g, []);
    expect(instances).toEqual([
      { rowId: "day1", dayKey: null, variants: [] },
    ]);
  });

  it("unscheduled group with an override-pinned letter still mints both instances", () => {
    const g = group("G1", null);
    const ls = [letter("L1", "a", null, "day2")];
    const instances = partitionGroupInstances(g, ls);
    expect(instances).toHaveLength(2);
    const home = instances.find((i) => i.rowId === "unscheduled");
    const pinned = instances.find((i) => i.rowId === "day2");
    expect(home).toEqual({
      rowId: "unscheduled",
      dayKey: null,
      variants: [],
    });
    expect(pinned).toEqual({
      rowId: "day2",
      dayKey: "day2",
      variants: ["a"],
    });
  });

  it("multi-piece variant with diverging effective_day_ids follows the lowest piece (the primary)", () => {
    // Edge case: pieces should agree per business rule (override is set per
    // letter row, but the UI surfaces one card per variant), but if they
    // diverge we follow the lowest-piece letter so the variant card always
    // lands somewhere deterministic.
    const g = group("G1", "day1");
    const ls = [
      letter("L1", "a", 0, "day3"), // primary (lowest piece) → day3 wins
      letter("L2", "a", 1, "day5"),
    ];
    const instances = partitionGroupInstances(g, ls);
    const day3 = instances.find((i) => i.rowId === "day3");
    expect(day3?.variants).toEqual(["a"]);
    // No accidental third instance from the piece-1 letter.
    expect(instances).toHaveLength(2);
  });
});
