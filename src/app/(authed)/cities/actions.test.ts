import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addCity,
  addNation,
  cleanupReferenceData,
  makeTestClient,
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
  bulkCreateCities,
  createCity,
  deleteCity,
  patchCity,
  updateAllCities,
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

describe("patchCity", () => {
  it("should apply the patch and NOT call revalidatePath (instant-save contract)", async () => {
    const nationId = await addNation(sb, { suffix: "patch", abbreviation: "PT" });
    const cityId = await addCity(sb, {
      suffix: "patch",
      nationId,
      code: "AAA 111",
    });

    await patchCity(cityId, { name: "Renamed City", code: "BBB 222" });

    const { data } = await sb
      .from("cities")
      .select("name, code, nation_id")
      .eq("id", cityId)
      .single();
    expect(data).toEqual({
      name: "Renamed City",
      code: "BBB 222",
      nation_id: nationId,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw when the patched code collides with an existing (code, nation_id) pair", async () => {
    const nationId = await addNation(sb, { suffix: "patch-dup", abbreviation: "PD" });
    await addCity(sb, { suffix: "patch-dup-a", nationId, code: "CCC 333" });
    const otherId = await addCity(sb, {
      suffix: "patch-dup-b",
      nationId,
      code: "DDD 444",
    });

    await expect(
      patchCity(otherId, { code: "CCC 333" })
    ).rejects.toThrow();
  });
});

describe("createCity", () => {
  it("should insert a placeholder row using the lowest-sort_order nation and revalidate /cities", async () => {
    // supabase/seed.sql preserves 5 production nations with sort_order 1..5.
    // Use sort_order = -1 / -2 so a test nation deterministically wins the
    // `order by sort_order asc limit 1` lookup inside createCity().
    const primaryNationId = await addNation(sb, {
      suffix: "create-primary",
      abbreviation: "CP",
      sortOrder: -2,
    });
    await addNation(sb, {
      suffix: "create-secondary",
      abbreviation: "CS",
      sortOrder: -1,
    });

    await createCity();

    const { data } = await sb
      .from("cities")
      .select("name, code, nation_id")
      .eq("nation_id", primaryNationId)
      .eq("name", "New city")
      .single();
    expect(data).toEqual({
      name: "New city",
      code: "NEW",
      nation_id: primaryNationId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/cities");

    // The inserted row's name has no __INT_TEST__ marker, so
    // cleanupReferenceData() in afterEach won't strip it. Delete it here so
    // the test nation's FK from cities (on delete restrict) doesn't block
    // its cleanup.
    await sb
      .from("cities")
      .delete()
      .eq("nation_id", primaryNationId)
      .eq("name", "New city");
  });

  // Note: the "no nations in DB → throws" branch is not exercised here.
  // supabase/seed.sql seeds 5 production nations and `cleanupReferenceData`
  // intentionally preserves them, so the empty-nations state isn't reachable
  // from the integration harness without nuking seeded reference data — out
  // of scope for this action's coverage.
});

describe("updateAllCities", () => {
  it("should update every submitted row, validate the ABC DEF code format, and revalidate /cities", async () => {
    const nationId = await addNation(sb, { suffix: "upd-all", abbreviation: "UA" });
    const cityA = await addCity(sb, { suffix: "upd-all-a", nationId, code: "AAA 111" });
    const cityB = await addCity(sb, { suffix: "upd-all-b", nationId, code: "BBB 222" });

    const fd = new FormData();
    fd.append("ids", cityA);
    fd.append("ids", cityB);
    fd.append("names", "Renamed A");
    fd.append("names", "Renamed B");
    fd.append("codes", "EEE 555");
    fd.append("codes", "FFF 666");
    fd.append("nation_ids", nationId);
    fd.append("nation_ids", nationId);

    await updateAllCities(fd);

    const { data } = await sb
      .from("cities")
      .select("id, name, code")
      .in("id", [cityA, cityB])
      .order("code");
    expect(data).toEqual([
      { id: cityA, name: "Renamed A", code: "EEE 555" },
      { id: cityB, name: "Renamed B", code: "FFF 666" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/cities");
  });

  it("should throw on an invalid code format and leave the row untouched", async () => {
    const nationId = await addNation(sb, { suffix: "upd-invalid", abbreviation: "UI" });
    const cityId = await addCity(sb, {
      suffix: "upd-invalid",
      nationId,
      code: "GGG 777",
    });

    const fd = new FormData();
    fd.append("ids", cityId);
    fd.append("names", "Should Not Stick");
    fd.append("codes", "lowercase"); // fails /^[A-Z0-9]{3} [A-Z0-9]{3}$/
    fd.append("nation_ids", nationId);

    await expect(updateAllCities(fd)).rejects.toThrow(/Invalid city code/);

    const { data } = await sb
      .from("cities")
      .select("name, code")
      .eq("id", cityId)
      .single();
    expect(data).toEqual({ name: `__INT_TEST__upd-invalid`, code: "GGG 777" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw when two submitted rows share the same code", async () => {
    const nationId = await addNation(sb, { suffix: "upd-dup", abbreviation: "UD" });
    const cityA = await addCity(sb, { suffix: "upd-dup-a", nationId, code: "HHH 888" });
    const cityB = await addCity(sb, { suffix: "upd-dup-b", nationId, code: "III 999" });

    const fd = new FormData();
    fd.append("ids", cityA);
    fd.append("ids", cityB);
    fd.append("names", "A");
    fd.append("names", "B");
    fd.append("codes", "JJJ 000");
    fd.append("codes", "JJJ 000");
    fd.append("nation_ids", nationId);
    fd.append("nation_ids", nationId);

    await expect(updateAllCities(fd)).rejects.toThrow(/Duplicate city code/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should skip rows with empty name or empty nation_id without throwing", async () => {
    const nationId = await addNation(sb, { suffix: "upd-skip", abbreviation: "US" });
    const cityId = await addCity(sb, { suffix: "upd-skip", nationId, code: "KKK 111" });

    const fd = new FormData();
    fd.append("ids", cityId);
    fd.append("names", ""); // empty → skipped
    fd.append("codes", "LLL 222");
    fd.append("nation_ids", nationId);

    await updateAllCities(fd);

    const { data } = await sb
      .from("cities")
      .select("name, code")
      .eq("id", cityId)
      .single();
    // Skipped — original name and code remain.
    expect(data).toEqual({ name: `__INT_TEST__upd-skip`, code: "KKK 111" });
    expect(revalidatePath).toHaveBeenCalledWith("/cities");
  });
});

describe("bulkCreateCities", () => {
  it("should insert rows resolved by nation name (case-insensitive) and revalidate /cities", async () => {
    const nationId = await addNation(sb, {
      suffix: "bulk-name",
      abbreviation: "BN",
    });
    // The test nation name is `__INT_TEST__bulk-name` — use it verbatim with
    // a different casing to prove the case-insensitive lookup.
    const fd = new FormData();
    fd.set(
      "paste",
      `Newville, MMM 222, __int_test__bulk-name`
    );

    await bulkCreateCities(fd);

    const { data } = await sb
      .from("cities")
      .select("name, code, nation_id")
      .eq("name", "Newville")
      .single();
    expect(data).toEqual({
      name: "Newville",
      code: "MMM 222",
      nation_id: nationId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/cities");

    // bulk-inserted rows lack the test marker — strip them manually so
    // cleanupReferenceData's nations delete isn't blocked by FK references.
    await sb.from("cities").delete().eq("nation_id", nationId);
  });

  it("should resolve nations by abbreviation and accept tab/pipe separators", async () => {
    const nationId = await addNation(sb, {
      suffix: "bulk-abbr",
      abbreviation: "BA",
    });
    const fd = new FormData();
    fd.set(
      "paste",
      [
        `Tab City\tNNN 333\tBA`, // tab-separated, abbreviation
        `Pipe City|OOO 444|ba`, // pipe-separated, lowercase abbreviation
      ].join("\n")
    );

    await bulkCreateCities(fd);

    const { data } = await sb
      .from("cities")
      .select("name, code, nation_id")
      .in("name", ["Tab City", "Pipe City"])
      .order("name");
    expect(data).toEqual([
      { name: "Pipe City", code: "OOO 444", nation_id: nationId },
      { name: "Tab City", code: "NNN 333", nation_id: nationId },
    ]);

    await sb.from("cities").delete().eq("nation_id", nationId);
  });

  it("should skip lines that have fewer than 3 parts or an unresolved nation", async () => {
    const nationId = await addNation(sb, {
      suffix: "bulk-skip",
      abbreviation: "BS",
    });
    const fd = new FormData();
    fd.set(
      "paste",
      [
        `OnlyTwo, parts`, // fewer than 3 parts → skipped
        `Bad Nation, PPP 555, Atlantis`, // unknown nation → skipped
        `Good City, QQQ 666, BS`, // valid → inserted
      ].join("\n")
    );

    await bulkCreateCities(fd);

    const { data } = await sb
      .from("cities")
      .select("name, code, nation_id")
      .eq("nation_id", nationId);
    expect(data).toEqual([
      { name: "Good City", code: "QQQ 666", nation_id: nationId },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/cities");

    await sb.from("cities").delete().eq("nation_id", nationId);
  });

  it("should no-op (and skip the insert + revalidate) when no lines resolve", async () => {
    const nationId = await addNation(sb, {
      suffix: "bulk-noop",
      abbreviation: "BX",
    });
    const fd = new FormData();
    fd.set("paste", `Bad, RRR 777, Unknown\nAlso, SSS 888, AlsoUnknown`);

    await bulkCreateCities(fd);

    const { count } = await sb
      .from("cities")
      .select("id", { count: "exact", head: true })
      .eq("nation_id", nationId);
    expect(count).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should no-op when the paste is empty", async () => {
    const fd = new FormData();
    fd.set("paste", "   ");

    await bulkCreateCities(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteCity", () => {
  it("should delete the row and revalidate /cities", async () => {
    const nationId = await addNation(sb, { suffix: "del", abbreviation: "DL" });
    const cityId = await addCity(sb, { suffix: "del", nationId, code: "TTT 999" });

    const fd = new FormData();
    fd.set("id", cityId);
    await deleteCity(fd);

    const { data } = await sb
      .from("cities")
      .select("id")
      .eq("id", cityId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/cities");
  });

  it("should no-op when no id is provided", async () => {
    const fd = new FormData();

    await deleteCity(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
