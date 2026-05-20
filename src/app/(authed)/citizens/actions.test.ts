import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addCitizen,
  addCity,
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
  bulkCreateCitizens,
  createCitizen,
  deleteCitizen,
  patchCitizen,
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
  // `createCitizen` inserts a blank row (last_name = "") that the marker-based
  // cleanup above can't catch. Sweep any leftover blank-named, type='npc' rows.
  await sb.from("citizens").delete().eq("first_name", "").eq("last_name", "");
});

describe("patchCitizen", () => {
  it("should apply the patch and NOT call revalidatePath (instant-save contract)", async () => {
    const citizenId = await addCitizen(sb, {
      suffix: "patch-basic",
      firstName: "Original",
    });

    await patchCitizen(citizenId, {
      first_name: "Patched",
      address_line: "12 Main St",
    });

    const { data } = await sb
      .from("citizens")
      .select("first_name, last_name, address_line")
      .eq("id", citizenId)
      .single();
    expect(data).toEqual({
      first_name: "Patched",
      last_name: testName("patch-basic"),
      address_line: "12 Main St",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should patch the citizen's own (unique) citizen_id", async () => {
    // `citizens.citizen_id` is each citizen's own unique identifier
    // (formatted per `src/lib/citizen-id.ts`). Round-tripping a patch on
    // it guards the contract used by the inspector's identity field.
    const citizenId = await addCitizen(sb, { suffix: "patch-cid" });

    await patchCitizen(citizenId, { citizen_id: "#A1234" });

    const { data } = await sb
      .from("citizens")
      .select("citizen_id")
      .eq("id", citizenId)
      .single();
    expect(data?.citizen_id).toBe("#A1234");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw when the patch contains an invalid column value", async () => {
    const citizenId = await addCitizen(sb, { suffix: "patch-bad" });

    // `type` is a CitizenType enum at the DB level — passing nonsense forces a
    // Postgres error that the action surfaces as a thrown Error.
    await expect(
      patchCitizen(citizenId, {
        type: "not-a-real-type" as never,
      })
    ).rejects.toThrow();
  });
});

describe("createCitizen", () => {
  it("should insert a blank npc citizen and return the new row", async () => {
    const before = await sb
      .from("citizens")
      .select("id", { count: "exact", head: true });
    const beforeCount = before.count ?? 0;

    const created = await createCitizen();

    expect(created.type).toBe("npc");
    expect(created.first_name).toBe("");
    expect(created.last_name).toBe("");
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    const after = await sb
      .from("citizens")
      .select("id", { count: "exact", head: true });
    expect((after.count ?? 0) - beforeCount).toBe(1);
    // Editor pins the new row locally; revalidating would re-sort it away.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("bulkCreateCitizens", () => {
  it("should parse pasted rows, auto-resolve city → nation, and revalidate /citizens", async () => {
    const nationId = await addNation(sb, { suffix: "bulk-nation" });
    const cityName = testName("bulk-city");
    const cityId = await addCity(sb, {
      suffix: "bulk-city",
      nationId,
      code: "B11 B22",
    });

    // Three rows:
    //  1) hero, with citizen_id and a matching city → city + nation resolved
    //  2) npc (blank type), with city only → nation auto-filled from city
    //  3) row with a city that doesn't exist → inserted with null city/nation
    // The last-token-into-last_name split means the `__INT_TEST__bulk*` marker
    // ends up on `last_name`, so cleanupReferenceData() can sweep these rows.
    const paste = [
      `hero,First ${testName("bulkA")},#0001,${cityName}`,
      `,Solo ${testName("bulkB")},,${cityName}`,
      `npc,Lone ${testName("bulkC")},,DoesNotExistCity`,
    ].join("\n");

    const fd = new FormData();
    fd.set("paste", paste);

    await bulkCreateCitizens(fd);

    const { data } = await sb
      .from("citizens")
      .select(
        "first_name, last_name, type, citizen_id, city_id, nation_id"
      )
      .like("last_name", `${testName("bulk")}%`)
      .order("last_name");

    expect(data).toEqual([
      {
        first_name: "First",
        last_name: testName("bulkA"),
        type: "hero",
        citizen_id: "#0001",
        city_id: cityId,
        nation_id: nationId,
      },
      {
        first_name: "Solo",
        last_name: testName("bulkB"),
        type: "npc", // blank type defaults to npc
        citizen_id: null,
        city_id: cityId,
        nation_id: nationId, // auto-filled from city
      },
      {
        first_name: "Lone",
        last_name: testName("bulkC"),
        type: "npc",
        citizen_id: null,
        city_id: null, // invalid city → null
        nation_id: null,
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/citizens");
  });

  it("should skip lines with no name and lines with fewer than 2 columns", async () => {
    const paste = [
      "", // empty line → < 2 parts, skipped
      "npc", // only one column, no separators → < 2 parts, skipped
      `npc, ${testName("skipNameless")}`, // 2 parts but blank name → skipped by the no-name guard
      `npc,Real ${testName("skipKept")}`, // valid row — should land
    ].join("\n");

    const fd = new FormData();
    fd.set("paste", paste);

    await bulkCreateCitizens(fd);

    const { data } = await sb
      .from("citizens")
      .select("first_name, last_name")
      .like("last_name", `${testName("skip")}%`);

    expect(data).toEqual([
      { first_name: "Real", last_name: testName("skipKept") },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/citizens");
  });

  it("should no-op (and not revalidate) on empty paste", async () => {
    const fd = new FormData();
    fd.set("paste", "   \n\n  ");

    await bulkCreateCitizens(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should no-op when every parsed row is filtered out (no valid names)", async () => {
    // Two parts present so the `< 2` guard doesn't fire, but the name column
    // is blank so the per-row guard does. Net `rows.length === 0`, no insert.
    const fd = new FormData();
    fd.set("paste", "npc, \nhero, ");

    await bulkCreateCitizens(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteCitizen", () => {
  it("should delete the row and revalidate /citizens", async () => {
    const citizenId = await addCitizen(sb, { suffix: "del-basic" });

    const fd = new FormData();
    fd.set("id", citizenId);
    await deleteCitizen(fd);

    const { data } = await sb
      .from("citizens")
      .select("id")
      .eq("id", citizenId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/citizens");
  });

  it("should no-op when the id form field is missing", async () => {
    const citizenId = await addCitizen(sb, { suffix: "del-noop" });
    const fd = new FormData(); // no `id`

    await deleteCitizen(fd);

    // Row still present.
    const { data } = await sb
      .from("citizens")
      .select("id")
      .eq("id", citizenId)
      .maybeSingle();
    expect(data?.id).toBe(citizenId);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
