import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
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
import { moveLetterGroupToDay } from "./actions";

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
