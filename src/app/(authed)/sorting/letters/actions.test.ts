import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addDay,
  addSortingLetter,
  cleanupTestData,
  makeTestClient,
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
  createSortingLetter,
  deleteSortingLetter,
  lowestFreeSortId,
  patchSortingLetter,
} from "./actions";

describe("createSortingLetter", () => {
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

  it("should insert a full/full sorting letter on the given day and revalidate", async () => {
    const dayId = await addDay(sb, { suffix: "create-day", number: 9301 });

    const { id } = await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("id, day_id, sort_id, recipient_type, sender_type, stamp_valid")
      .eq("day_id", dayId);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id,
      day_id: dayId,
      sort_id: 0,
      recipient_type: "full",
      sender_type: "full",
      // A new letter carries a valid stamp until an author says otherwise.
      stamp_valid: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should fill the lowest free sort_id rather than appending", async () => {
    const dayId = await addDay(sb, { suffix: "create-nextslot", number: 9303 });
    // Slots 0 and 2 are taken; the gap at 1 is what "lowest open ID" means.
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 2 });

    await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 1, 2]);
  });

  it("should allocate sort_id 0 on an empty day", async () => {
    const dayId = await addDay(sb, { suffix: "create-empty", number: 9304 });

    await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .single();

    expect(data?.sort_id).toBe(0);
  });

  it("should fall back to the first day when none is given", async () => {
    const dayId = await addDay(sb, { suffix: "create-firstday", number: 1 });

    const { id } = await createSortingLetter();

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id")
      .eq("id", id)
      .single();

    expect(data?.day_id).toBe(dayId);
  });
});

describe("lowestFreeSortId", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should return 0 for a day with no letters", async () => {
    const dayId = await addDay(sb, { suffix: "free-empty", number: 9306 });
    expect(await lowestFreeSortId(dayId)).toBe(0);
  });

  it("should return the first gap, not the next-highest", async () => {
    const dayId = await addDay(sb, { suffix: "free-gap", number: 9307 });
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 1 });
    await addSortingLetter(sb, { dayId, sortId: 3 });

    expect(await lowestFreeSortId(dayId)).toBe(2);
  });
});

describe("deleteSortingLetter", () => {
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

  it("should delete the row and revalidate the surfaces that show it", async () => {
    const dayId = await addDay(sb, { suffix: "delete-row", number: 9331 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter(letterId);

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should no-op when the id is missing", async () => {
    const dayId = await addDay(sb, { suffix: "delete-noid", number: 9332 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter("");

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw on a malformed letter id", async () => {
    await expect(deleteSortingLetter("not-a-uuid")).rejects.toThrow();
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
