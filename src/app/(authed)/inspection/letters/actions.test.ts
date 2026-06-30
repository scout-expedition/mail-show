import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addAction,
  addGroup,
  addLetter,
  addLetters,
  addPieceGroup,
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
  addPieceToLetter,
  applyInspectionLetterPieces,
  deleteInspectionLetter,
  deletePieceGroup,
  duplicatePieceGroup,
  extractLetterFromPieceGroup,
  mergeLetters,
  moveLetterGroupToDay,
  moveLetterToGroup,
  moveReportSegmentToDay,
  renumberPiecesSequentially,
  setActionNextLetterByLetterId,
  setPieceGroupDelivery,
  sortPiecesById,
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

  it("moves a letter to a sibling group: the moved letter gets the next variant in the target, the source keeps its gap", async () => {
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

    // Moved letter: next-after-highest variant in the (empty) target → "a".
    expect(movedA).toEqual({ letter_group_id: targetGroup, variant: "a" });
    // Source group is NOT renumbered — letter b keeps its variant (a gap is
    // left where a used to be). Numbering changes only via explicit actions.
    expect(remainingB).toEqual({ letter_group_id: sourceGroup, variant: "b" });

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

// ---------------------------------------------------------------------------
// Piece-group actions (PR #131). A "piece group" is a cluster of inspection
// letters sharing one (letter_group_id, variant) with piece >= 1. These tests
// build clusters with the addPieceGroup / addLetter helpers and assert both
// the DB post-condition and the revalidatePath contract.
// ---------------------------------------------------------------------------

/** Read variant/piece/sort_order for a letter, or null when missing. */
async function readLetter(
  sb: ReturnType<typeof makeTestClient>,
  id: string
): Promise<{ variant: string | null; piece: number | null; sort_order: number } | null> {
  const { data } = await sb
    .from("inspection_letters")
    .select("variant, piece, sort_order")
    .eq("id", id)
    .maybeSingle();
  return (data as never) ?? null;
}

describe("mergeLetters", () => {
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

  it("merges two standalone letters into a piece group under the target's variant", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-ss", days: 1 });
    // Two standalone letters in one group: source variant 'a', target 'b'.
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a", sortOrder: 0 });
    const target = await addLetter(sb, { groupId: seed.groupId, variant: "b", sortOrder: 1 });

    await mergeLetters(source, target);

    const t = await readLetter(sb, target);
    const s = await readLetter(sb, source);
    // Both adopt the target variant; target becomes piece 1, source piece 2.
    expect(t).toMatchObject({ variant: "b", piece: 1 });
    expect(s).toMatchObject({ variant: "b", piece: 2 });

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("appends a standalone source after the last member of a grouped target", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-sg", days: 1 });
    // Target is a 2-piece group under 'b'; source is standalone 'a'.
    const [tgt1, tgt2] = await addPieceGroup(sb, {
      groupId: seed.groupId,
      variant: "b",
      count: 2,
      sortBase: 1,
    });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a", sortOrder: 0 });

    await mergeLetters(source, tgt1);

    expect(await readLetter(sb, tgt1)).toMatchObject({ variant: "b", piece: 1 });
    expect(await readLetter(sb, tgt2)).toMatchObject({ variant: "b", piece: 2 });
    // Source appended after the cluster max → piece 3.
    expect(await readLetter(sb, source)).toMatchObject({ variant: "b", piece: 3 });
  });

  it("moves every member of a grouped source into a standalone target", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-gs", days: 1 });
    // Source is a 2-piece group under 'a'; target is standalone 'b'.
    const [src1, src2] = await addPieceGroup(sb, {
      groupId: seed.groupId,
      variant: "a",
      count: 2,
      sortBase: 0,
    });
    const target = await addLetter(sb, { groupId: seed.groupId, variant: "b", sortOrder: 2 });

    await mergeLetters(src1, target);

    // Target promoted to piece 1; source members appended as 2, 3.
    expect(await readLetter(sb, target)).toMatchObject({ variant: "b", piece: 1 });
    expect(await readLetter(sb, src1)).toMatchObject({ variant: "b", piece: 2 });
    expect(await readLetter(sb, src2)).toMatchObject({ variant: "b", piece: 3 });
  });

  it("assigns a fresh variant when the target has no variant yet", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-nov", days: 1 });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a", sortOrder: 0 });
    const target = await addLetter(sb, { groupId: seed.groupId, variant: null, sortOrder: 1 });

    await mergeLetters(source, target);

    // Next-after-highest over {'a', null} is 'b' — both letters land there.
    const t = await readLetter(sb, target);
    const s = await readLetter(sb, source);
    expect(t).toMatchObject({ variant: "b", piece: 1 });
    expect(s).toMatchObject({ variant: "b", piece: 2 });
  });

  it("rewrites an inbound next_letter_id to the new lowest-piece member", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-fk", days: 1 });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a", sortOrder: 0 });
    const target = await addLetter(sb, { groupId: seed.groupId, variant: "b", sortOrder: 1 });
    // An action elsewhere points at the source letter.
    const actionId = await addAction(sb, { letterId: target });
    await sb.from("actions").update({ next_letter_id: source }).eq("id", actionId);

    await mergeLetters(source, target);

    // After merge: target=piece 1 (lowest), source=piece 2. reconcile rewrites
    // the FK from the non-lowest source to the lowest member (target).
    const { data } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(data?.next_letter_id).toBe(target);
  });

  it("rejects merging letters from different letter groups", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-diff", days: 1 });
    const { groupId: group2 } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "merge-diff",
      deliveryDayId: seed.dayIds[0],
    });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a" });
    const target = await addLetter(sb, { groupId: group2, variant: "a" });

    await expect(mergeLetters(source, target)).rejects.toThrow(/different groups/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws when a letter id does not exist", async () => {
    const seed = await seedStoryline(sb, { suffix: "merge-missing", days: 1 });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a" });

    await expect(
      mergeLetters(source, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(/not found/);
  });
});

