import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addAction,
  addGroup,
  addLetters,
  addReportSegment,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Imports of the action MUST come after the mocks above.
import {
  deleteInspectionLetter,
  moveLetterGroupToDay,
  moveLetterToGroup,
  moveReportSegmentToDay,
  setActionNextLetterByLetterId,
} from "./actions";

describe("moveLetterGroupToDay", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should update delivery_day_id and revalidate /inspection/letters and /graph", async () => {
    const seed = await seedStoryline(sb, { suffix: "move-day", days: 2 });
    const [originalDay, targetDay] = seed.dayIds;

    const { data: before } = await sb
      .from("letter_groups")
      .select("delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(before?.delivery_day_id).toBe(originalDay);

    await moveLetterGroupToDay(seed.groupId, targetDay);

    const { data: after } = await sb
      .from("letter_groups")
      .select("delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(after?.delivery_day_id).toBe(targetDay);

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("should clear delivery_day_id when passed null", async () => {
    const seed = await seedStoryline(sb, { suffix: "clear-day", days: 1 });

    await moveLetterGroupToDay(seed.groupId, null);

    const { data } = await sb
      .from("letter_groups")
      .select("delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(data?.delivery_day_id).toBeNull();
  });

  it("should throw when the group does not exist and reject the update", async () => {
    // Supabase update with no matching row is not an error by default — the
    // action only throws on a Postgres-level error. Pass an invalid uuid to
    // force a real error path.
    await expect(
      moveLetterGroupToDay("not-a-uuid", null)
    ).rejects.toThrow();
  });
});

describe("moveLetterToGroup", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should move a letter into a sibling group and re-slot variants in both groups", async () => {
    const seed = await seedStoryline(sb, { suffix: "move-sibling", days: 1 });
    const sourceGroup = seed.groupId;
    const { groupId: targetGroup } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "move-sibling",
      deliveryDayId: seed.dayIds[0],
    });

    // Source group has two letters (a, b). Target group is empty.
    const [letterA, letterB] = await addLetters(sb, {
      groupId: sourceGroup,
      count: 2,
    });

    await moveLetterToGroup(letterA, targetGroup);

    const { data: movedA } = await sb
      .from("inspection_letters")
      .select("letter_group_id, variant")
      .eq("id", letterA)
      .single();
    const { data: remainingB } = await sb
      .from("inspection_letters")
      .select("letter_group_id, variant")
      .eq("id", letterB)
      .single();

    expect(movedA).toEqual({ letter_group_id: targetGroup, variant: "a" });
    expect(remainingB).toEqual({ letter_group_id: sourceGroup, variant: "a" });

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("should no-op when source and target group ids are the same", async () => {
    const seed = await seedStoryline(sb, { suffix: "noop", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });

    const before = await sb
      .from("inspection_letters")
      .select("variant, sort_order, updated_at")
      .eq("id", letterId)
      .single();

    await moveLetterToGroup(letterId, seed.groupId);

    const after = await sb
      .from("inspection_letters")
      .select("variant, sort_order, updated_at")
      .eq("id", letterId)
      .single();

    expect(after.data).toEqual(before.data);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should reject cross-storyline moves", async () => {
    const seedT = await seedStoryline(sb, {
      suffix: "cross-source",
      abbreviation: "T",
      days: 1,
    });
    const seedU = await seedStoryline(sb, {
      suffix: "cross-target",
      abbreviation: "U",
      days: 1,
      dayNumberBase: 9100,
    });
    const [letterId] = await addLetters(sb, { groupId: seedT.groupId, count: 1 });

    await expect(
      moveLetterToGroup(letterId, seedU.groupId)
    ).rejects.toThrow(/cross-storyline/);
  });

  it("preserves the next-letter link when the target letter moves groups", async () => {
    // The link is an FK to a letter id, so moving that letter between
    // groups leaves the ref intact (unlike the old variant model).
    const seed = await seedStoryline(sb, { suffix: "nl-move", days: 2 });
    const [letterA] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId: letterA });
    const { groupId: group2 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "nl-move-2",
      deliveryDayId: seed.dayIds[1],
    });
    const [letterB] = await addLetters(sb, { groupId: group2, count: 1 });
    await setActionNextLetterByLetterId(actionId, letterB);

    const { groupId: group3 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 3,
      suffix: "nl-move-3",
      deliveryDayId: seed.dayIds[1],
    });
    await moveLetterToGroup(letterB, group3);

    const { data: action } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(action?.next_letter_id).toBe(letterB);
  });
});

