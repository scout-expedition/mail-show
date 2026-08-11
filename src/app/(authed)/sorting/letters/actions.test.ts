import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDay,
  addSortingLetter,
  cleanupTestData,
  makeTestClient,
} from "../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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
  createSortingLetter,
  deleteSortingLetter,
  patchSortingLetter,
  updateAllSortingLetters,
  updateSortingLetter,
} from "./actions";

/**
 * Build a FormData from a flat record. Array values are appended as repeated
 * keys (matches the `formData.getAll(...)` reads in updateAllSortingLetters).
 */
function makeFormData(
  entries: Record<string, string | string[]>
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.append(key, value);
    }
  }
  return fd;
}

describe("createSortingLetter", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(redirect).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should insert a full/full sorting letter on the given day and revalidate + redirect", async () => {
    const dayId = await addDay(sb, { suffix: "create-day", number: 9301 });

    await createSortingLetter(makeFormData({ day_id: dayId, sort_id: "5" }));

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id, sort_id, recipient_type, sender_type, stamp_valid")
      .eq("day_id", dayId);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      day_id: dayId,
      sort_id: 5,
      recipient_type: "full",
      sender_type: "full",
      stamp_valid: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("should redirect to the detail route of the freshly created letter", async () => {
    const dayId = await addDay(sb, { suffix: "create-redirect", number: 9302 });

    await createSortingLetter(makeFormData({ day_id: dayId }));

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("day_id", dayId)
      .single();

    expect(redirect).toHaveBeenCalledWith(`/sorting/letters/${data?.id}`);
  });

  it("should allocate the next free sort_id when none is supplied", async () => {
    const dayId = await addDay(sb, { suffix: "create-nextslot", number: 9303 });
    // Existing letters occupy slots 0 and 3 — highest is 3, so next is 4.
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 3 });

    await createSortingLetter(makeFormData({ day_id: dayId }));

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 3, 4]);
  });

  it("should allocate sort_id 0 on an empty day", async () => {
    const dayId = await addDay(sb, { suffix: "create-empty", number: 9304 });

    await createSortingLetter(makeFormData({ day_id: dayId }));

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .single();

    expect(data?.sort_id).toBe(0);
  });

  it("should reject a duplicate (day_id, sort_id) pair", async () => {
    const dayId = await addDay(sb, { suffix: "create-dupe", number: 9305 });
    await addSortingLetter(sb, { dayId, sortId: 7 });

    await expect(
      createSortingLetter(makeFormData({ day_id: dayId, sort_id: "7" }))
    ).rejects.toThrow();
  });
});