describe("extractLetterFromPieceGroup", () => {
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

  it("gives the extracted letter a fresh standalone variant and demotes the lone survivor", async () => {
    const seed = await seedStoryline(sb, { suffix: "extract", days: 1 });
    const [p1, p2] = await addPieceGroup(sb, {
      groupId: seed.groupId,
      variant: "a",
      count: 2,
    });

    await extractLetterFromPieceGroup(p2);

    // Extracted letter: fresh variant ('b' = next after 'a'), piece cleared.
    expect(await readLetter(sb, p2)).toMatchObject({ variant: "b", piece: null });
    // The cluster's lone survivor is auto-demoted to standalone (piece null).
    expect(await readLetter(sb, p1)).toMatchObject({ variant: "a", piece: null });

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("keeps remaining members grouped when extracting from a 3-piece cluster", async () => {
    const seed = await seedStoryline(sb, { suffix: "extract3", days: 1 });
    const [p1, p2, p3] = await addPieceGroup(sb, {
      groupId: seed.groupId,
      variant: "a",
      count: 3,
    });

    await extractLetterFromPieceGroup(p2);

    expect(await readLetter(sb, p2)).toMatchObject({ variant: "b", piece: null });
    // Two survivors keep their pieces (>=2 members → no demotion).
    expect(await readLetter(sb, p1)).toMatchObject({ variant: "a", piece: 1 });
    expect(await readLetter(sb, p3)).toMatchObject({ variant: "a", piece: 3 });
  });

  it("throws when the letter does not exist", async () => {
    await expect(
      extractLetterFromPieceGroup("00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(/not found/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setPieceGroupDelivery", () => {
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

  it("writes an absolute override and clears the offset for every cluster member", async () => {
    const seed = await seedStoryline(sb, { suffix: "pgd-abs", days: 2 });
    const ids = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });
    // Pre-seed an offset so we can prove it gets cleared.
    await sb.from("inspection_letters").update({ delivery_day_offset: 5 }).in("id", ids);

    await setPieceGroupDelivery(seed.groupId, "a", {
      mode: "absolute",
      dayId: seed.dayIds[1],
    });

    const { data } = await sb
      .from("inspection_letters")
      .select("delivery_day_override_id, delivery_day_offset")
      .in("id", ids);
    for (const row of data ?? []) {
      expect(row.delivery_day_override_id).toBe(seed.dayIds[1]);
      expect(row.delivery_day_offset).toBeNull();
    }

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("writes an offset and clears the absolute override", async () => {
    const seed = await seedStoryline(sb, { suffix: "pgd-off", days: 2 });
    const ids = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });
    await sb
      .from("inspection_letters")
      .update({ delivery_day_override_id: seed.dayIds[1] })
      .in("id", ids);

    await setPieceGroupDelivery(seed.groupId, "a", { mode: "offset", offset: 3 });

    const { data } = await sb
      .from("inspection_letters")
      .select("delivery_day_override_id, delivery_day_offset")
      .in("id", ids);
    for (const row of data ?? []) {
      expect(row.delivery_day_override_id).toBeNull();
      expect(row.delivery_day_offset).toBe(3);
    }
  });

  it("clears both columns when offset is null", async () => {
    const seed = await seedStoryline(sb, { suffix: "pgd-null", days: 2 });
    const ids = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });
    await sb
      .from("inspection_letters")
      .update({ delivery_day_override_id: seed.dayIds[1], delivery_day_offset: null })
      .in("id", ids);

    await setPieceGroupDelivery(seed.groupId, "a", { mode: "offset", offset: null });

    const { data } = await sb
      .from("inspection_letters")
      .select("delivery_day_override_id, delivery_day_offset")
      .in("id", ids);
    for (const row of data ?? []) {
      expect(row.delivery_day_override_id).toBeNull();
      expect(row.delivery_day_offset).toBeNull();
    }
  });

  it("does not touch standalone letters (piece null) sharing the variant", async () => {
    const seed = await seedStoryline(sb, { suffix: "pgd-skip", days: 2 });
    // A standalone letter under variant 'a' (piece null) must be untouched.
    const standalone = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: null });

    await setPieceGroupDelivery(seed.groupId, "a", {
      mode: "absolute",
      dayId: seed.dayIds[1],
    });

    expect(
      (await readLetter(sb, standalone)) &&
        (
          await sb
            .from("inspection_letters")
            .select("delivery_day_override_id")
            .eq("id", standalone)
            .single()
        ).data?.delivery_day_override_id
    ).toBeNull();
  });
});

describe("renumberPiecesSequentially", () => {
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

  it("renumbers pieces to 1..n in sort_order order", async () => {
    const seed = await seedStoryline(sb, { suffix: "renum", days: 1 });
    // Pieces 2, 5, 9 with ascending sort_order → should compact to 1, 2, 3.
    const a = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: 2, sortOrder: 0 });
    const b = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: 5, sortOrder: 1 });
    const c = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: 9, sortOrder: 2 });

    await renumberPiecesSequentially(seed.groupId, "a");

    expect((await readLetter(sb, a))?.piece).toBe(1);
    expect((await readLetter(sb, b))?.piece).toBe(2);
    expect((await readLetter(sb, c))?.piece).toBe(3);

    // Revalidation fires via applyInspectionLetterVariants.
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("no-ops when the cluster is empty", async () => {
    const seed = await seedStoryline(sb, { suffix: "renum-empty", days: 1 });

    await renumberPiecesSequentially(seed.groupId, "z");

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("sortPiecesById", () => {
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

  it("reassigns existing sort_order slots in piece-ascending order", async () => {
    const seed = await seedStoryline(sb, { suffix: "sortpc", days: 1 });
    // piece 1 sits at sort_order 20, piece 2 at sort_order 10 — out of order.
    const p1 = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: 1, sortOrder: 20 });
    const p2 = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: 2, sortOrder: 10 });

    await sortPiecesById(seed.groupId, "a");

    // The two existing slots {10, 20} are reassigned so piece 1 → 10, piece 2 → 20.
    expect((await readLetter(sb, p1))?.sort_order).toBe(10);
    expect((await readLetter(sb, p2))?.sort_order).toBe(20);

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });
});

