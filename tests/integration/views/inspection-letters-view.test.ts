import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addLetters,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../_helpers";

// Pins inspection_letters_view.content_id. The view's formula lives in
// supabase/migrations/0011_single_letter_variant_a.sql; CLAUDE.md's "IL-…"
// example is stale — the actual prefix is "L-".

describe("inspection_letters_view.content_id", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should hide the variant suffix when a group has a single letter", async () => {
    const seed = await seedStoryline(sb, { suffix: "single", days: 1 });
    const [letterId] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 1,
    });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .eq("id", letterId)
      .single();

    expect(data?.content_id).toBe("L-T1");
  });

  it("should include /a, /b suffixes when a group has multiple letters", async () => {
    const seed = await seedStoryline(sb, { suffix: "multi", days: 1 });
    const ids = await addLetters(sb, { groupId: seed.groupId, count: 2 });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("variant, content_id")
      .in("id", ids)
      .order("variant");

    expect(data?.map((r) => r.content_id)).toEqual(["L-T1/a", "L-T1/b"]);
  });

  it("should append a non-zero piece number after the variant", async () => {
    const seed = await seedStoryline(sb, { suffix: "piece", days: 1 });
    const [aId, bId] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 2,
      pieces: [1, 3],
    });

    const { data: a } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .eq("id", aId)
      .single();
    const { data: b } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .eq("id", bId)
      .single();

    expect(a?.content_id).toBe("L-T1/a1");
    expect(b?.content_id).toBe("L-T1/b3");
  });

  it("should hide piece when piece is 0 (per migration 0006)", async () => {
    const seed = await seedStoryline(sb, { suffix: "piece-zero", days: 1 });
    const [letterId] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 2,
      pieces: [0, null],
    });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .eq("id", letterId)
      .single();

    expect(data?.content_id).toBe("L-T1/a");
  });

  it("should expose effective_day_id from the override when set, otherwise from letter_groups.delivery_day_id", async () => {
    const seed = await seedStoryline(sb, { suffix: "effective-day", days: 2 });
    const [groupDay, overrideDay] = seed.dayIds;

    const [withoutOverride, withOverride] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 2,
      deliveryOverrides: [null, overrideDay],
    });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("variant, effective_day_id")
      .in("id", [withoutOverride, withOverride])
      .order("variant");

    expect(data).toEqual([
      { variant: "a", effective_day_id: groupDay },
      { variant: "b", effective_day_id: overrideDay },
    ]);
  });
});