describe("updateSortingLetter", () => {
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

  it("should persist edited address fields and revalidate the list and detail routes", async () => {
    const dayId = await addDay(sb, { suffix: "update-edit", number: 9311 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 1 });

    await updateSortingLetter(
      makeFormData({
        id: letterId,
        day_id: dayId,
        sort_id: "12",
        storage_location: "Shelf B",
        stamp_valid: "on",
        recipient_type: "lookup_2",
        recipient_name: "Mara Voss",
        recipient_citizen_number: "SL000123",
        sender_type: "lookup_1",
        sender_name: "Otto Lind",
        notes: "flagged for review",
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select(
        "sort_id, storage_location, stamp_valid, recipient_type, recipient_name, recipient_citizen_number, sender_type, sender_name, notes"
      )
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      sort_id: 12,
      storage_location: "Shelf B",
      stamp_valid: true,
      recipient_type: "lookup_2",
      recipient_name: "Mara Voss",
      recipient_citizen_number: "SL000123",
      sender_type: "lookup_1",
      sender_name: "Otto Lind",
      notes: "flagged for review",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/sorting/letters/${letterId}`
    );
  });

  it("should coerce blank text fields to null", async () => {
    const dayId = await addDay(sb, { suffix: "update-blank", number: 9312 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 2 });

    await updateSortingLetter(
      makeFormData({
        id: letterId,
        day_id: dayId,
        sort_id: "2",
        storage_location: "   ",
        recipient_name: "",
        sender_name: "",
        notes: "",
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("storage_location, recipient_name, sender_name, notes")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      storage_location: null,
      recipient_name: null,
      sender_name: null,
      notes: null,
    });
  });

  it("should default stamp_valid to false when the checkbox is absent", async () => {
    const dayId = await addDay(sb, { suffix: "update-cf", number: 9313 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 3 });
    // Seed it with a fake stamp so the update has something to flip.
    await sb
      .from("sorting_letters")
      .update({ stamp_valid: true })
      .eq("id", letterId);

    await updateSortingLetter(
      makeFormData({ id: letterId, day_id: dayId, sort_id: "3" })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("stamp_valid")
      .eq("id", letterId)
      .single();

    expect(data?.stamp_valid).toBe(false);
  });

  it("should no-op and not revalidate when the id is missing", async () => {
    await updateSortingLetter(makeFormData({ day_id: "irrelevant" }));

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw on a malformed letter id", async () => {
    const dayId = await addDay(sb, { suffix: "update-badid", number: 9314 });

    await expect(
      updateSortingLetter(
        makeFormData({ id: "not-a-uuid", day_id: dayId, sort_id: "1" })
      )
    ).rejects.toThrow();
  });
});

describe("updateAllSortingLetters", () => {
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

  it("should batch-update every row by parallel-array index and revalidate once", async () => {
    const dayId = await addDay(sb, { suffix: "batch-edit", number: 9321 });
    const letterA = await addSortingLetter(sb, { dayId, sortId: 0 });
    const letterB = await addSortingLetter(sb, { dayId, sortId: 1 });

    await updateAllSortingLetters(
      makeFormData({
        ids: [letterA, letterB],
        day_ids: [dayId, dayId],
        recipient_names: ["Alpha Recip", "Beta Recip"],
        sender_names: ["Alpha Send", "Beta Send"],
        storage_locations: ["Bin 1", "Bin 2"],
        stamp_valids: ["false", "true"],
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("id, recipient_name, sender_name, storage_location, stamp_valid")
      .in("id", [letterA, letterB]);

    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r]));
    expect(byId[letterA]).toMatchObject({
      recipient_name: "Alpha Recip",
      sender_name: "Alpha Send",
      storage_location: "Bin 1",
      stamp_valid: false,
    });
    expect(byId[letterB]).toMatchObject({
      recipient_name: "Beta Recip",
      sender_name: "Beta Send",
      storage_location: "Bin 2",
      stamp_valid: true,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
  });

  it("should coerce blank batch text fields to null", async () => {
    const dayId = await addDay(sb, { suffix: "batch-blank", number: 9322 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });
    await sb
      .from("sorting_letters")
      .update({ recipient_name: "stale", storage_location: "stale" })
      .eq("id", letterId);

    await updateAllSortingLetters(
      makeFormData({
        ids: [letterId],
        day_ids: [dayId],
        recipient_names: ["  "],
        sender_names: [""],
        storage_locations: [""],
        stamp_valids: ["false"],
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_name, sender_name, storage_location")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      recipient_name: null,
      sender_name: null,
      storage_location: null,
    });
  });

  it("should not move a letter when its day_id slot is blank", async () => {
    const dayId = await addDay(sb, { suffix: "batch-keepday", number: 9323 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await updateAllSortingLetters(
      makeFormData({
        ids: [letterId],
        day_ids: [""],
        recipient_names: ["Kept"],
        sender_names: [""],
        storage_locations: [""],
        stamp_valids: ["false"],
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id, recipient_name")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({ day_id: dayId, recipient_name: "Kept" });
  });

  it("should skip blank ids without throwing", async () => {
    const dayId = await addDay(sb, { suffix: "batch-skip", number: 9324 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await updateAllSortingLetters(
      makeFormData({
        ids: ["", letterId],
        day_ids: [dayId, dayId],
        recipient_names: ["ignored", "Real"],
        sender_names: ["", ""],
        storage_locations: ["", ""],
        stamp_valids: ["false", "false"],
      })
    );

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_name")
      .eq("id", letterId)
      .single();

    expect(data?.recipient_name).toBe("Real");
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
  });
});

describe("deleteSortingLetter", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(redirect).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete the row and redirect to the list", async () => {
    const dayId = await addDay(sb, { suffix: "delete-row", number: 9331 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter(makeFormData({ id: letterId }));

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(0);
    expect(redirect).toHaveBeenCalledWith("/sorting/letters");
  });

  it("should no-op when the id is missing", async () => {
    const dayId = await addDay(sb, { suffix: "delete-noid", number: 9332 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter(makeFormData({}));

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("should throw on a malformed letter id", async () => {
    await expect(
      deleteSortingLetter(makeFormData({ id: "not-a-uuid" }))
    ).rejects.toThrow();
  });
});

describe("patchSortingLetter", () => {
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

  it("should apply a narrow field patch without calling revalidatePath", async () => {
    const dayId = await addDay(sb, { suffix: "patch-field", number: 9341 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await patchSortingLetter(letterId, {
      recipient_name: "Patched Name",
      stamp_valid: true,
    });

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_name, stamp_valid, sender_name")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      recipient_name: "Patched Name",
      stamp_valid: true,
      sender_name: null,
    });
    // Instant-save contract: realtime fans the change out, no revalidation.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should patch the address type only, leaving other columns untouched", async () => {
    const dayId = await addDay(sb, { suffix: "patch-type", number: 9342 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });
    await sb
      .from("sorting_letters")
      .update({ recipient_name: "Keep Me" })
      .eq("id", letterId);

    await patchSortingLetter(letterId, { recipient_type: "lookup_3" });

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_type, recipient_name")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      recipient_type: "lookup_3",
      recipient_name: "Keep Me",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw when the patch violates the sort_id check constraint", async () => {
    const dayId = await addDay(sb, { suffix: "patch-badsort", number: 9343 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    // sort_id is constrained to 0..99 — 200 trips the CHECK.
    await expect(
      patchSortingLetter(letterId, { sort_id: 200 })
    ).rejects.toThrow();

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