describe("duplicatePieceGroup", () => {
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

  it("duplicates the cluster under the next variant with pieces 1..n appended at the end", async () => {
    const seed = await seedStoryline(sb, { suffix: "dup", days: 1 });
    const originals = await addPieceGroup(sb, {
      groupId: seed.groupId,
      variant: "a",
      count: 2,
      sortBase: 0,
    });

    await duplicatePieceGroup(seed.groupId, "a");

    // Originals untouched.
    expect(await readLetter(sb, originals[0])).toMatchObject({ variant: "a", piece: 1 });
    expect(await readLetter(sb, originals[1])).toMatchObject({ variant: "a", piece: 2 });

    // New cluster: variant 'b', pieces 1..2, sort_order after the originals.
    const { data: copies } = await sb
      .from("inspection_letters")
      .select("piece, sort_order")
      .eq("letter_group_id", seed.groupId)
      .eq("variant", "b")
      .order("piece");
    expect(copies?.map((c) => c.piece)).toEqual([1, 2]);
    expect(copies?.every((c) => Number(c.sort_order) > 1)).toBe(true);

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("no-ops when the source cluster has no members", async () => {
    const seed = await seedStoryline(sb, { suffix: "dup-empty", days: 1 });

    await duplicatePieceGroup(seed.groupId, "z");

    const { count } = await sb
      .from("inspection_letters")
      .select("id", { count: "exact", head: true })
      .eq("letter_group_id", seed.groupId);
    expect(count).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deletePieceGroup", () => {
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

  it("deletes every cluster member and nulls inbound next_letter_id references", async () => {
    const seed = await seedStoryline(sb, { suffix: "delpg", days: 1 });
    const [p1, p2] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });
    // A standalone letter under a different variant survives; an action points
    // at a member of the cluster being deleted.
    const survivor = await addLetter(sb, { groupId: seed.groupId, variant: "b", piece: null });
    const actionId = await addAction(sb, { letterId: survivor });
    await sb.from("actions").update({ next_letter_id: p1 }).eq("id", actionId);

    await deletePieceGroup(seed.groupId, "a");

    expect(await readLetter(sb, p1)).toBeNull();
    expect(await readLetter(sb, p2)).toBeNull();
    // FK ON DELETE SET NULL drops the dangling reference.
    const { data } = await sb
      .from("actions")
      .select("next_letter_id")
      .eq("id", actionId)
      .single();
    expect(data?.next_letter_id).toBeNull();

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("leaves standalone letters and other variants intact", async () => {
    const seed = await seedStoryline(sb, { suffix: "delpg-keep", days: 1 });
    await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });
    const keep = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: null, sortOrder: 9 });

    await deletePieceGroup(seed.groupId, "a");

    // Standalone letter (piece null) under the same variant is NOT deleted.
    expect(await readLetter(sb, keep)).not.toBeNull();
  });
});

