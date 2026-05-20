import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addAction,
  addLetters,
  addPlaythrough,
  addPlaythroughChoice,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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
  chooseAction,
  clearActivePlaythrough,
  clearChoice,
  createPlaythrough,
  deletePlaythrough,
  setActivePlaythrough,
  updatePlaythrough,
} from "./actions";

const sb = makeTestClient();

/**
 * `createPlaythrough` inserts a row named "New playthrough" (no test prefix),
 * so `cleanupTestData` won't catch it. Wipe those by exact name match.
 * Similarly, `setActivePlaythrough`/`clearActivePlaythrough` may flip
 * `is_active` on any leftover row — but since we delete all playthroughs we
 * own at the end of each test, no cross-test contamination is possible.
 */
async function cleanupAllTestPlaythroughs(): Promise<void> {
  await sb.from("playthroughs").delete().eq("name", "New playthrough");
  await cleanupTestData(sb);
}

beforeAll(async () => {
  await cleanupAllTestPlaythroughs();
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
});

afterEach(async () => {
  await cleanupAllTestPlaythroughs();
});

describe("createPlaythrough", () => {
  it("should insert a default-named playthrough and redirect to its edit page", async () => {
    await createPlaythrough();

    const { data } = await sb
      .from("playthroughs")
      .select("id, name, current_phase, is_active")
      .eq("name", "New playthrough")
      .single();
    expect(data?.name).toBe("New playthrough");
    expect(data?.current_phase).toBe("top_of_day");
    expect(data?.is_active).toBe(false);

    expect(revalidatePath).toHaveBeenCalledWith("/playthroughs");
    expect(redirect).toHaveBeenCalledWith(`/playthroughs/${data?.id}`);
  });
});

