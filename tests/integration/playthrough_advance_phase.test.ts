import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addAction,
  addLetters,
  addPlaythrough,
  addPlaythroughChoice,
  addReportSegment,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "./_helpers";

// Pins the `advance_phase(p_id, expected_phase)` RPC introduced in
// 20260527185748_advance_phase_rpc.sql. The function is load-bearing:
// every phase advancement in play mode goes through it, and it handles
// fallback auto-apply + report-segments firing as side effects.

const sb = makeTestClient();

/** Put a playthrough at a specific (day, phase) cursor by direct UPDATE.
 *  advance_phase only checks `expected_phase`; it doesn't gate on
 *  `started=true`, so tests can use unstarted rows. */
async function setCursor(
  client: SupabaseClient,
  playthroughId: string,
  dayId: string,
  phase: "top_of_day" | "sorting" | "inspection" | "end_of_day"
): Promise<void> {
  const { error } = await client
    .from("playthroughs")
    .update({
      current_day_id: dayId,
      current_phase: phase,
      phase_started_at: new Date().toISOString(),
    })
    .eq("id", playthroughId);
  if (error) throw new Error(`setCursor: ${error.message}`);
}

async function getPlaythrough(
  client: SupabaseClient,
  id: string
): Promise<{
  current_day_id: string | null;
  current_phase: string;
  furthest_day_id: string | null;
  furthest_phase: string | null;
}> {
  const { data, error } = await client
    .from("playthroughs")
    .select("current_day_id, current_phase, furthest_day_id, furthest_phase")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`getPlaythrough: ${error?.message}`);
  return data;
}

