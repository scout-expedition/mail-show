import { describe, expect, it } from "vitest";
import { tallyVariables, ZERO_VARIABLES } from "./variables";
import { makeAction } from "../../../tests/fixtures/builders";

describe("tallyVariables", () => {
  it("should return ZERO_VARIABLES when actions array is empty", () => {
    expect(tallyVariables([])).toEqual(ZERO_VARIABLES);
  });

  it("should sum each impact column independently", () => {
    const result = tallyVariables([
      makeAction({
        impact_world_status: 1,
        impact_demerits: 2,
        impact_proletariat: 3,
        impact_gentry: 4,
        impact_epicenter: 5,
        impact_folos: 6,
        impact_emberlyn: 7,
        impact_spokgrad: 8,
        impact_pelico: 9,
      }),
    ]);

    expect(result.world_status).toBe(1);
    expect(result.demerits).toBe(2);
    expect(result.proletariat).toBe(3);
    expect(result.gentry).toBe(4);
    expect(result.epicenter).toBe(5);
    expect(result.folos).toBe(6);
    expect(result.emberlyn).toBe(7);
    expect(result.spokgrad).toBe(8);
    expect(result.pelico).toBe(9);
  });

  it("should accumulate columns across multiple actions", () => {
    const result = tallyVariables([
      makeAction({ impact_world_status: 1, impact_folos: 2 }),
      makeAction({ impact_world_status: 4, impact_folos: 3 }),
    ]);

    expect(result.world_status).toBe(5);
    expect(result.folos).toBe(5);
  });

  describe("combined_national", () => {
    it("should be the sum of folos + emberlyn + spokgrad + pelico", () => {
      const result = tallyVariables([
        makeAction({
          impact_folos: 1,
          impact_emberlyn: 2,
          impact_spokgrad: 3,
          impact_pelico: 4,
        }),
      ]);
      expect(result.combined_national).toBe(10);
    });

    it("should NOT include epicenter, even when it is large", () => {
      const result = tallyVariables([
        makeAction({
          impact_folos: 1,
          impact_emberlyn: 1,
          impact_spokgrad: 1,
          impact_pelico: 1,
          impact_epicenter: 1_000_000,
        }),
      ]);
      expect(result.combined_national).toBe(4);
      expect(result.epicenter).toBe(1_000_000);
    });
  });

  it("should not mutate ZERO_VARIABLES across calls", () => {
    tallyVariables([makeAction({ impact_world_status: 5 })]);
    expect(ZERO_VARIABLES.world_status).toBe(0);
  });
});
