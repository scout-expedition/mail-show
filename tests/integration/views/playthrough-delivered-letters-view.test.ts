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

// Pins playthrough_delivered_letters_view — the per-playthrough union of
// scheduled letters (effective_day_id matches current_day_id) and branch
// letters reached via prior-day chosen actions' `next_letter_id`. View
// SQL lives in 20260527121220_playthrough_play_mode.sql; if it drifts,
// the play-mode inspection panel renders the wrong letters.

describe("playthrough_delivered_letters_view", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  describe("scheduled deliveries", () => {
    it("should surface letters whose effective_day_id matches the playthrough's current_day_id", async () => {
      const seed = await seedStoryline(sb, { suffix: "scheduled", days: 2 });
      const [day1, day2] = seed.dayIds;
      // Group is on day1. Add two letters; one stays on day1, the other
      // overrides to day2 so the view should split them by current_day_id.
      const [aId, bId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 2,
        deliveryOverrides: [null, day2],
      });

      const playId = await addPlaythrough(sb, {
        suffix: "scheduled",
        currentDayId: day1,
      });
      const { data: onDay1 } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id")
        .eq("playthrough_id", playId)
        .order("id");
      expect(onDay1?.map((r) => r.id)).toEqual([aId].sort());

      // Move the cursor to day2 and re-query.
      await sb
        .from("playthroughs")
        .update({ current_day_id: day2 })
        .eq("id", playId);
      const { data: onDay2 } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id")
        .eq("playthrough_id", playId)
        .order("id");
      expect(onDay2?.map((r) => r.id)).toEqual([bId].sort());
    });
  });

  describe("branch deliveries", () => {
    it("should surface letters reached via next_letter_id from a prior-day chosen action", async () => {
      const seed = await seedStoryline(sb, { suffix: "branch", days: 2 });
      const [day1, day2] = seed.dayIds;
      // day1 letter with an action chaining to a day2 letter.
      const [day1LetterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      // The chained letter ALSO lives on day2 (effective_day_id = day2),
      // so the test distinguishes branch vs scheduled by removing it from
      // the day2 scheduled set via delivery_day_override_id = day1. Then
      // we move the cursor to day2 and assert it appears via branch only.
      const seed2 = await seedStoryline(sb, {
        suffix: "branch-target",
        days: 1,
        abbreviation: "U",
        dayNumberBase: 9100,
      });
      const [day2LetterId] = await addLetters(sb, {
        groupId: seed2.groupId,
        count: 1,
        deliveryOverrides: [day1], // keep it OFF day2's scheduled set
      });

      const actionId = await addAction(sb, { letterId: day1LetterId });
      await sb
        .from("actions")
        .update({ next_letter_id: day2LetterId })
        .eq("id", actionId);

      const playId = await addPlaythrough(sb, {
        suffix: "branch",
        currentDayId: day2,
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId: day1LetterId,
        actionId,
      });

      const { data } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id")
        .eq("playthrough_id", playId)
        .order("id");
      // day1LetterId scheduled on day1, day2LetterId overridden to day1 too —
      // neither is on day2 by schedule, but the branch from the prior-day
      // chosen action surfaces day2LetterId.
      expect(data?.map((r) => r.id)).toEqual([day2LetterId]);
    });

    it("should NOT surface branch letters when the source action was chosen on the SAME day", async () => {
      const seed = await seedStoryline(sb, { suffix: "same-day", days: 1 });
      const [day1] = seed.dayIds;
      const [srcLetterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const seed2 = await seedStoryline(sb, {
        suffix: "same-day-target",
        days: 1,
        abbreviation: "V",
        dayNumberBase: 9200,
      });
      const [targetLetterId] = await addLetters(sb, {
        groupId: seed2.groupId,
        count: 1,
        deliveryOverrides: [day1], // schedule it on day1 too so we can isolate the branch case
      });
      const actionId = await addAction(sb, { letterId: srcLetterId });
      await sb
        .from("actions")
        .update({ next_letter_id: targetLetterId })
        .eq("id", actionId);

      // Source action was chosen on day1 AND cursor is on day1 — same day,
      // so the branch CTE's `d_src.number < d_cur.number` filter excludes
      // it. The target only appears via scheduled (since we put it on day1).
      const playId = await addPlaythrough(sb, {
        suffix: "same-day",
        currentDayId: day1,
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId: srcLetterId,
        actionId,
      });

      const { data } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id")
        .eq("playthrough_id", playId)
        .order("id");
      // Both letters land on day1 via scheduled, but neither rides the
      // branch path (same-day choice). The UNION dedups; check both ids
      // are present without duplicates.
      expect(data?.map((r) => r.id).sort()).toEqual(
        [srcLetterId, targetLetterId].sort()
      );
      expect(data?.length).toBe(2);
    });
  });

  describe("per-playthrough scoping", () => {
    it("should not leak rows across playthroughs", async () => {
      const seed = await seedStoryline(sb, { suffix: "scope", days: 1 });
      const [day1] = seed.dayIds;
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const playA = await addPlaythrough(sb, {
        suffix: "scope-a",
        currentDayId: day1,
      });
      const playB = await addPlaythrough(sb, {
        suffix: "scope-b",
        currentDayId: null, // no current day → no scheduled rows
      });

      const { data: aRows } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id, playthrough_id")
        .eq("playthrough_id", playA);
      const { data: bRows } = await sb
        .from("playthrough_delivered_letters_view")
        .select("id, playthrough_id")
        .eq("playthrough_id", playB);

      expect(aRows?.map((r) => r.id)).toEqual([letterId]);
      expect(aRows?.every((r) => r.playthrough_id === playA)).toBe(true);
      expect(bRows ?? []).toEqual([]);
    });
  });
});
