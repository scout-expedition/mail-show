import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addGroup,
  addLetters,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
  testName,
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
  createLetterGroup,
  createStoryline,
  createStorylineWithFields,
  deleteLetterGroup,
  deleteStoryline,
  patchStoryline,
  reorderStorylines,
  updateAllStorylines,
  updateLetterGroup,
  updateStoryline,
  updateStorylineFields,
} from "./actions";

const sb = makeTestClient();

/** Build a FormData from a flat key/value map. */
function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

/**
 * Insert a bare test-marked storyline directly (no group/days) so
 * cleanupTestData picks it up by name prefix. Distinct abbreviations are
 * required because storylines.abbreviation is a unique char(1).
 */
async function insertBareStoryline(opts: {
  suffix: string;
  abbreviation: string;
  sortOrder?: number;
}): Promise<string> {
  const { data, error } = await sb
    .from("storylines")
    .insert({
      name: testName(opts.suffix),
      abbreviation: opts.abbreviation,
      sort_order: opts.sortOrder ?? 9999,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertBareStoryline: ${error?.message}`);
  return data.id as string;
}

describe("patchStoryline", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should apply a partial field patch without calling revalidatePath", async () => {
    const id = await insertBareStoryline({ suffix: "patch", abbreviation: "P" });

    await patchStoryline(id, { name: testName("patch-renamed") });

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation")
      .eq("id", id)
      .single();
    expect(data?.name).toBe(testName("patch-renamed"));
    // Unpatched field is untouched.
    expect(data?.abbreviation).toBe("P");
    // Instant-save patch — realtime fans the change out, no revalidate.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should reject the reserved 'D' abbreviation before touching the DB", async () => {
    const id = await insertBareStoryline({
      suffix: "patch-guard",
      abbreviation: "Q",
    });

    await expect(
      patchStoryline(id, { abbreviation: "d" })
    ).rejects.toThrow(/reserved/);

    // The guard runs before the update — the row keeps its original value.
    const { data } = await sb
      .from("storylines")
      .select("abbreviation")
      .eq("id", id)
      .single();
    expect(data?.abbreviation).toBe("Q");
  });
});

describe("createStorylineWithFields", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should insert a normalized storyline and revalidate storylines + letters", async () => {
    const { id } = await createStorylineWithFields({
      name: `  ${testName("cwf")}  `,
      abbreviation: "el",
      notes: "  a desc  ",
      icon_type: "lucide",
      icon_value: "  star  ",
      color_hex: "ABC",
    });

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation, notes, icon_value, color_hex")
      .eq("id", id)
      .single();
    expect(data?.name).toBe(testName("cwf"));
    // Abbreviation is upper-cased and clipped to the first char.
    expect(data?.abbreviation).toBe("E");
    expect(data?.notes).toBe("a desc");
    expect(data?.icon_value).toBe("star");
    // 3-digit hex expands and lower-cases.
    expect(data?.color_hex).toBe("#aabbcc");

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
  });

  it("should reject the reserved 'D' abbreviation and insert nothing", async () => {
    await expect(
      createStorylineWithFields({
        name: testName("cwf-guard"),
        abbreviation: "d",
        notes: null,
        icon_type: "lucide",
        icon_value: null,
        color_hex: "#123456",
      })
    ).rejects.toThrow(/reserved/);

    const { data } = await sb
      .from("storylines")
      .select("id")
      .eq("name", testName("cwf-guard"));
    expect(data ?? []).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createStoryline", () => {
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

  // createStoryline inserts a row literally named "New storyline" — that
  // carries no __INT_TEST__ prefix, so cleanupTestData cannot reclaim it.
  // Capture created ids and delete them explicitly.
  const createdIds: string[] = [];
  afterEach(async () => {
    if (createdIds.length > 0) {
      await sb.from("storylines").delete().in("id", createdIds.splice(0));
    }
  });

  it("should create a 'New storyline' with a non-'D' abbreviation and redirect to its editor page", async () => {
    await createStoryline();

    const { data } = await sb
      .from("storylines")
      .select("id, name, abbreviation")
      .eq("name", "New storyline");
    expect(data ?? []).not.toHaveLength(0);
    for (const row of data ?? []) {
      createdIds.push(row.id as string);
      // The picker skips 'D' (reserved for day identifiers).
      expect((row.abbreviation as string).toUpperCase()).not.toBe("D");
    }

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
    const created = (data ?? [])[0];
    expect(redirect).toHaveBeenCalledWith(
      `/inspection/storylines/${created.id}`
    );
  });
});

describe("updateStorylineFields", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should persist normalized fields and revalidate the three storyline routes", async () => {
    const id = await insertBareStoryline({
      suffix: "usf",
      abbreviation: "F",
    });

    await updateStorylineFields({
      id,
      name: `  ${testName("usf-new")}  `,
      abbreviation: "gh",
      notes: "   ",
      icon_type: "lucide",
      icon_value: null,
      color_hex: "#FFFFFF",
    });

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation, notes, color_hex")
      .eq("id", id)
      .single();
    expect(data?.name).toBe(testName("usf-new"));
    expect(data?.abbreviation).toBe("G");
    // Whitespace-only notes normalizes to null.
    expect(data?.notes).toBeNull();
    expect(data?.color_hex).toBe("#ffffff");

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${id}`
    );
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should reject the reserved 'D' abbreviation and leave the row unchanged", async () => {
    const id = await insertBareStoryline({
      suffix: "usf-guard",
      abbreviation: "H",
    });

    await expect(
      updateStorylineFields({
        id,
        name: testName("usf-guard-new"),
        abbreviation: "D",
        notes: null,
        icon_type: "lucide",
        icon_value: null,
        color_hex: "#123456",
      })
    ).rejects.toThrow(/reserved/);

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation")
      .eq("id", id)
      .single();
    expect(data?.name).toBe(testName("usf-guard"));
    expect(data?.abbreviation).toBe("H");
  });
});

