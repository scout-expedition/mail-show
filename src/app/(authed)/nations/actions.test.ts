import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addNation,
  cleanupReferenceData,
  makeTestClient,
  testName,
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
  createNation,
  deleteNation,
  patchNation,
  updateAllNations,
} from "./actions";

const sb = makeTestClient();

beforeAll(async () => {
  await cleanupReferenceData(sb);
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

afterEach(async () => {
  await cleanupReferenceData(sb);
});

describe("patchNation", () => {
  it("should apply a partial patch without calling revalidatePath", async () => {
    const id = await addNation(sb, {
      suffix: "patch-instant",
      abbreviation: "AA",
      colorHex: "#111111",
    });

    await patchNation(id, { abbreviation: "BB", color_hex: "#222222" });

    const { data } = await sb
      .from("nations")
      .select("name, abbreviation, color_hex")
      .eq("id", id)
      .single();
    expect(data).toEqual({
      name: testName("patch-instant"),
      abbreviation: "BB",
      color_hex: "#222222",
    });
    // patchNation is instant-save: realtime fans the change to peers, so the
    // action deliberately does NOT call revalidatePath.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should accept null to clear the (unique) abbreviation", async () => {
    const id = await addNation(sb, {
      suffix: "patch-clear-abbr",
      abbreviation: "ZZ",
    });

    await patchNation(id, { abbreviation: null });

    const { data } = await sb
      .from("nations")
      .select("abbreviation")
      .eq("id", id)
      .single();
    expect(data?.abbreviation).toBeNull();
  });

  it("should throw when the patch violates the unique name constraint", async () => {
    const idA = await addNation(sb, { suffix: "patch-uniq-a" });
    await addNation(sb, { suffix: "patch-uniq-b" });

    await expect(
      patchNation(idA, { name: testName("patch-uniq-b") })
    ).rejects.toThrow();
  });
});

describe("createNation", () => {
  it("should insert a 'New nation' row with the default #888888 color and revalidate /nations", async () => {
    await createNation();

    const { data } = await sb
      .from("nations")
      .select("name, color_hex")
      .eq("name", "New nation")
      .single();
    expect(data).toEqual({ name: "New nation", color_hex: "#888888" });
    expect(revalidatePath).toHaveBeenCalledWith("/nations");

    // Cleanup: 'New nation' has no __INT_TEST__ prefix, so the standard
    // helper would skip it. Drop it explicitly to keep the unique-name slot.
    await sb.from("nations").delete().eq("name", "New nation");
  });

  it("should throw when the unique 'New nation' name is already taken", async () => {
    await createNation();
    try {
      await expect(createNation()).rejects.toThrow();
    } finally {
      await sb.from("nations").delete().eq("name", "New nation");
    }
  });
});

describe("updateAllNations", () => {
  it("should update every submitted row, normalize colors, blank-out empty abbreviations, and revalidate /nations", async () => {
    const id1 = await addNation(sb, {
      suffix: "bulk-1",
      abbreviation: "X1",
      colorHex: "#aaaaaa",
      sortOrder: 100,
    });
    const id2 = await addNation(sb, {
      suffix: "bulk-2",
      abbreviation: "X2",
      colorHex: "#bbbbbb",
      sortOrder: 200,
    });

    const fd = new FormData();
    fd.append("ids", id1);
    fd.append("ids", id2);
    fd.append("names", testName("bulk-1-renamed"));
    fd.append("names", testName("bulk-2-renamed"));
    // Trim + empty → null for unique-nullable `abbreviation`.
    fd.append("abbreviations", "  Y1 ");
    fd.append("abbreviations", "   ");
    // Mix shorthand + uppercase to exercise `normalizeHex`.
    fd.append("colors", "#ABC");
    fd.append("colors", "DEF000");
    fd.append("sort_orders", "10");
    fd.append("sort_orders", "20");

    await updateAllNations(fd);

    const { data } = await sb
      .from("nations")
      .select("id, name, abbreviation, color_hex, sort_order")
      .in("id", [id1, id2])
      .order("sort_order");
    expect(data).toEqual([
      {
        id: id1,
        name: testName("bulk-1-renamed"),
        abbreviation: "Y1",
        color_hex: "#aabbcc",
        sort_order: 10,
      },
      {
        id: id2,
        name: testName("bulk-2-renamed"),
        abbreviation: null,
        color_hex: "#def000",
        sort_order: 20,
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/nations");
  });

  it("should skip rows whose trimmed name is empty (no update, no throw)", async () => {
    const id = await addNation(sb, {
      suffix: "bulk-skip",
      abbreviation: "KK",
      colorHex: "#123456",
      sortOrder: 50,
    });

    const fd = new FormData();
    fd.append("ids", id);
    fd.append("names", "   "); // trims to empty → skipped
    fd.append("abbreviations", "QQ");
    fd.append("colors", "#ffffff");
    fd.append("sort_orders", "0");

    await updateAllNations(fd);

    const { data } = await sb
      .from("nations")
      .select("name, abbreviation, color_hex, sort_order")
      .eq("id", id)
      .single();
    // Row untouched — name stayed, abbreviation stayed, color stayed.
    expect(data).toEqual({
      name: testName("bulk-skip"),
      abbreviation: "KK",
      color_hex: "#123456",
      sort_order: 50,
    });
    // revalidate still fires once at the end of the loop; the action only
    // skips the per-row update, not the post-loop revalidate.
    expect(revalidatePath).toHaveBeenCalledWith("/nations");
  });

  it("should fall back to #888888 when the submitted color is unparseable", async () => {
    const id = await addNation(sb, {
      suffix: "bulk-bad-hex",
      colorHex: "#111111",
    });

    const fd = new FormData();
    fd.append("ids", id);
    fd.append("names", testName("bulk-bad-hex"));
    fd.append("abbreviations", "");
    fd.append("colors", "not-a-hex");
    fd.append("sort_orders", "0");

    await updateAllNations(fd);

    const { data } = await sb
      .from("nations")
      .select("color_hex")
      .eq("id", id)
      .single();
    expect(data?.color_hex).toBe("#888888");
  });
});

describe("deleteNation", () => {
  it("should delete the nation and revalidate /nations", async () => {
    const id = await addNation(sb, { suffix: "del-happy" });

    const fd = new FormData();
    fd.set("id", id);
    await deleteNation(fd);

    const { data } = await sb
      .from("nations")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/nations");
  });

  it("should no-op when the form has no id (no revalidate, no throw)", async () => {
    const id = await addNation(sb, { suffix: "del-noop" });

    const fd = new FormData();
    // intentionally no "id"
    await deleteNation(fd);

    const { data } = await sb
      .from("nations")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data?.id).toBe(id);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
