import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { makeTestClient } from "../../../../tests/integration/_helpers";

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
import { setPlaythroughReferenceMap } from "./playthrough-reference-actions";

const sb = makeTestClient();

/** Remove any singleton row seeded by these tests. */
async function cleanupReferenceSettings(): Promise<void> {
  await sb.from("playthrough_reference_settings").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

beforeAll(async () => {
  await cleanupReferenceSettings();
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

afterEach(async () => {
  await cleanupReferenceSettings();
});

afterAll(async () => {
  await cleanupReferenceSettings();
});

describe("setPlaythroughReferenceMap", () => {
  it("inserts a new row when no row exists", async () => {
    // Pre-condition: table is empty.
    const { data: before } = await sb
      .from("playthrough_reference_settings")
      .select("id")
      .limit(1);
    expect(before).toHaveLength(0);

    await setPlaythroughReferenceMap("https://example.com/map.png");

    const { data, error } = await sb
      .from("playthrough_reference_settings")
      .select("map_image_url")
      .limit(1)
      .single();
    expect(error).toBeNull();
    expect(data?.map_image_url).toBe("https://example.com/map.png");
  });

  it("updates the existing row instead of inserting a second one", async () => {
    // Seed an initial row.
    await setPlaythroughReferenceMap("https://example.com/map-v1.png");

    const { data: rowsAfterFirst } = await sb
      .from("playthrough_reference_settings")
      .select("id");
    expect(rowsAfterFirst).toHaveLength(1);

    // Now update.
    await setPlaythroughReferenceMap("https://example.com/map-v2.png");

    const { data: rowsAfterSecond } = await sb
      .from("playthrough_reference_settings")
      .select("id, map_image_url");
    // Singleton — still exactly one row.
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond![0].map_image_url).toBe(
      "https://example.com/map-v2.png"
    );
  });

  it("accepts null to clear the map URL", async () => {
    await setPlaythroughReferenceMap("https://example.com/map.png");
    await setPlaythroughReferenceMap(null);

    const { data } = await sb
      .from("playthrough_reference_settings")
      .select("map_image_url")
      .limit(1)
      .single();
    expect(data?.map_image_url).toBeNull();
  });

  it("calls revalidatePath for /settings and /playthroughs/[id] (bracket form)", async () => {
    await setPlaythroughReferenceMap("https://example.com/map.png");

    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/playthroughs/[id]", "page");
  });

  it("calls revalidatePath on update too (not just insert)", async () => {
    // First call creates the row.
    await setPlaythroughReferenceMap("https://example.com/map.png");
    vi.mocked(revalidatePath).mockClear();

    // Second call is an UPDATE path.
    await setPlaythroughReferenceMap("https://example.com/map-new.png");

    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/playthroughs/[id]", "page");
  });
});
