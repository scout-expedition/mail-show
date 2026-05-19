import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addLetters,
  addPhysicalLetter,
  addSortingLetter,
  cleanupPhysicalLetters,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Imports of the action MUST come after the mocks above.
import {
  createPhysicalLetter,
  deletePhysicalLetter,
  updateAllPhysicalLetters,
  updatePhysicalLetter,
} from "./actions";

const sb = makeTestClient();

beforeAll(async () => {
  await cleanupPhysicalLetters(sb);
  await cleanupTestData(sb);
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

afterEach(async () => {
  await cleanupPhysicalLetters(sb);
  await cleanupTestData(sb);
});

describe("createPhysicalLetter", () => {
  it("should default to a sorting letter when one exists and revalidate /physical", async () => {
    const seed = await seedStoryline(sb, { suffix: "create-sorting", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    // Also seed an inspection letter to prove sorting takes precedence.
    await addLetters(sb, { groupId: seed.groupId, count: 1 });

    await createPhysicalLetter();

    const { data: rows } = await sb
      .from("physical_letters")
      .select("content_ref_type, content_ref_id, letter_id");
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      content_ref_type: "sorting",
      content_ref_id: sortingId,
    });
    // letter_id is an int between 0 and 999999 (CHECK constraint).
    expect(typeof rows?.[0]?.letter_id).toBe("number");
    expect(rows?.[0]?.letter_id).toBeGreaterThanOrEqual(0);
    expect(rows?.[0]?.letter_id).toBeLessThanOrEqual(999_999);

    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should fall back to an inspection letter when no sorting letters exist", async () => {
    const seed = await seedStoryline(sb, { suffix: "create-inspection", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });

    await createPhysicalLetter();

    const { data: rows } = await sb
      .from("physical_letters")
      .select("content_ref_type, content_ref_id");
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toEqual({
      content_ref_type: "inspection",
      content_ref_id: letterId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should throw when neither a sorting nor an inspection letter exists", async () => {
    // No seed: both views are empty.
    await expect(createPhysicalLetter()).rejects.toThrow(
      /Create a sorting or inspection letter/
    );

    const { count } = await sb
      .from("physical_letters")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should retry past a letter_id unique collision and insert exactly one row", async () => {
    // Seed an existing row at a known letter_id, then stub Math.random so the
    // first attempt collides and the second succeeds. This exercises the
    // 6-attempt retry loop without hitting the "exhausted" path.
    const seed = await seedStoryline(sb, { suffix: "create-retry", days: 1 });
    await addSortingLetter(sb, { dayId: seed.dayIds[0], sortId: 1 });
    await addPhysicalLetter(sb, {
      contentRefType: "inspection", // ref type/id don't matter for the collision
      contentRefId: seed.groupId,
      letterId: "123456",
    });

    // Math.random() * 1_000_000 then floor: 0.123456 → 123456 (collision).
    const calls = [0.123456, 0.654321];
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      return calls.shift() ?? 0.999_999;
    });

    try {
      await createPhysicalLetter();
    } finally {
      spy.mockRestore();
    }

    const { data: rows } = await sb
      .from("physical_letters")
      .select("letter_id")
      .order("letter_id");
    expect(rows?.map((r) => r.letter_id)).toEqual([123_456, 654_321]);
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });
});

describe("updatePhysicalLetter", () => {
  it("should write trimmed storage_location and notes and revalidate /physical", async () => {
    const seed = await seedStoryline(sb, { suffix: "update", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    const id = await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "100001",
      storageLocation: "old",
      notes: "old notes",
    });

    const fd = new FormData();
    fd.set("id", id);
    fd.set("storage_location", "  Shelf 7  ");
    fd.set("notes", "  refiled  ");

    await updatePhysicalLetter(fd);

    const { data } = await sb
      .from("physical_letters")
      .select("storage_location, notes")
      .eq("id", id)
      .single();
    expect(data).toEqual({ storage_location: "Shelf 7", notes: "refiled" });
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should null out storage_location and notes when given empty strings", async () => {
    const seed = await seedStoryline(sb, { suffix: "update-null", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    const id = await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "100002",
      storageLocation: "Bin 1",
      notes: "keep until purge",
    });

    const fd = new FormData();
    fd.set("id", id);
    fd.set("storage_location", "   ");
    fd.set("notes", "");

    await updatePhysicalLetter(fd);

    const { data } = await sb
      .from("physical_letters")
      .select("storage_location, notes")
      .eq("id", id)
      .single();
    expect(data).toEqual({ storage_location: null, notes: null });
  });

  it("should no-op when id is missing from the form", async () => {
    const fd = new FormData();
    fd.set("storage_location", "ignored");

    await updatePhysicalLetter(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateAllPhysicalLetters", () => {
  it("should write each pair-wise storage_location and revalidate once", async () => {
    const seed = await seedStoryline(sb, { suffix: "update-all", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    const idA = await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "200001",
      storageLocation: "A-old",
    });
    const idB = await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "200002",
      storageLocation: "B-old",
    });

    const fd = new FormData();
    fd.append("ids", idA);
    fd.append("ids", idB);
    fd.append("storage_locations", "  Shelf 1 ");
    fd.append("storage_locations", "");

    await updateAllPhysicalLetters(fd);

    const { data } = await sb
      .from("physical_letters")
      .select("id, storage_location")
      .in("id", [idA, idB]);
    const byId = Object.fromEntries(
      (data ?? []).map((r) => [r.id, r.storage_location])
    );
    // First row: trimmed; second row: empty-after-trim → null.
    expect(byId[idA]).toBe("Shelf 1");
    expect(byId[idB]).toBeNull();

    expect(revalidatePath).toHaveBeenCalledWith("/physical");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("should still revalidate /physical when the ids array is empty", async () => {
    const fd = new FormData();
    // No ids, no storage_locations.

    await updateAllPhysicalLetters(fd);

    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });
});

describe("deletePhysicalLetter", () => {
  it("should remove the row and revalidate /physical", async () => {
    const seed = await seedStoryline(sb, { suffix: "delete", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    const id = await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "300001",
    });

    const fd = new FormData();
    fd.set("id", id);
    await deletePhysicalLetter(fd);

    const { data } = await sb
      .from("physical_letters")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should no-op when id is missing from the form", async () => {
    const seed = await seedStoryline(sb, { suffix: "delete-noid", days: 1 });
    const sortingId = await addSortingLetter(sb, {
      dayId: seed.dayIds[0],
      sortId: 1,
    });
    await addPhysicalLetter(sb, {
      contentRefType: "sorting",
      contentRefId: sortingId,
      letterId: "300002",
    });

    const fd = new FormData();
    // No id.
    await deletePhysicalLetter(fd);

    const { count } = await sb
      .from("physical_letters")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