describe("applyInspectionLetterPieces", () => {
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

  it("applies a collision-free piece reassignment within the cluster", async () => {
    const seed = await seedStoryline(sb, { suffix: "aip", days: 1 });
    const [p1, p2] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });

    // Swap the two pieces.
    await applyInspectionLetterPieces(seed.groupId, "a", [
      { id: p1, newPiece: 2 },
      { id: p2, newPiece: 1 },
    ]);

    expect((await readLetter(sb, p1))?.piece).toBe(2);
    expect((await readLetter(sb, p2))?.piece).toBe(1);

    // Revalidation fires via applyInspectionLetterVariants.
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("no-ops on an empty assignment list", async () => {
    await applyInspectionLetterPieces("00000000-0000-0000-0000-000000000000", "a", []);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-integer or sub-1 target piece", async () => {
    const seed = await seedStoryline(sb, { suffix: "aip-bad", days: 1 });
    const [p1] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 1 });

    await expect(
      applyInspectionLetterPieces(seed.groupId, "a", [{ id: p1, newPiece: 0 }])
    ).rejects.toThrow(/integer >= 1/);
  });

  it("rejects duplicate target pieces", async () => {
    const seed = await seedStoryline(sb, { suffix: "aip-dup", days: 1 });
    const [p1, p2] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });

    await expect(
      applyInspectionLetterPieces(seed.groupId, "a", [
        { id: p1, newPiece: 1 },
        { id: p2, newPiece: 1 },
      ])
    ).rejects.toThrow(/duplicate target piece/);
  });

  it("rejects an id that is not a member of the cluster", async () => {
    const seed = await seedStoryline(sb, { suffix: "aip-foreign", days: 1 });
    const [p1] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 1 });
    // A standalone letter under a different variant is not in the cluster.
    const foreign = await addLetter(sb, { groupId: seed.groupId, variant: "b", piece: null });

    await expect(
      applyInspectionLetterPieces(seed.groupId, "a", [
        { id: p1, newPiece: 1 },
        { id: foreign, newPiece: 2 },
      ])
    ).rejects.toThrow(/does not belong/);
  });
});

describe("addPieceToLetter", () => {
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

  it("promotes a lone standalone letter to piece 1 and adds piece 2", async () => {
    const seed = await seedStoryline(sb, { suffix: "atp-lone", days: 1 });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: null, sortOrder: 0 });

    const { newLetterId } = await addPieceToLetter(seed.groupId, source);

    expect(await readLetter(sb, source)).toMatchObject({ variant: "a", piece: 1 });
    expect(await readLetter(sb, newLetterId)).toMatchObject({ variant: "a", piece: 2 });

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });

  it("appends max(piece)+1 when the source already belongs to a cluster", async () => {
    const seed = await seedStoryline(sb, { suffix: "atp-cluster", days: 1 });
    const [p1] = await addPieceGroup(sb, { groupId: seed.groupId, variant: "a", count: 2 });

    const { newLetterId } = await addPieceToLetter(seed.groupId, p1);

    // Cluster already had pieces 1, 2 → new letter becomes piece 3.
    expect(await readLetter(sb, newLetterId)).toMatchObject({ variant: "a", piece: 3 });
  });

  it("assigns a variant to a variant-less source before adding the piece", async () => {
    const seed = await seedStoryline(sb, { suffix: "atp-novar", days: 1 });
    // A letter with variant 'a' already present forces the new variant to 'b'.
    await addLetter(sb, { groupId: seed.groupId, variant: "a", piece: null, sortOrder: 0 });
    const source = await addLetter(sb, { groupId: seed.groupId, variant: null, piece: null, sortOrder: 1 });

    const { newLetterId } = await addPieceToLetter(seed.groupId, source);

    expect(await readLetter(sb, source)).toMatchObject({ variant: "b", piece: 1 });
    expect(await readLetter(sb, newLetterId)).toMatchObject({ variant: "b", piece: 2 });
  });

  it("throws when the source letter does not exist", async () => {
    const seed = await seedStoryline(sb, { suffix: "atp-missing", days: 1 });

    await expect(
      addPieceToLetter(seed.groupId, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(/not found/);
  });
});
