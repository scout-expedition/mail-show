import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addDay,
  addSortingLetter,
  cleanupTestData,
  makeTestClient,
} from "../_helpers";

// Pins sorting_letters_view.content_id: 'S' || day.number || '-' || lpad(sort_id, 2, '0').
// View definition lives in supabase/migrations/0001_init.sql.

describe("sorting_letters_view.content_id", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should zero-pad sort_id to 2 digits", async () => {
    const dayId = await addDay(sb, { suffix: "sort-pad", number: 9000 });
    const sortingId = await addSortingLetter(sb, { dayId, sortId: 9 });

    const { data } = await sb
      .from("sorting_letters_view")
      .select("content_id")
      .eq("id", sortingId)
      .single();

    expect(data?.content_id).toBe("S9000-09");
  });

  it("should not pad a 2-digit sort_id", async () => {
    const dayId = await addDay(sb, { suffix: "sort-nopad", number: 9001 });
    const sortingId = await addSortingLetter(sb, { dayId, sortId: 42 });

    const { data } = await sb
      .from("sorting_letters_view")
      .select("content_id")
      .eq("id", sortingId)
      .single();

    expect(data?.content_id).toBe("S9001-42");
  });
});
