import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { revalidatePath } from "next/cache";
import {
  addDay,
  addGenericReportBlock,
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
  createGenericReportBlock,
  deleteGenericReportBlock,
  patchDayReportField,
  patchGenericReportBlock,
  renumberGenericReportBlocks,
  reorderDayReportBlocks,
} from "./actions";

const ROUTE = "/top-of-day/morning-reports";

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

describe("createGenericReportBlock", () => {
  it("should insert the first generic block with variant 'i' and revalidate the route", async () => {
    const seed = await seedStoryline(sb, { suffix: "create-first", days: 1 });

    const { id } = await createGenericReportBlock({ day_id: seed.dayIds[0] });

    const { data } = await sb
      .from("day_report_blocks")
      .select("kind, variant, sort_order")
      .eq("id", id)
      .single();
    expect(data).toEqual({ kind: "generic", variant: "i", sort_order: 0 });
    expect(revalidatePath).toHaveBeenCalledWith(ROUTE);
  });

  it("should pick the next free roman variant when prior variants are taken", async () => {
    const seed = await seedStoryline(sb, { suffix: "create-next", days: 1 });
    const dayId = seed.dayIds[0];
    await addGenericReportBlock(sb, { dayId, variant: "i", sortOrder: 0 });
    await addGenericReportBlock(sb, { dayId, variant: "ii", sortOrder: 1 });

    const { id } = await createGenericReportBlock({ day_id: dayId });

    const { data } = await sb
      .from("day_report_blocks")
      .select("variant, sort_order")
      .eq("id", id)
      .single();
    // First free numeral is 'iii'; sort_order appends past the max (1).
    expect(data).toEqual({ variant: "iii", sort_order: 2 });
  });

  it("should fill the lowest free roman variant when there is a gap", async () => {
    const seed = await seedStoryline(sb, { suffix: "create-gap", days: 1 });
    const dayId = seed.dayIds[0];
    await addGenericReportBlock(sb, { dayId, variant: "i", sortOrder: 0 });
    await addGenericReportBlock(sb, { dayId, variant: "iii", sortOrder: 5 });

    const { id } = await createGenericReportBlock({ day_id: dayId });

    const { data } = await sb
      .from("day_report_blocks")
      .select("variant, sort_order")
      .eq("id", id)
      .single();
    // 'ii' is the lowest free numeral; sort_order is maxSort+1 = 6.
    expect(data).toEqual({ variant: "ii", sort_order: 6 });
  });
});

