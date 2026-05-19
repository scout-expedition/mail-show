import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addAction,
  addReportSegment,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../../../../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// deleteInspectionLetter is the only action here that calls redirect().
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Action imports MUST come after the mocks above.
import {
  createAction,
  createInspectionLetter,
  createReportSegment,
  deleteAction,
  deleteInspectionLetter,
  deleteReportSegment,
  updateAction,
  updateInspectionLetter,
  updateReportSegment,
} from "./actions";

/**
 * Build a FormData from a plain object. Server actions in this file read
 * every field via formData.get(), so the test mirrors what the form submits.
 */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const sb = makeTestClient();

// ---------------- Inspection letters ----------------

describe("createInspectionLetter", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should insert the letter and revalidate the group page", async () => {
    const seed = await seedStoryline(sb, { suffix: "cil-ok", abbreviation: "A" });

    await createInspectionLetter(
      form({
        letter_group_id: seed.groupId,
        storyline_id: seed.storylineId,
        variant: "a",
        piece: "2",
        summary: "a summary",
        content: "letter body",
      })
    );

    const { data } = await sb
      .from("inspection_letters")
      .select("variant, piece, summary, content")
      .eq("letter_group_id", seed.groupId)
      .single();
    expect(data).toEqual({
      variant: "a",
      piece: 2,
      summary: "a summary",
      content: "letter body",
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}/groups/${seed.groupId}`
    );
  });

  it("should seed default Deliver and Flag actions for the new letter", async () => {
    const seed = await seedStoryline(sb, { suffix: "cil-actions", abbreviation: "B" });

    await createInspectionLetter(
      form({ letter_group_id: seed.groupId, storyline_id: seed.storylineId })
    );

    const { data: letter } = await sb
      .from("inspection_letters")
      .select("id")
      .eq("letter_group_id", seed.groupId)
      .single();
    const { data: actions } = await sb
      .from("actions")
      .select("name, sort_order")
      .eq("inspection_letter_id", letter!.id)
      .order("sort_order");
    expect(actions).toEqual([
      { name: "Deliver", sort_order: 0 },
      { name: "Flag", sort_order: 1 },
    ]);
  });

  it("should store blank optional fields as null", async () => {
    const seed = await seedStoryline(sb, { suffix: "cil-nulls", abbreviation: "C" });

    await createInspectionLetter(
      form({
        letter_group_id: seed.groupId,
        storyline_id: seed.storylineId,
        variant: "  ",
        piece: "",
        summary: "",
        content: "",
      })
    );

    const { data } = await sb
      .from("inspection_letters")
      .select("variant, piece, summary, content")
      .eq("letter_group_id", seed.groupId)
      .single();
    expect(data).toEqual({
      variant: null,
      piece: null,
      summary: null,
      content: null,
    });
  });

  it("should no-op when letter_group_id is missing", async () => {
    await createInspectionLetter(form({ storyline_id: "irrelevant" }));

    const { data } = await sb
      .from("inspection_letters")
      .select("id")
      .eq("letter_group_id", "00000000-0000-0000-0000-000000000000");
    expect(data).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateInspectionLetter", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should update the editable fields and revalidate the group page", async () => {
    const seed = await seedStoryline(sb, { suffix: "uil-ok", abbreviation: "Q" });
    const { data: inserted } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a", summary: "old" })
      .select("id")
      .single();

    await updateInspectionLetter(
      form({
        id: inserted!.id,
        storyline_id: seed.storylineId,
        letter_group_id: seed.groupId,
        variant: "b",
        piece: "3",
        summary: "new summary",
        content: "new content",
        notes: "a note",
      })
    );

    const { data } = await sb
      .from("inspection_letters")
      .select("variant, piece, summary, content, notes")
      .eq("id", inserted!.id)
      .single();
    expect(data).toEqual({
      variant: "b",
      piece: 3,
      summary: "new summary",
      content: "new content",
      notes: "a note",
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}/groups/${seed.groupId}`
    );
  });

  it("should clear citizen references when the form submits blank ids", async () => {
    const seed = await seedStoryline(sb, { suffix: "uil-citizen", abbreviation: "E" });
    const { data: nation } = await sb
      .from("nations")
      .insert({ name: "__INT_TEST__uil-citizen-nation" })
      .select("id")
      .single();
    const { data: citizen } = await sb
      .from("citizens")
      .insert({ name: "__INT_TEST__uil-citizen", nation_id: nation!.id })
      .select("id")
      .single();
    const { data: inserted } = await sb
      .from("inspection_letters")
      .insert({
        letter_group_id: seed.groupId,
        variant: "a",
        sender_citizen_id: citizen!.id,
      })
      .select("id")
      .single();

    await updateInspectionLetter(
      form({
        id: inserted!.id,
        storyline_id: seed.storylineId,
        letter_group_id: seed.groupId,
        sender_citizen_id: "",
        receiver_citizen_id: "",
      })
    );

    const { data } = await sb
      .from("inspection_letters")
      .select("sender_citizen_id, receiver_citizen_id")
      .eq("id", inserted!.id)
      .single();
    expect(data).toEqual({
      sender_citizen_id: null,
      receiver_citizen_id: null,
    });

    // Cleanup rows not reachable from the storyline cascade.
    await sb.from("citizens").delete().eq("id", citizen!.id);
    await sb.from("nations").delete().eq("id", nation!.id);
  });

  it("should no-op and skip revalidation when id is missing", async () => {
    await updateInspectionLetter(form({ summary: "ignored" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteInspectionLetter", () => {
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

  it("should delete the letter and redirect to the group page", async () => {
    const seed = await seedStoryline(sb, { suffix: "dil-ok", abbreviation: "F" });
    const { data: inserted } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();

    await deleteInspectionLetter(
      form({
        id: inserted!.id,
        storyline_id: seed.storylineId,
        letter_group_id: seed.groupId,
      })
    );

    const { data } = await sb
      .from("inspection_letters")
      .select("id")
      .eq("id", inserted!.id);
    expect(data).toEqual([]);
    expect(redirect).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}/groups/${seed.groupId}`
    );
  });

  it("should no-op and skip the redirect when id is missing", async () => {
    await deleteInspectionLetter(form({ storyline_id: "x", letter_group_id: "y" }));
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ---------------- Actions ----------------

describe("createAction", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should insert the action and revalidate /inspection/storylines", async () => {
    const seed = await seedStoryline(sb, { suffix: "ca-ok", abbreviation: "G" });
    const { data: letter } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();

    await createAction(
      form({
        inspection_letter_id: letter!.id,
        name: "Investigate",
        icon_value: "Search",
        color_hex: "#123456",
      })
    );

    const { data } = await sb
      .from("actions")
      .select("name, icon_type, icon_value, color_hex")
      .eq("inspection_letter_id", letter!.id)
      .single();
    expect(data).toEqual({
      name: "Investigate",
      icon_type: "lucide",
      icon_value: "Search",
      color_hex: "#123456",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should fall back to default name and color when the form omits them", async () => {
    const seed = await seedStoryline(sb, { suffix: "ca-defaults", abbreviation: "H" });
    const { data: letter } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();

    await createAction(form({ inspection_letter_id: letter!.id }));

    const { data } = await sb
      .from("actions")
      .select("name, color_hex, icon_value")
      .eq("inspection_letter_id", letter!.id)
      .single();
    expect(data).toEqual({
      name: "New action",
      color_hex: "#888888",
      icon_value: null,
    });
  });

  it("should no-op when inspection_letter_id is missing", async () => {
    await createAction(form({ name: "orphan" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateAction", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should update name, color and impact columns and revalidate", async () => {
    const seed = await seedStoryline(sb, { suffix: "ua-ok", abbreviation: "I" });
    const { data: letter } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();
    const actionId = await addAction(sb, { letterId: letter!.id, name: "before" });

    await updateAction(
      form({
        id: actionId,
        name: "after",
        icon_type: "emoji",
        icon_value: "🔥",
        color_hex: "#ff0000",
        impact_world_status: "3",
        impact_demerits: "-1",
        impact_folos: "2",
      })
    );

    const { data } = await sb
      .from("actions")
      .select(
        "name, icon_type, icon_value, color_hex, impact_world_status, impact_demerits, impact_folos, impact_gentry"
      )
      .eq("id", actionId)
      .single();
    expect(data).toEqual({
      name: "after",
      icon_type: "emoji",
      icon_value: "🔥",
      color_hex: "#ff0000",
      impact_world_status: 3,
      impact_demerits: -1,
      impact_folos: 2,
      impact_gentry: 0,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should link a report segment when report_segment_id is supplied", async () => {
    const seed = await seedStoryline(sb, { suffix: "ua-seg", abbreviation: "J" });
    const { data: letter } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();
    const actionId = await addAction(sb, { letterId: letter!.id });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await updateAction(
      form({ id: actionId, name: "n", color_hex: "#888888", report_segment_id: segId })
    );

    const { data } = await sb
      .from("actions")
      .select("report_segment_id")
      .eq("id", actionId)
      .single();
    expect(data?.report_segment_id).toBe(segId);
  });

  it("should no-op when id is missing", async () => {
    await updateAction(form({ name: "ignored" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteAction", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete the action and revalidate /inspection/storylines", async () => {
    const seed = await seedStoryline(sb, { suffix: "da-ok", abbreviation: "K" });
    const { data: letter } = await sb
      .from("inspection_letters")
      .insert({ letter_group_id: seed.groupId, variant: "a" })
      .select("id")
      .single();
    const actionId = await addAction(sb, { letterId: letter!.id });

    await deleteAction(form({ id: actionId }));

    const { data } = await sb.from("actions").select("id").eq("id", actionId);
    expect(data).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should no-op when id is missing", async () => {
    await deleteAction(form({}));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------- Report segments ----------------

describe("createReportSegment", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should insert the segment and revalidate /inspection/storylines", async () => {
    const seed = await seedStoryline(sb, { suffix: "crs-ok", abbreviation: "L" });

    await createReportSegment(
      form({
        report_group_id: seed.reportGroupId,
        variant: "ii",
        content: "report body",
      })
    );

    const { data } = await sb
      .from("report_segments")
      .select("variant, content")
      .eq("report_group_id", seed.reportGroupId)
      .single();
    expect(data).toEqual({ variant: "ii", content: "report body" });
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should no-op when variant is blank even if the group id is present", async () => {
    const seed = await seedStoryline(sb, { suffix: "crs-novariant", abbreviation: "M" });

    await createReportSegment(
      form({ report_group_id: seed.reportGroupId, variant: "   " })
    );

    const { data } = await sb
      .from("report_segments")
      .select("id")
      .eq("report_group_id", seed.reportGroupId);
    expect(data).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should no-op when report_group_id is missing", async () => {
    await createReportSegment(form({ variant: "iii" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateReportSegment", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should update variant, content and sort_order and revalidate", async () => {
    const seed = await seedStoryline(sb, { suffix: "urs-ok", abbreviation: "N" });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await updateReportSegment(
      form({ id: segId, variant: "iv", content: "edited", sort_order: "5" })
    );

    const { data } = await sb
      .from("report_segments")
      .select("variant, content, sort_order")
      .eq("id", segId)
      .single();
    expect(data).toEqual({ variant: "iv", content: "edited", sort_order: 5 });
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should default sort_order to 0 when the form omits it", async () => {
    const seed = await seedStoryline(sb, { suffix: "urs-sort", abbreviation: "O" });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await updateReportSegment(form({ id: segId, variant: "ii" }));

    const { data } = await sb
      .from("report_segments")
      .select("sort_order")
      .eq("id", segId)
      .single();
    expect(data?.sort_order).toBe(0);
  });

  it("should no-op when id is missing", async () => {
    await updateReportSegment(form({ variant: "ignored" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteReportSegment", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete the segment and revalidate /inspection/storylines", async () => {
    const seed = await seedStoryline(sb, { suffix: "drs-ok", abbreviation: "P" });
    const segId = await addReportSegment(sb, {
      reportGroupId: seed.reportGroupId,
      variant: "i",
    });

    await deleteReportSegment(form({ id: segId }));

    const { data } = await sb
      .from("report_segments")
      .select("id")
      .eq("id", segId);
    expect(data).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should no-op when id is missing", async () => {
    await deleteReportSegment(form({}));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
