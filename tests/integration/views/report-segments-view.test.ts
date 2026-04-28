import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addLetters,
  addReportSegment,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../_helpers";

// Pins report_segments_view.report_id and effective_day_id. View definition
// lives in supabase/migrations/0012_report_segment_summary.sql.

describe("report_segments_view", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  describe("report_id", () => {
    it("should format as R-{abbreviation}{group_sequence}/{variant}", async () => {
      const seed = await seedStoryline(sb, { suffix: "report-id", days: 1 });
      const segId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "ii",
      });

      const { data } = await sb
        .from("report_segments_view")
        .select("report_id")
        .eq("id", segId)
        .single();

      expect(data?.report_id).toBe("R-T1/ii");
    });
  });

  describe("effective_day_id", () => {
    it("should equal letter_groups.delivery_day_id+1 when no overrides are set", async () => {
      // seed gives us 2 days at numbers 9000, 9001, with letter_group on 9000.
      const seed = await seedStoryline(sb, { suffix: "eff-default", days: 2 });
      const [, day9001] = seed.dayIds;
      const segId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "i",
      });

      const { data } = await sb
        .from("report_segments_view")
        .select("effective_day_id")
        .eq("id", segId)
        .single();

      // Group is on day 9000 → effective is 9000+1 = 9001 (== second seeded day).
      expect(data?.effective_day_id).toBe(day9001);
    });

    it("should use the segment's own delivery_day_override_id when present", async () => {
      const seed = await seedStoryline(sb, {
        suffix: "eff-segment-override",
        days: 3,
      });
      const [, , day9002] = seed.dayIds;

      const segId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "i",
        deliveryDayOverrideId: day9002,
      });

      const { data } = await sb
        .from("report_segments_view")
        .select("effective_day_id")
        .eq("id", segId)
        .single();

      expect(data?.effective_day_id).toBe(day9002);
    });

    it("should use min(letter delivery_day_override)+1 when any letter in the group has an override", async () => {
      // seed: group on day 9000, with extra days 9001, 9002, 9003.
      const seed = await seedStoryline(sb, {
        suffix: "eff-letter-override",
        days: 4,
      });
      const [, day9001, day9002] = seed.dayIds;

      // Two letters: one on 9002, one on 9001. Min override = 9001 → effective = 9002.
      await addLetters(sb, {
        groupId: seed.groupId,
        count: 2,
        deliveryOverrides: [day9002, day9001],
      });

      const segId = await addReportSegment(sb, {
        reportGroupId: seed.reportGroupId,
        variant: "i",
      });

      const { data } = await sb
        .from("report_segments_view")
        .select("effective_day_id")
        .eq("id", segId)
        .single();

      expect(data?.effective_day_id).toBe(day9002);
    });
  });
});