describe("updatePlaythrough", () => {
  it("should apply form fields and revalidate the playthrough's page", async () => {
    const id = await addPlaythrough(sb, { suffix: "update" });

    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", "__INT_TEST__renamed");
    fd.set("notes", "  these are notes  ");
    fd.set("current_phase", "inspection");

    await updatePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("name, notes, current_day_id, current_phase")
      .eq("id", id)
      .single();
    expect(data).toEqual({
      name: "__INT_TEST__renamed",
      notes: "these are notes",
      current_day_id: null,
      current_phase: "inspection",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/playthroughs/${id}`);
  });

  it("should coerce blank string fields to null", async () => {
    const id = await addPlaythrough(sb, { suffix: "blanks" });

    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", "__INT_TEST__keep");
    fd.set("notes", "   ");
    fd.set("current_day_id", "");
    fd.set("current_phase", "top_of_day");

    await updatePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("notes, current_day_id")
      .eq("id", id)
      .single();
    expect(data).toEqual({ notes: null, current_day_id: null });
  });

  it("should no-op when no id is provided", async () => {
    const id = await addPlaythrough(sb, { suffix: "noop-update" });

    const fd = new FormData();
    fd.set("name", "__INT_TEST__should-not-apply");

    await updatePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("name")
      .eq("id", id)
      .single();
    expect(data?.name).toBe("__INT_TEST__noop-update");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setActivePlaythrough", () => {
  it("should activate the target and deactivate every other playthrough", async () => {
    const idA = await addPlaythrough(sb, { suffix: "active-a" });
    const idB = await addPlaythrough(sb, { suffix: "active-b" });
    // Mark A active first so the test verifies B's update flips A off.
    await sb.from("playthroughs").update({ is_active: true }).eq("id", idA);

    const fd = new FormData();
    fd.set("id", idB);
    await setActivePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("id, is_active")
      .in("id", [idA, idB])
      .order("id");
    const byId = Object.fromEntries(
      (data ?? []).map((r) => [r.id, r.is_active])
    );
    expect(byId[idA]).toBe(false);
    expect(byId[idB]).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/playthroughs");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("should no-op when no id is provided", async () => {
    const id = await addPlaythrough(sb, { suffix: "noop-active" });

    const fd = new FormData();
    await setActivePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("is_active")
      .eq("id", id)
      .single();
    expect(data?.is_active).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("clearActivePlaythrough", () => {
  it("should revalidate both /playthroughs and /", async () => {
    // The action's update has no row-filter; the revalidatePath calls are the
    // observable contract. Assert those without coupling to the
    // unfiltered-update side-effect.
    await clearActivePlaythrough();

    expect(revalidatePath).toHaveBeenCalledWith("/playthroughs");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("deletePlaythrough", () => {
  it("should delete the row and redirect to the list", async () => {
    const id = await addPlaythrough(sb, { suffix: "delete" });

    const fd = new FormData();
    fd.set("id", id);
    await deletePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(redirect).toHaveBeenCalledWith("/playthroughs");
  });

  it("should no-op when no id is provided", async () => {
    const id = await addPlaythrough(sb, { suffix: "noop-delete" });

    const fd = new FormData();
    await deletePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data?.id).toBe(id);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("chooseAction", () => {
  it("should insert a choice and revalidate the playthrough + home", async () => {
    const seed = await seedStoryline(sb, { suffix: "choose", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId });
    const playthroughId = await addPlaythrough(sb, { suffix: "choose" });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("inspection_letter_id", letterId);
    fd.set("chosen_action_id", actionId);
    await chooseAction(fd);

    const { data } = await sb
      .from("playthrough_action_choices")
      .select("playthrough_id, inspection_letter_id, chosen_action_id")
      .eq("playthrough_id", playthroughId)
      .single();
    expect(data).toEqual({
      playthrough_id: playthroughId,
      inspection_letter_id: letterId,
      chosen_action_id: actionId,
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/playthroughs/${playthroughId}`
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("should upsert on (playthrough_id, inspection_letter_id) — switching the chosen action in place", async () => {
    const seed = await seedStoryline(sb, { suffix: "upsert", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionA = await addAction(sb, { letterId });
    const actionB = await addAction(sb, { letterId });
    const playthroughId = await addPlaythrough(sb, { suffix: "upsert" });
    await addPlaythroughChoice(sb, {
      playthroughId,
      letterId,
      actionId: actionA,
    });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("inspection_letter_id", letterId);
    fd.set("chosen_action_id", actionB);
    await chooseAction(fd);

    const { data } = await sb
      .from("playthrough_action_choices")
      .select("chosen_action_id")
      .eq("playthrough_id", playthroughId)
      .eq("inspection_letter_id", letterId);
    expect(data).toHaveLength(1);
    expect(data?.[0].chosen_action_id).toBe(actionB);
  });

  it("should no-op when any of the three id fields is missing", async () => {
    const seed = await seedStoryline(sb, { suffix: "missing", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const playthroughId = await addPlaythrough(sb, { suffix: "missing" });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("inspection_letter_id", letterId);
    // chosen_action_id intentionally omitted.
    await chooseAction(fd);

    const { count } = await sb
      .from("playthrough_action_choices")
      .select("id", { count: "exact", head: true })
      .eq("playthrough_id", playthroughId);
    expect(count).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("clearChoice", () => {
  it("should delete the (playthrough, letter) pair and revalidate the playthrough page", async () => {
    const seed = await seedStoryline(sb, { suffix: "clear", days: 1 });
    const [letterId] = await addLetters(sb, { groupId: seed.groupId, count: 1 });
    const actionId = await addAction(sb, { letterId });
    const playthroughId = await addPlaythrough(sb, { suffix: "clear" });
    await addPlaythroughChoice(sb, {
      playthroughId,
      letterId,
      actionId,
    });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("inspection_letter_id", letterId);
    await clearChoice(fd);

    const { data } = await sb
      .from("playthrough_action_choices")
      .select("id")
      .eq("playthrough_id", playthroughId)
      .eq("inspection_letter_id", letterId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(
      `/playthroughs/${playthroughId}`
    );
  });

  it("should leave unrelated choices for the same playthrough intact", async () => {
    const seed = await seedStoryline(sb, { suffix: "scoped", days: 1 });
    const [letterA, letterB] = await addLetters(sb, {
      groupId: seed.groupId,
      count: 2,
    });
    const actionA = await addAction(sb, { letterId: letterA });
    const actionB = await addAction(sb, { letterId: letterB });
    const playthroughId = await addPlaythrough(sb, { suffix: "scoped" });
    await addPlaythroughChoice(sb, {
      playthroughId,
      letterId: letterA,
      actionId: actionA,
    });
    await addPlaythroughChoice(sb, {
      playthroughId,
      letterId: letterB,
      actionId: actionB,
    });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("inspection_letter_id", letterA);
    await clearChoice(fd);

    const { data } = await sb
      .from("playthrough_action_choices")
      .select("inspection_letter_id")
      .eq("playthrough_id", playthroughId);
    expect(data?.map((r) => r.inspection_letter_id)).toEqual([letterB]);
  });
});
