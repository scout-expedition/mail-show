import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addAction,
  addLetters,
  addPlaythrough,
  addPlaythroughChoice,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../_helpers";

// Pins playthrough_variables aggregation. The SQL view sums each impact
// column across the actions chosen by a playthrough; combined_national
// excludes epicenter on purpose (see 0001_init.sql:434). This mirrors
// tallyVariables() in src/lib/playthrough/variables.ts so the DB and the
// app cannot drift.

describe("playthrough_variables", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should return all-zero columns when the playthrough has no choices", async () => {
    const playthroughId = await addPlaythrough(sb, { suffix: "empty" });

    const { data } = await sb
      .from("playthrough_variables")
      .select("*")
      .eq("playthrough_id", playthroughId)
      .single();

    expect(data).toMatchObject({
      world_status: 0,
      demerits: 0,
      proletariat: 0,
      gentry: 0,
      epicenter: 0,
      folos: 0,
      emberlyn: 0,
      spokgrad: 0,
      pelico: 0,
      combined_national: 0,
    });
  });

  it("should sum each impact column across chosen actions", async () => {
    const seed = await seedStoryline(sb, { suffix: "tally-sum", days: 1 });
    const [letterId] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 1,
    });
    const actionId = await addAction(sb, {
      letterId,
      impacts: {
        impact_world_status: 1,
        impact_demerits: 2,
        impact_proletariat: 3,
        impact_gentry: 4,
        impact_epicenter: 5,
        impact_folos: 6,
        impact_emberlyn: 7,
        impact_spokgrad: 8,
        impact_pelico: 9,
      },
    });
    const playthroughId = await addPlaythrough(sb, { suffix: "tally-sum" });
    await addPlaythroughChoice(sb, {
      playthroughId,
      letterId,
      actionId,
    });

    const { data } = await sb
      .from("playthrough_variables")
      .select("*")
      .eq("playthrough_id", playthroughId)
      .single();

    expect(data).toMatchObject({
      world_status: 1,
      demerits: 2,
      proletariat: 3,
      gentry: 4,
      epicenter: 5,
      folos: 6,
      emberlyn: 7,
      spokgrad: 8,
      pelico: 9,
    });
  });

  it("should compute combined_national as folos + emberlyn + spokgrad + pelico, excluding epicenter", async () => {
    const seed = await seedStoryline(sb, { suffix: "epicenter-excl", days: 1 });
    const [letterId] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 1,
    });
    const actionId = await addAction(sb, {
      letterId,
      impacts: {
        impact_folos: 1,
        impact_emberlyn: 1,
        impact_spokgrad: 1,
        impact_pelico: 1,
        impact_epicenter: 1_000_000,
      },
    });
    const playthroughId = await addPlaythrough(sb, { suffix: "epicenter-excl" });
    await addPlaythroughChoice(sb, { playthroughId, letterId, actionId });

    const { data } = await sb
      .from("playthrough_variables")
      .select("epicenter, combined_national")
      .eq("playthrough_id", playthroughId)
      .single();

    expect(data?.epicenter).toBe(1_000_000);
    expect(data?.combined_national).toBe(4);
  });
});