describe("setActionNextLetterByLetterId", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("stores the id for a same-storyline, later-day target", async () => {
    const seed = await seedStoryline(sb, { suffix: "nl-set", days: 2 });
    const [letterA] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId: letterA });
    const { groupId: group2 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "nl-set",
      deliveryDayId: seed.dayIds[1],
    });
    const [letterB] = await addLetters(sb, { groupId: group2, count: 1 });

    await setActionNextLetterByLetterId(actionId, letterB);

    const { data } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(data?.next_letter_id).toBe(letterB);
  });

  it("rejects a target that is not on a later day", async () => {
    const seed = await seedStoryline(sb, { suffix: "nl-reject", days: 2 });
    const [letterA] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId: letterA });
    // A second group on the SAME day as the source letter.
    const { groupId: group2 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "nl-reject",
      deliveryDayId: seed.dayIds[0],
    });
    const [letterB] = await addLetters(sb, { groupId: group2, count: 1 });

    await setActionNextLetterByLetterId(actionId, letterB);

    const { data } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(data?.next_letter_id).toBeNull();
  });

  it("nulls next_letter_id when the target letter is deleted", async () => {
    const seed = await seedStoryline(sb, { suffix: "nl-del", days: 2 });
    const [letterA] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId: letterA });
    const { groupId: group2 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "nl-del",
      deliveryDayId: seed.dayIds[1],
    });
    const [letterB] = await addLetters(sb, { groupId: group2, count: 1 });
    await setActionNextLetterByLetterId(actionId, letterB);

    await deleteInspectionLetter(group2, letterB);

    const { data } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(data?.next_letter_id).toBeNull();
  });
});

describe("moveReportSegmentToDay", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("stores a positive offset when target is past the default report day", async () => {
    // With no letters, default report day = group_day + 1. Group is on
    // dayIds[0], default = dayIds[1], so dayIds[2] is +1 past default.
    const seed = await seedStoryline(sb, { suffix: "rs-move", days: 3 });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });
    const targetDay = seed.dayIds[2];

    await moveReportSegmentToDay(segId, targetDay);

    const { data } = await sb
      .from("report_segments")
      .select("delivery_day_override_id, delivery_day_offset")
      .eq("id", segId)
      .single();

    expect(data?.delivery_day_offset).toBe(1);
    expect(data?.delivery_day_override_id).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("clears both columns when target equals the default report day", async () => {
    const seed = await seedStoryline(sb, { suffix: "rs-default", days: 2 });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
      deliveryDayOverrideId: seed.dayIds[1],
    });
    // dayIds[1] IS the default (group + 1) — moving to it removes the override.
    await moveReportSegmentToDay(segId, seed.dayIds[1]);

    const { data } = await sb
      .from("report_segments")
      .select("delivery_day_override_id, delivery_day_offset")
      .eq("id", segId)
      .single();

    expect(data?.delivery_day_override_id).toBeNull();
    expect(data?.delivery_day_offset).toBeNull();
  });

  it("falls back to absolute pin when target is earlier than the default", async () => {
    // dayIds[0] is the group day; default = dayIds[1] (group + 1). Moving to
    // dayIds[0] is sub-default, so the action stores an absolute pin instead
    // of an offset (offset would be -1, which is forbidden for reports).
    const seed = await seedStoryline(sb, { suffix: "rs-subdefault", days: 2 });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await moveReportSegmentToDay(segId, seed.dayIds[0]);

    const { data } = await sb
      .from("report_segments")
      .select("delivery_day_override_id, delivery_day_offset")
      .eq("id", segId)
      .single();

    expect(data?.delivery_day_override_id).toBe(seed.dayIds[0]);
    expect(data?.delivery_day_offset).toBeNull();
  });

  it("clears both columns when called with null", async () => {
    const seed = await seedStoryline(sb, { suffix: "rs-clear", days: 2 });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
      deliveryDayOverrideId: seed.dayIds[0],
    });

    await moveReportSegmentToDay(segId, null);

    const { data } = await sb
      .from("report_segments")
      .select("delivery_day_override_id, delivery_day_offset")
      .eq("id", segId)
      .single();

    expect(data?.delivery_day_override_id).toBeNull();
    expect(data?.delivery_day_offset).toBeNull();
  });

  it("should leave updated_by null when no auth user is present", async () => {
    // The mocked createSupabaseServerClient returns a service-role client
    // with no session — supabase.auth.getUser() resolves { user: null }, so
    // the action's `userData.user?.email ?? null` falls through to null.
    // A separate test would be needed to pin the populated path; that
    // requires injecting a real session, which is outside the integration
    // harness today.
    const seed = await seedStoryline(sb, { suffix: "rs-updated-by", days: 1 });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await moveReportSegmentToDay(segId, seed.dayIds[0]);

    const { data } = await sb
      .from("report_segments")
      .select("updated_by")
      .eq("id", segId)
      .single();

    expect(data?.updated_by).toBeNull();
  });
});