describe("advance_phase RPC", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  describe("phase progression within a day", () => {
    it("should advance top_of_day → sorting (same day)", async () => {
      const seed = await seedStoryline(sb, { suffix: "tod-sort", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "tod-sort" });
      await setCursor(sb, playId, seed.dayIds[0], "top_of_day");

      const { data, error } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "top_of_day",
      });
      expect(error).toBeNull();
      expect(data).toBe(true);

      const p = await getPlaythrough(sb, playId);
      expect(p.current_phase).toBe("sorting");
      expect(p.current_day_id).toBe(seed.dayIds[0]);
    });

    it("should advance sorting → inspection (same day)", async () => {
      const seed = await seedStoryline(sb, { suffix: "sort-inspect", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "sort-inspect" });
      await setCursor(sb, playId, seed.dayIds[0], "sorting");

      const { data } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "sorting",
      });
      expect(data).toBe(true);

      const p = await getPlaythrough(sb, playId);
      expect(p.current_phase).toBe("inspection");
    });

    it("should advance inspection → end_of_day (same day)", async () => {
      const seed = await seedStoryline(sb, { suffix: "inspect-eod", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "inspect-eod" });
      await setCursor(sb, playId, seed.dayIds[0], "inspection");

      const { data } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "inspection",
      });
      expect(data).toBe(true);

      const p = await getPlaythrough(sb, playId);
      expect(p.current_phase).toBe("end_of_day");
    });

    it("should advance end_of_day → next day's top_of_day", async () => {
      const seed = await seedStoryline(sb, { suffix: "eod-roll", days: 2 });
      const playId = await addPlaythrough(sb, { suffix: "eod-roll" });
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");

      const { data } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });
      expect(data).toBe(true);

      const p = await getPlaythrough(sb, playId);
      expect(p.current_phase).toBe("top_of_day");
      expect(p.current_day_id).toBe(seed.dayIds[1]);
    });

    it("should no-op when there is no next day after end_of_day", async () => {
      const seed = await seedStoryline(sb, { suffix: "final-eod", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "final-eod" });
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");

      const { data, error } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });
      expect(error).toBeNull();
      expect(data).toBe(false);

      const p = await getPlaythrough(sb, playId);
      // Cursor unchanged.
      expect(p.current_phase).toBe("end_of_day");
      expect(p.current_day_id).toBe(seed.dayIds[0]);
    });
  });

  describe("idempotency token", () => {
    it("should no-op when expected_phase doesn't match current_phase", async () => {
      const seed = await seedStoryline(sb, { suffix: "idem", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "idem" });
      await setCursor(sb, playId, seed.dayIds[0], "sorting");

      const { data, error } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "top_of_day", // stale tab
      });
      expect(error).toBeNull();
      expect(data).toBe(false);

      const p = await getPlaythrough(sb, playId);
      // Cursor unchanged.
      expect(p.current_phase).toBe("sorting");
    });
  });

  describe("fallback auto-apply on exiting inspection", () => {
    it("should insert a choice with applied_via_fallback=true for unanswered letters that have a fallback set", async () => {
      const seed = await seedStoryline(sb, { suffix: "fb-apply", days: 1 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      // Two actions on the letter; configure the second as the fallback.
      const actionA = await addAction(sb, { letterId });
      const actionB = await addAction(sb, { letterId });
      await sb
        .from("inspection_letters")
        .update({ fallback_mirror_action_id: actionB })
        .eq("id", letterId);

      const playId = await addPlaythrough(sb, {
        suffix: "fb-apply",
        currentDayId: seed.dayIds[0],
      });
      await setCursor(sb, playId, seed.dayIds[0], "inspection");

      // Player did NOT choose anything for this letter — advance past inspection.
      const { data } = await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "inspection",
      });
      expect(data).toBe(true);

      const { data: choices } = await sb
        .from("playthrough_action_choices")
        .select("inspection_letter_id, chosen_action_id, applied_via_fallback")
        .eq("playthrough_id", playId);
      expect(choices).toHaveLength(1);
      expect(choices?.[0]).toEqual({
        inspection_letter_id: letterId,
        chosen_action_id: actionB,
        applied_via_fallback: true,
      });
      // Sanity: actionA was the other action, not chosen.
      expect(choices?.[0].chosen_action_id).not.toBe(actionA);
    });

    it("should leave letters WITHOUT a fallback configured unset", async () => {
      const seed = await seedStoryline(sb, { suffix: "fb-none", days: 1 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      await addAction(sb, { letterId });
      // No fallback_mirror_action_id set on the letter.

      const playId = await addPlaythrough(sb, {
        suffix: "fb-none",
        currentDayId: seed.dayIds[0],
      });
      await setCursor(sb, playId, seed.dayIds[0], "inspection");
      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "inspection",
      });

      const { data: choices } = await sb
        .from("playthrough_action_choices")
        .select("id")
        .eq("playthrough_id", playId);
      expect(choices ?? []).toEqual([]);
    });

    it("should not overwrite a player's existing choice when the letter has a fallback", async () => {
      const seed = await seedStoryline(sb, { suffix: "fb-no-clobber", days: 1 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const chosen = await addAction(sb, { letterId });
      const fallback = await addAction(sb, { letterId });
      await sb
        .from("inspection_letters")
        .update({ fallback_mirror_action_id: fallback })
        .eq("id", letterId);

      const playId = await addPlaythrough(sb, {
        suffix: "fb-no-clobber",
        currentDayId: seed.dayIds[0],
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId,
        actionId: chosen,
      });
      await setCursor(sb, playId, seed.dayIds[0], "inspection");

      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "inspection",
      });

      const { data: choices } = await sb
        .from("playthrough_action_choices")
        .select("chosen_action_id, applied_via_fallback")
        .eq("playthrough_id", playId);
      expect(choices).toHaveLength(1);
      expect(choices?.[0].chosen_action_id).toBe(chosen);
      expect(choices?.[0].applied_via_fallback).toBe(false);
    });

    it("should NOT fire when exiting a phase other than inspection (e.g. sorting → inspection)", async () => {
      const seed = await seedStoryline(sb, { suffix: "fb-wrong-exit", days: 1 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const fallback = await addAction(sb, { letterId });
      await sb
        .from("inspection_letters")
        .update({ fallback_mirror_action_id: fallback })
        .eq("id", letterId);

      const playId = await addPlaythrough(sb, {
        suffix: "fb-wrong-exit",
        currentDayId: seed.dayIds[0],
      });
      await setCursor(sb, playId, seed.dayIds[0], "sorting");

      // Advance sorting → inspection. Should NOT fire fallback apply.
      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "sorting",
      });

      const { data: choices } = await sb
        .from("playthrough_action_choices")
        .select("id")
        .eq("playthrough_id", playId);
      expect(choices ?? []).toEqual([]);
    });
  });

  describe("report-segments firing on entering top_of_day", () => {
    it("should record one row per prior-day chosen action with a non-null report_segment_id", async () => {
      const seed = await seedStoryline(sb, { suffix: "rs-fire", days: 2 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const segmentId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "i",
      });
      const actionId = await addAction(sb, {
        letterId,
        reportSegmentId: segmentId,
      });
      const playId = await addPlaythrough(sb, {
        suffix: "rs-fire",
        currentDayId: seed.dayIds[0],
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId,
        actionId,
      });
      // Sit at Day 1 EOD; advance into Day 2 TOD.
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");

      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });

      const { data: fired } = await sb
        .from("playthrough_report_segments_fired")
        .select("playthrough_id, day_id, report_segment_id")
        .eq("playthrough_id", playId);
      expect(fired).toEqual([
        {
          playthrough_id: playId,
          day_id: seed.dayIds[1],
          report_segment_id: segmentId,
        },
      ]);
    });

    it("should be idempotent on re-entering TOD (no duplicate rows)", async () => {
      const seed = await seedStoryline(sb, { suffix: "rs-dup", days: 2 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      const segmentId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "i",
      });
      const actionId = await addAction(sb, {
        letterId,
        reportSegmentId: segmentId,
      });
      const playId = await addPlaythrough(sb, {
        suffix: "rs-dup",
        currentDayId: seed.dayIds[0],
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId,
        actionId,
      });

      // First entry into Day 2 TOD.
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");
      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });
      // Re-enter via a manual reset (simulates a player going back to Day 1
      // EOD via Track D, then forward again — Track D not wired yet but the
      // RPC's idempotency contract should hold regardless).
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");
      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });

      const { data: fired } = await sb
        .from("playthrough_report_segments_fired")
        .select("id")
        .eq("playthrough_id", playId);
      expect(fired).toHaveLength(1);
    });

    it("should not fire segments for actions with NULL report_segment_id", async () => {
      const seed = await seedStoryline(sb, { suffix: "rs-null", days: 2 });
      const [letterId] = await addLetters(sb, {
        groupId: seed.groupId,
        count: 1,
      });
      // Action without report_segment_id.
      const actionId = await addAction(sb, { letterId });
      const playId = await addPlaythrough(sb, {
        suffix: "rs-null",
        currentDayId: seed.dayIds[0],
      });
      await addPlaythroughChoice(sb, {
        playthroughId: playId,
        letterId,
        actionId,
      });
      await setCursor(sb, playId, seed.dayIds[0], "end_of_day");
      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "end_of_day",
      });

      const { data: fired } = await sb
        .from("playthrough_report_segments_fired")
        .select("id")
        .eq("playthrough_id", playId);
      expect(fired ?? []).toEqual([]);
    });
  });

  describe("phase log + furthest tracking", () => {
    it("should close the open phase log row and open a new one on advance", async () => {
      const seed = await seedStoryline(sb, { suffix: "log", days: 1 });
      const playId = await addPlaythrough(sb, { suffix: "log" });
      await setCursor(sb, playId, seed.dayIds[0], "top_of_day");
      // Seed the initial open phase log row that the UI would have created
      // when entering TOD. advance_phase only closes EXISTING open rows;
      // without this row the first-ever advance has no row to close, which
      // is the live behavior (entries only exist after the first advance).
      await sb.from("playthrough_phase_log").insert({
        playthrough_id: playId,
        day_id: seed.dayIds[0],
        phase: "top_of_day",
      });

      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "top_of_day",
      });

      const { data: rows } = await sb
        .from("playthrough_phase_log")
        .select("phase, exited_at, superseded_at")
        .eq("playthrough_id", playId)
        .order("entered_at");
      expect(rows).toHaveLength(2);
      // Prior row closed.
      expect(rows?.[0].phase).toBe("top_of_day");
      expect(rows?.[0].exited_at).not.toBeNull();
      // New row open.
      expect(rows?.[1].phase).toBe("sorting");
      expect(rows?.[1].exited_at).toBeNull();
      expect(rows?.[1].superseded_at).toBeNull();
    });

    it("should bump furthest_day_id + furthest_phase when advancing past them", async () => {
      const seed = await seedStoryline(sb, { suffix: "furthest", days: 2 });
      const playId = await addPlaythrough(sb, { suffix: "furthest" });
      await setCursor(sb, playId, seed.dayIds[0], "sorting");

      await sb.rpc("advance_phase", {
        p_id: playId,
        expected_phase: "sorting",
      });
      const p = await getPlaythrough(sb, playId);
      expect(p.furthest_day_id).toBe(seed.dayIds[0]);
      expect(p.furthest_phase).toBe("inspection");
    });
  });
});