describe("patchGenericReportBlock", () => {
  it("should apply the patch without calling revalidatePath", async () => {
    const seed = await seedStoryline(sb, { suffix: "patch-block", days: 1 });
    const blockId = await addGenericReportBlock(sb, {
      dayId: seed.dayIds[0],
      variant: "i",
      content: "old content",
      summary: "old summary",
    });

    await patchGenericReportBlock(blockId, {
      content: "new content",
      summary: "new summary",
    });

    const { data } = await sb
      .from("day_report_blocks")
      .select("content, summary")
      .eq("id", blockId)
      .single();
    expect(data).toEqual({ content: "new content", summary: "new summary" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should leave a field untouched when its key is omitted from the patch", async () => {
    const seed = await seedStoryline(sb, { suffix: "patch-partial", days: 1 });
    const blockId = await addGenericReportBlock(sb, {
      dayId: seed.dayIds[0],
      variant: "i",
      content: "keep me",
      summary: "original",
    });

    await patchGenericReportBlock(blockId, { summary: "changed" });

    const { data } = await sb
      .from("day_report_blocks")
      .select("content, summary")
      .eq("id", blockId)
      .single();
    expect(data).toEqual({ content: "keep me", summary: "changed" });
  });

  it("should refuse to touch a letter_group anchor row (kind filter)", async () => {
    // Anchors are kind='letter_group'; the action filters on kind='generic'
    // so the update silently matches zero rows. Insert one directly so we can
    // confirm the post-condition.
    const seed = await seedStoryline(sb, { suffix: "patch-anchor", days: 1 });
    const { data: anchor, error } = await sb
      .from("day_report_blocks")
      .insert({
        day_id: seed.dayIds[0],
        kind: "letter_group",
        letter_group_id: seed.groupId,
        sort_order: 0,
      })
      .select("id")
      .single();
    if (error || !anchor) throw new Error(`seed anchor: ${error?.message}`);

    await patchGenericReportBlock(anchor.id as string, { content: "nope" });

    const { data } = await sb
      .from("day_report_blocks")
      .select("content, summary, variant, kind")
      .eq("id", anchor.id as string)
      .single();
    // The anchor's CHECK constraint forbids non-null content/summary/variant
    // for letter_group rows; the kind filter must keep the action from
    // violating it.
    expect(data).toEqual({
      content: null,
      summary: null,
      variant: null,
      kind: "letter_group",
    });
  });
});

describe("deleteGenericReportBlock", () => {
  it("should delete the row and revalidate the route", async () => {
    const seed = await seedStoryline(sb, { suffix: "delete-block", days: 1 });
    const blockId = await addGenericReportBlock(sb, {
      dayId: seed.dayIds[0],
      variant: "i",
    });

    const fd = new FormData();
    fd.set("id", blockId);
    await deleteGenericReportBlock(fd);

    const { data } = await sb
      .from("day_report_blocks")
      .select("id")
      .eq("id", blockId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(ROUTE);
  });

  it("should throw when the form has no id", async () => {
    const fd = new FormData();
    await expect(deleteGenericReportBlock(fd)).rejects.toThrow(
      "Missing block id"
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should not delete a letter_group anchor row (kind filter)", async () => {
    // The action filters on kind='generic' to keep anchors safe even if a
    // caller passes an anchor's id.
    const seed = await seedStoryline(sb, { suffix: "delete-anchor", days: 1 });
    const { data: anchor, error } = await sb
      .from("day_report_blocks")
      .insert({
        day_id: seed.dayIds[0],
        kind: "letter_group",
        letter_group_id: seed.groupId,
        sort_order: 0,
      })
      .select("id")
      .single();
    if (error || !anchor) throw new Error(`seed anchor: ${error?.message}`);

    const fd = new FormData();
    fd.set("id", anchor.id as string);
    await deleteGenericReportBlock(fd);

    const { data } = await sb
      .from("day_report_blocks")
      .select("id, kind")
      .eq("id", anchor.id as string)
      .maybeSingle();
    expect(data).toEqual({ id: anchor.id, kind: "letter_group" });
  });
});

describe("reorderDayReportBlocks", () => {
  it("should update sort_order on existing rows and revalidate the route", async () => {
    const seed = await seedStoryline(sb, { suffix: "reorder", days: 1 });
    const dayId = seed.dayIds[0];
    const idA = await addGenericReportBlock(sb, {
      dayId,
      variant: "i",
      sortOrder: 0,
    });
    const idB = await addGenericReportBlock(sb, {
      dayId,
      variant: "ii",
      sortOrder: 1,
    });

    await reorderDayReportBlocks({
      day_id: dayId,
      blocks: [
        { id: idA, kind: "generic", letter_group_id: null, sort_order: 5 },
        { id: idB, kind: "generic", letter_group_id: null, sort_order: 2 },
      ],
    });

    const { data } = await sb
      .from("day_report_blocks")
      .select("id, sort_order")
      .in("id", [idA, idB])
      .order("sort_order");
    expect(data).toEqual([
      { id: idB, sort_order: 2 },
      { id: idA, sort_order: 5 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(ROUTE);
  });

  it("should INSERT a fresh letter_group anchor for an entry without an id", async () => {
    const seed = await seedStoryline(sb, { suffix: "reorder-ins", days: 1 });
    const dayId = seed.dayIds[0];

    await reorderDayReportBlocks({
      day_id: dayId,
      blocks: [
        {
          id: null,
          kind: "letter_group",
          letter_group_id: seed.groupId,
          sort_order: 3,
        },
      ],
    });

    const { data } = await sb
      .from("day_report_blocks")
      .select("kind, letter_group_id, sort_order, variant, content, summary")
      .eq("day_id", dayId);
    expect(data).toEqual([
      {
        kind: "letter_group",
        letter_group_id: seed.groupId,
        sort_order: 3,
        variant: null,
        content: null,
        summary: null,
      },
    ]);
  });

  it("should ignore id-less entries that are not letter_group anchors", async () => {
    // The insert filter requires kind='letter_group' AND a letter_group_id.
    // An id-less 'generic' entry, or a letter_group entry without a group id,
    // both fall through silently.
    const seed = await seedStoryline(sb, { suffix: "reorder-skip", days: 1 });
    const dayId = seed.dayIds[0];

    await reorderDayReportBlocks({
      day_id: dayId,
      blocks: [
        { id: null, kind: "generic", letter_group_id: null, sort_order: 0 },
        { id: null, kind: "letter_group", letter_group_id: null, sort_order: 1 },
      ],
    });

    const { count } = await sb
      .from("day_report_blocks")
      .select("id", { count: "exact", head: true })
      .eq("day_id", dayId);
    expect(count).toBe(0);
    // Revalidate still fires — the action treats this as a successful reorder.
    expect(revalidatePath).toHaveBeenCalledWith(ROUTE);
  });
});

describe("renumberGenericReportBlocks", () => {
  it("should reassign variants in sort_order with the 2-pass tmp rename and revalidate", async () => {
    // Three blocks currently numbered i, ii, iii but sort_order has them
    // reversed. After renumber, the iii row (sort 0) becomes i, ii row
    // (sort 1) stays ii, i row (sort 2) becomes iii.
    const seed = await seedStoryline(sb, {
      suffix: "renumber-reverse",
      days: 1,
    });
    const dayId = seed.dayIds[0];
    const idFirst = await addGenericReportBlock(sb, {
      dayId,
      variant: "iii",
      sortOrder: 0,
    });
    const idMid = await addGenericReportBlock(sb, {
      dayId,
      variant: "ii",
      sortOrder: 1,
    });
    const idLast = await addGenericReportBlock(sb, {
      dayId,
      variant: "i",
      sortOrder: 2,
    });

    await renumberGenericReportBlocks(dayId);

    const { data } = await sb
      .from("day_report_blocks")
      .select("id, variant, sort_order")
      .eq("day_id", dayId)
      .order("sort_order");
    expect(data).toEqual([
      { id: idFirst, variant: "i", sort_order: 0 },
      { id: idMid, variant: "ii", sort_order: 1 },
      { id: idLast, variant: "iii", sort_order: 2 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(ROUTE);
  });

  it("should collapse a gappy variant sequence (i, iii) back to (i, ii)", async () => {
    // This is the case the 2-pass rename most clearly protects: assigning
    // 'ii' to the second row would collide with no existing row, but if the
    // gap were the other direction (rename i→ii first) the partial unique
    // index would reject the single-shot update. Two passes parks both on
    // tmp variants first.
    const seed = await seedStoryline(sb, { suffix: "renumber-gap", days: 1 });
    const dayId = seed.dayIds[0];
    const idA = await addGenericReportBlock(sb, {
      dayId,
      variant: "i",
      sortOrder: 0,
    });
    const idC = await addGenericReportBlock(sb, {
      dayId,
      variant: "iii",
      sortOrder: 1,
    });

    await renumberGenericReportBlocks(dayId);

    const { data } = await sb
      .from("day_report_blocks")
      .select("id, variant")
      .eq("day_id", dayId)
      .order("sort_order");
    expect(data).toEqual([
      { id: idA, variant: "i" },
      { id: idC, variant: "ii" },
    ]);
  });

  it("should skip letter_group anchor rows", async () => {
    // Renumber filters to kind='generic', so an anchor on the same day must
    // not get a roman variant assigned to it (which would also blow up the
    // CHECK constraint).
    const seed = await seedStoryline(sb, {
      suffix: "renumber-anchor",
      days: 1,
    });
    const dayId = seed.dayIds[0];
    const idA = await addGenericReportBlock(sb, {
      dayId,
      variant: "i",
      sortOrder: 0,
    });
    const { data: anchor, error } = await sb
      .from("day_report_blocks")
      .insert({
        day_id: dayId,
        kind: "letter_group",
        letter_group_id: seed.groupId,
        sort_order: 1,
      })
      .select("id")
      .single();
    if (error || !anchor) throw new Error(`seed anchor: ${error?.message}`);

    await renumberGenericReportBlocks(dayId);

    const { data: generic } = await sb
      .from("day_report_blocks")
      .select("id, variant")
      .eq("id", idA)
      .single();
    expect(generic).toEqual({ id: idA, variant: "i" });

    const { data: untouched } = await sb
      .from("day_report_blocks")
      .select("variant, kind")
      .eq("id", anchor.id as string)
      .single();
    expect(untouched).toEqual({ variant: null, kind: "letter_group" });
  });
});

describe("patchDayReportField", () => {
  it("should patch days.base_report without calling revalidatePath", async () => {
    const dayId = await addDay(sb, { suffix: "patch-base", number: 9600 });

    await patchDayReportField(dayId, { base_report: "Intro text" });

    const { data } = await sb
      .from("days")
      .select("base_report, report_sign_off")
      .eq("id", dayId)
      .single();
    expect(data).toEqual({ base_report: "Intro text", report_sign_off: null });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should patch days.report_sign_off when only sign-off is provided", async () => {
    const dayId = await addDay(sb, { suffix: "patch-signoff", number: 9601 });

    await patchDayReportField(dayId, { report_sign_off: "Sincerely," });

    const { data } = await sb
      .from("days")
      .select("base_report, report_sign_off")
      .eq("id", dayId)
      .single();
    expect(data).toEqual({
      base_report: null,
      report_sign_off: "Sincerely,",
    });
  });

  it("should short-circuit and skip the DB write when patch has no known keys", async () => {
    // The action returns early if the assembled update object is empty.
    // We can't easily observe the no-op DB-side, but we can confirm no
    // revalidate fires and no error throws on a known-bad row id.
    await expect(
      patchDayReportField("00000000-0000-0000-0000-000000000000", {})
    ).resolves.toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
