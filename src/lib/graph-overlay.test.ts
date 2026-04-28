import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPACT_FILTER,
  extractActiveImpacts,
  type ImpactFilter,
} from "./graph-overlay";
import { makeAction, makeNation } from "../../tests/fixtures/builders";

function makeFilter(overrides: Partial<ImpactFilter> = {}): ImpactFilter {
  return {
    ...DEFAULT_IMPACT_FILTER,
    ...overrides,
    categories: { ...DEFAULT_IMPACT_FILTER.categories, ...overrides.categories },
    classes: { ...DEFAULT_IMPACT_FILTER.classes, ...overrides.classes },
    nations: { ...DEFAULT_IMPACT_FILTER.nations, ...overrides.nations },
    world: { ...DEFAULT_IMPACT_FILTER.world, ...overrides.world },
  };
}

describe("extractActiveImpacts", () => {
  it("should return an empty array when masterEnabled is false", () => {
    const action = makeAction({ impact_world_status: 5, impact_folos: 3 });
    const filter = makeFilter({ masterEnabled: false });
    expect(extractActiveImpacts(action, filter, [])).toEqual([]);
  });

  it("should omit impacts with a value of zero", () => {
    const action = makeAction({ impact_world_status: 0 });
    expect(extractActiveImpacts(action, makeFilter(), [])).toEqual([]);
  });

  it("should emit world impacts in fixed order: world_status before demerits", () => {
    const action = makeAction({ impact_world_status: 1, impact_demerits: -2 });
    const result = extractActiveImpacts(action, makeFilter(), []);
    expect(result.map((r) => r.key)).toEqual(["world:world_status", "world:demerits"]);
  });

  it("should emit class impacts after world impacts", () => {
    const action = makeAction({
      impact_world_status: 1,
      impact_proletariat: 2,
      impact_gentry: 3,
    });
    const result = extractActiveImpacts(action, makeFilter(), []);
    expect(result.map((r) => r.key)).toEqual([
      "world:world_status",
      "class:proletariat",
      "class:gentry",
    ]);
  });

  it("should emit nation impacts sorted by Nation.sort_order", () => {
    const action = makeAction({
      impact_folos: 1,
      impact_emberlyn: 2,
      impact_pelico: 3,
    });
    const nations = [
      makeNation({ id: "n-pelico", name: "Pelico", sort_order: 1 }),
      makeNation({ id: "n-folos", name: "Folos", sort_order: 2 }),
      makeNation({ id: "n-emberlyn", name: "Emberlyn", sort_order: 3 }),
    ];
    const result = extractActiveImpacts(action, makeFilter(), nations);
    expect(result.map((r) => r.label)).toEqual(["Pelico", "Folos", "Emberlyn"]);
  });

  it("should drop categories that are toggled off", () => {
    const action = makeAction({ impact_world_status: 1, impact_proletariat: 2 });
    const filter = makeFilter({
      categories: { ...DEFAULT_IMPACT_FILTER.categories, class: false },
    });
    const result = extractActiveImpacts(action, filter, []);
    expect(result.map((r) => r.key)).toEqual(["world:world_status"]);
  });

  it("should drop a specific nation when its toggle is off", () => {
    const action = makeAction({ impact_folos: 1, impact_pelico: 2 });
    const nations = [
      makeNation({ id: "n-folos", name: "Folos", sort_order: 1 }),
      makeNation({ id: "n-pelico", name: "Pelico", sort_order: 2 }),
    ];
    const filter = makeFilter({
      nations: { ...DEFAULT_IMPACT_FILTER.nations, folos: false },
    });
    const result = extractActiveImpacts(action, filter, nations);
    expect(result.map((r) => r.label)).toEqual(["Pelico"]);
  });

  it("should ignore nations whose name has no matching impact column", () => {
    const action = makeAction({ impact_folos: 1 });
    const nations = [
      makeNation({ id: "n-x", name: "Atlantis", sort_order: 1 }),
    ];
    const result = extractActiveImpacts(action, makeFilter(), nations);
    expect(result).toEqual([]);
  });

  it("should set valueColor on world_status (and not on demerits)", () => {
    const action = makeAction({ impact_world_status: 1, impact_demerits: 1 });
    const result = extractActiveImpacts(action, makeFilter(), []);
    const ws = result.find((r) => r.key === "world:world_status");
    const dem = result.find((r) => r.key === "world:demerits");
    expect(ws?.valueColor).toBe("#ffffff");
    expect(dem?.valueColor).toBeUndefined();
  });
});