describe("updateStoryline", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should persist FormData fields and revalidate the storyline routes", async () => {
    const id = await insertBareStoryline({
      suffix: "us",
      abbreviation: "J",
    });

    await updateStoryline(
      form({
        id,
        name: `  ${testName("us-new")}  `,
        abbreviation: "k",
        notes: "  notes here  ",
        icon_type: "lucide",
        icon_value: "  flag  ",
        color_hex: "abc",
        sort_order: "7",
      })
    );

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation, notes, icon_value, color_hex, sort_order")
      .eq("id", id)
      .single();
    expect(data?.name).toBe(testName("us-new"));
    expect(data?.abbreviation).toBe("K");
    expect(data?.notes).toBe("notes here");
    expect(data?.icon_value).toBe("flag");
    expect(data?.color_hex).toBe("#aabbcc");
    expect(data?.sort_order).toBe(7);

    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${id}`
    );
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should no-op when FormData carries no id", async () => {
    await updateStoryline(form({ name: "ignored" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should reject the reserved 'D' abbreviation", async () => {
    const id = await insertBareStoryline({
      suffix: "us-guard",
      abbreviation: "L",
    });

    await expect(
      updateStoryline(
        form({
          id,
          name: testName("us-guard-new"),
          abbreviation: "d",
          color_hex: "#123456",
        })
      )
    ).rejects.toThrow(/reserved/);

    const { data } = await sb
      .from("storylines")
      .select("abbreviation")
      .eq("id", id)
      .single();
    expect(data?.abbreviation).toBe("L");
  });
});

describe("deleteStoryline", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete the row and revalidate /inspection/storylines", async () => {
    const id = await insertBareStoryline({
      suffix: "del",
      abbreviation: "M",
    });

    await deleteStoryline(form({ id }));

    const { data } = await sb
      .from("storylines")
      .select("id")
      .eq("id", id);
    expect(data ?? []).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should no-op when FormData carries no id", async () => {
    await deleteStoryline(form({}));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("reorderStorylines", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should write sort_order = index for each id and revalidate the list", async () => {
    const first = await insertBareStoryline({
      suffix: "ro-1",
      abbreviation: "N",
      sortOrder: 5,
    });
    const second = await insertBareStoryline({
      suffix: "ro-2",
      abbreviation: "O",
      sortOrder: 6,
    });
    const third = await insertBareStoryline({
      suffix: "ro-3",
      abbreviation: "R",
      sortOrder: 7,
    });

    // Request order reverses the seeded order.
    await reorderStorylines([third, second, first]);

    const { data } = await sb
      .from("storylines")
      .select("id, sort_order")
      .in("id", [first, second, third]);
    const orderById = Object.fromEntries(
      (data ?? []).map((r) => [r.id, r.sort_order])
    );
    expect(orderById[third]).toBe(0);
    expect(orderById[second]).toBe(1);
    expect(orderById[first]).toBe(2);

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });
});

describe("updateAllStorylines", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should bulk-update every row from the parallel FormData arrays", async () => {
    const idA = await insertBareStoryline({
      suffix: "ua-a",
      abbreviation: "V",
    });
    const idB = await insertBareStoryline({
      suffix: "ua-b",
      abbreviation: "W",
    });

    const fd = new FormData();
    for (const id of [idA, idB]) fd.append("ids", id);
    fd.append("names", testName("ua-a-new"));
    fd.append("names", testName("ua-b-new"));
    fd.append("abbreviations", "x");
    fd.append("abbreviations", "y");
    fd.append("notes", "desc a");
    fd.append("notes", "  ");
    fd.append("icon_types", "lucide");
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "star");
    fd.append("icon_values", "");
    fd.append("colors", "abc");
    fd.append("colors", "#FF0000");
    fd.append("sort_orders", "3");
    fd.append("sort_orders", "4");

    await updateAllStorylines(fd);

    const { data } = await sb
      .from("storylines")
      .select("id, name, abbreviation, notes, color_hex, sort_order")
      .in("id", [idA, idB]);
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r]));
    expect(byId[idA].name).toBe(testName("ua-a-new"));
    expect(byId[idA].abbreviation).toBe("X");
    expect(byId[idA].notes).toBe("desc a");
    expect(byId[idA].color_hex).toBe("#aabbcc");
    expect(byId[idA].sort_order).toBe(3);
    expect(byId[idB].abbreviation).toBe("Y");
    // Whitespace-only notes normalizes to null.
    expect(byId[idB].notes).toBeNull();

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/storylines");
  });

  it("should skip rows whose name is blank", async () => {
    const id = await insertBareStoryline({
      suffix: "ua-skip",
      abbreviation: "Z",
    });

    const fd = new FormData();
    fd.append("ids", id);
    fd.append("names", "   ");
    fd.append("abbreviations", "x");
    fd.append("notes", "should not land");
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "");
    fd.append("colors", "#000000");
    fd.append("sort_orders", "1");

    await updateAllStorylines(fd);

    const { data } = await sb
      .from("storylines")
      .select("name, abbreviation, notes")
      .eq("id", id)
      .single();
    // Blank-name row was skipped entirely — original values intact.
    expect(data?.name).toBe(testName("ua-skip"));
    expect(data?.abbreviation).toBe("Z");
    expect(data?.notes).toBeNull();
  });

  it("should reject the reserved 'D' abbreviation for any row in the batch", async () => {
    const id = await insertBareStoryline({
      suffix: "ua-guard",
      abbreviation: "A",
    });

    const fd = new FormData();
    fd.append("ids", id);
    fd.append("names", testName("ua-guard-new"));
    fd.append("abbreviations", "d");
    fd.append("notes", "");
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "");
    fd.append("colors", "#123456");
    fd.append("sort_orders", "0");

    await expect(updateAllStorylines(fd)).rejects.toThrow(/reserved/);
  });
});

describe("createLetterGroup", () => {
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

  it("should create the next-sequenced group and redirect to its deep link", async () => {
    // seedStoryline already inserts a group with sequence 1.
    const seed = await seedStoryline(sb, {
      suffix: "clg",
      abbreviation: "B",
      days: 1,
    });

    await createLetterGroup(form({ storyline_id: seed.storylineId }));

    const { data } = await sb
      .from("letter_groups")
      .select("name, sequence")
      .eq("storyline_id", seed.storylineId)
      .order("sequence");
    const sequences = (data ?? []).map((r) => r.sequence);
    expect(sequences).toContain(2);
    const created = (data ?? []).find((r) => r.sequence === 2);
    expect(created?.name).toBe("Group 2");

    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}`
    );
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    // Deep link is built from the storyline abbreviation + new sequence.
    expect(redirect).toHaveBeenCalledWith(
      `/inspection/letters?group=${seed.abbreviation}2`
    );
  });

  it("should no-op when FormData carries no storyline_id", async () => {
    await createLetterGroup(form({}));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("updateLetterGroup", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should persist group fields and mirror the name onto the linked report group", async () => {
    const seed = await seedStoryline(sb, {
      suffix: "ulg",
      abbreviation: "C",
      days: 1,
    });

    await updateLetterGroup(
      form({
        id: seed.groupId,
        storyline_id: seed.storylineId,
        name: testName("ulg-renamed"),
        notes: "  some notes  ",
        sequence: "1",
        delivery_day_id: seed.dayIds[0],
      })
    );

    const { data: group } = await sb
      .from("letter_groups")
      .select("name, notes, sequence, delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(group?.name).toBe(testName("ulg-renamed"));
    expect(group?.notes).toBe("some notes");
    expect(group?.delivery_day_id).toBe(seed.dayIds[0]);

    // The report group linked by the auto-report trigger mirrors the name.
    const { data: reportGroup } = await sb
      .from("report_groups")
      .select("name")
      .eq("letter_group_id", seed.groupId)
      .single();
    expect(reportGroup?.name).toBe(testName("ulg-renamed"));

    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}/groups/${seed.groupId}`
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}`
    );
  });

  it("should normalize a blank notes field to null", async () => {
    const seed = await seedStoryline(sb, {
      suffix: "ulg-notes",
      abbreviation: "G",
      days: 1,
    });

    await updateLetterGroup(
      form({
        id: seed.groupId,
        storyline_id: seed.storylineId,
        name: testName("ulg-notes-g"),
        notes: "   ",
        sequence: "1",
      })
    );

    const { data } = await sb
      .from("letter_groups")
      .select("notes, delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(data?.notes).toBeNull();
    // Empty delivery_day_id form value normalizes to null.
    expect(data?.delivery_day_id).toBeNull();
  });

  it("should no-op when FormData carries no id", async () => {
    await updateLetterGroup(form({ name: "ignored" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteLetterGroup", () => {
  beforeAll(async () => {
    await cleanupTestData(sb);
  });
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });
  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete the group (cascading its letters) and redirect to the storyline", async () => {
    const seed = await seedStoryline(sb, {
      suffix: "dlg",
      abbreviation: "K",
      days: 1,
    });
    const { groupId } = await addGroup(sb, {
      storylineId: seed.storylineId,
      sequence: 2,
      suffix: "dlg",
      deliveryDayId: seed.dayIds[0],
    });
    const letterIds = await addLetters(sb, { groupId, count: 2 });

    await deleteLetterGroup(
      form({ id: groupId, storyline_id: seed.storylineId })
    );

    const { data: group } = await sb
      .from("letter_groups")
      .select("id")
      .eq("id", groupId);
    expect(group ?? []).toHaveLength(0);

    // Letters cascade-delete with their group.
    const { data: letters } = await sb
      .from("inspection_letters")
      .select("id")
      .in("id", letterIds);
    expect(letters ?? []).toHaveLength(0);

    expect(redirect).toHaveBeenCalledWith(
      `/inspection/storylines/${seed.storylineId}`
    );
  });

  it("should no-op when FormData carries no id", async () => {
    await deleteLetterGroup(form({ storyline_id: "whatever" }));
    expect(redirect).not.toHaveBeenCalled();
  });
});
