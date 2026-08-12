import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addCitizen,
  addCity,
  addDay,
  addNation,
  addRule,
  addRuleCondition,
  addSortingLetter,
  cleanupReferenceData,
  cleanupSortingRules,
  cleanupTestData,
  makeTestClient,
  testName,
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
import {
  bulkApplyRuleToLetters,
  bulkDeleteSortingLetters,
  bulkPatchSortingLetters,
  bulkSetSortingLetterDay,
  createSortingLetter,
  deleteSortingLetter,
  generateSortingLetters,
  lowestFreeSortId,
  patchSortingLetter,
  renumberSortingLetters,
} from "./actions";

describe("createSortingLetter", () => {
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

  it("should insert a full/full sorting letter on the given day and revalidate", async () => {
    const dayId = await addDay(sb, { suffix: "create-day", number: 9301 });

    const { id } = await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("id, day_id, sort_id, recipient_type, sender_type, stamp_valid")
      .eq("day_id", dayId);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id,
      day_id: dayId,
      sort_id: 0,
      recipient_type: "full",
      sender_type: "full",
      // A new letter carries a valid stamp until an author says otherwise.
      stamp_valid: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should fill the lowest free sort_id rather than appending", async () => {
    const dayId = await addDay(sb, { suffix: "create-nextslot", number: 9303 });
    // Slots 0 and 2 are taken; the gap at 1 is what "lowest open ID" means.
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 2 });

    await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 1, 2]);
  });

  it("should allocate sort_id 0 on an empty day", async () => {
    const dayId = await addDay(sb, { suffix: "create-empty", number: 9304 });

    await createSortingLetter({ dayId });

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .single();

    expect(data?.sort_id).toBe(0);
  });

  it("should fall back to the first day when none is given", async () => {
    const dayId = await addDay(sb, { suffix: "create-firstday", number: 1 });

    const { id } = await createSortingLetter();

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id")
      .eq("id", id)
      .single();

    expect(data?.day_id).toBe(dayId);
  });
});

describe("lowestFreeSortId", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should return 0 for a day with no letters", async () => {
    const dayId = await addDay(sb, { suffix: "free-empty", number: 9306 });
    expect(await lowestFreeSortId(dayId)).toBe(0);
  });

  it("should return the first gap, not the next-highest", async () => {
    const dayId = await addDay(sb, { suffix: "free-gap", number: 9307 });
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 1 });
    await addSortingLetter(sb, { dayId, sortId: 3 });

    expect(await lowestFreeSortId(dayId)).toBe(2);
  });
});

describe("deleteSortingLetter", () => {
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

  it("should delete the row and revalidate the surfaces that show it", async () => {
    const dayId = await addDay(sb, { suffix: "delete-row", number: 9331 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter(letterId);

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/physical");
  });

  it("should no-op when the id is missing", async () => {
    const dayId = await addDay(sb, { suffix: "delete-noid", number: 9332 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await deleteSortingLetter("");

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("id", letterId);

    expect(data).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw on a malformed letter id", async () => {
    await expect(deleteSortingLetter("not-a-uuid")).rejects.toThrow();
  });
});

describe("patchSortingLetter", () => {
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

  it("should apply a narrow field patch without calling revalidatePath", async () => {
    const dayId = await addDay(sb, { suffix: "patch-field", number: 9341 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    await patchSortingLetter(letterId, {
      recipient_name: "Patched Name",
      stamp_valid: true,
    });

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_name, stamp_valid, sender_name")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      recipient_name: "Patched Name",
      stamp_valid: true,
      sender_name: null,
    });
    // Instant-save contract: realtime fans the change out, no revalidation.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should patch the address type only, leaving other columns untouched", async () => {
    const dayId = await addDay(sb, { suffix: "patch-type", number: 9342 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });
    await sb
      .from("sorting_letters")
      .update({ recipient_name: "Keep Me" })
      .eq("id", letterId);

    await patchSortingLetter(letterId, { recipient_type: "lookup_3" });

    const { data } = await sb
      .from("sorting_letters")
      .select("recipient_type, recipient_name")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      recipient_type: "lookup_3",
      recipient_name: "Keep Me",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should throw when the patch violates the sort_id check constraint", async () => {
    const dayId = await addDay(sb, { suffix: "patch-badsort", number: 9343 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    // sort_id is constrained to 0..99 — 200 trips the CHECK.
    await expect(
      patchSortingLetter(letterId, { sort_id: 200 })
    ).rejects.toThrow();

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("bulkPatchSortingLetters", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
  });

  it("should set the stamp on every selected letter", async () => {
    const dayId = await addDay(sb, { suffix: "bulk-stamp", number: 9351 });
    const a = await addSortingLetter(sb, { dayId, sortId: 0 });
    const b = await addSortingLetter(sb, { dayId, sortId: 1 });

    await bulkPatchSortingLetters([a, b], { kind: "stamp", value: false });

    const { data } = await sb
      .from("sorting_letters")
      .select("stamp_valid")
      .in("id", [a, b]);

    expect(data?.every((r) => r.stamp_valid === false)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
  });

  it("should leave unselected letters alone", async () => {
    const dayId = await addDay(sb, { suffix: "bulk-scope", number: 9352 });
    const selected = await addSortingLetter(sb, { dayId, sortId: 0 });
    const other = await addSortingLetter(sb, { dayId, sortId: 1 });

    await bulkPatchSortingLetters([selected], { kind: "storage", value: "Bin 9" });

    const { data } = await sb
      .from("sorting_letters")
      .select("storage_location")
      .eq("id", other)
      .single();

    expect(data?.storage_location).toBeNull();
  });

  it("should fill a whole address side when given a citizen", async () => {
    const dayId = await addDay(sb, { suffix: "bulk-sender", number: 9353 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });
    const nationId = await addNation(sb, { suffix: "bulk-nation" });
    const cityId = await addCity(sb, { suffix: "bulk-city", nationId, code: "BK" });
    const citizenId = await addCitizen(sb, {
      suffix: "bulk-citizen",
      firstName: "Grace",
      cityId,
      nationId,
      citizenId: "A1B2",
    });

    await bulkPatchSortingLetters([letterId], { kind: "sender", citizenId });

    const { data } = await sb
      .from("sorting_letters")
      .select(
        "sender_citizen_id, sender_name, sender_citizen_number, sender_city_id, sender_city_code, sender_nation_id"
      )
      .eq("id", letterId)
      .single();

    expect(data).toMatchObject({
      sender_citizen_id: citizenId,
      sender_citizen_number: "#A1B2",
      sender_city_id: cityId,
      sender_city_code: "BK",
      sender_nation_id: nationId,
    });
    expect(data?.sender_name).toContain("Grace");
  });

  it("should empty the whole side when clearing a sender", async () => {
    const dayId = await addDay(sb, { suffix: "bulk-clear", number: 9354 });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });
    await sb
      .from("sorting_letters")
      .update({ sender_name: "Someone", sender_citizen_number: "#Z9Z9" })
      .eq("id", letterId);

    await bulkPatchSortingLetters([letterId], { kind: "sender", citizenId: null });

    const { data } = await sb
      .from("sorting_letters")
      .select("sender_name, sender_citizen_number, sender_citizen_id")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({
      sender_name: null,
      sender_citizen_number: null,
      sender_citizen_id: null,
    });
  });

  it("should no-op on an empty selection", async () => {
    await bulkPatchSortingLetters([], { kind: "stamp", value: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("bulkSetSortingLetterDay", () => {
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

  it("should keep the letter's ID when the target day has it free", async () => {
    const from = await addDay(sb, { suffix: "move-from", number: 9361 });
    const to = await addDay(sb, { suffix: "move-to", number: 9362 });
    const letterId = await addSortingLetter(sb, { dayId: from, sortId: 4 });

    await bulkSetSortingLetterDay([letterId], to);

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id, sort_id")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({ day_id: to, sort_id: 4 });
  });

  it("should re-ID onto the lowest free slot when the ID is taken", async () => {
    const from = await addDay(sb, { suffix: "collide-from", number: 9363 });
    const to = await addDay(sb, { suffix: "collide-to", number: 9364 });
    await addSortingLetter(sb, { dayId: to, sortId: 0 });
    await addSortingLetter(sb, { dayId: to, sortId: 2 });
    const letterId = await addSortingLetter(sb, { dayId: from, sortId: 0 });

    await bulkSetSortingLetterDay([letterId], to);

    const { data } = await sb
      .from("sorting_letters")
      .select("day_id, sort_id")
      .eq("id", letterId)
      .single();

    expect(data).toEqual({ day_id: to, sort_id: 1 });
  });

  it("should not hand an incoming letter a slot a selected letter already holds", async () => {
    const from = await addDay(sb, { suffix: "mixed-from", number: 9367 });
    const to = await addDay(sb, { suffix: "mixed-to", number: 9368 });
    // The selection spans both days and both letters sit at ID 5. The one
    // already on the target day doesn't move, so the incoming one must not be
    // offered slot 5. The incoming letter is inserted first so it is also
    // processed first — that is the order in which the slot it wants is still
    // physically occupied.
    const incoming = await addSortingLetter(sb, { dayId: from, sortId: 5 });
    const staying = await addSortingLetter(sb, { dayId: to, sortId: 5 });

    await bulkSetSortingLetterDay([staying, incoming], to);

    const { data } = await sb
      .from("sorting_letters")
      .select("id, sort_id")
      .eq("day_id", to)
      .order("sort_id");

    expect(data).toEqual([
      { id: incoming, sort_id: 0 },
      { id: staying, sort_id: 5 },
    ]);
  });

  it("should move several letters without collliding with each other", async () => {
    const from = await addDay(sb, { suffix: "multi-from", number: 9365 });
    const to = await addDay(sb, { suffix: "multi-to", number: 9366 });
    await addSortingLetter(sb, { dayId: to, sortId: 0 });
    const a = await addSortingLetter(sb, { dayId: from, sortId: 0 });
    const b = await addSortingLetter(sb, { dayId: from, sortId: 1 });

    await bulkSetSortingLetterDay([a, b], to);

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", to)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 1, 2]);
  });
});

describe("renumberSortingLetters", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should close gaps while preserving order", async () => {
    const dayId = await addDay(sb, { suffix: "renumber", number: 9371 });
    const a = await addSortingLetter(sb, { dayId, sortId: 2 });
    const b = await addSortingLetter(sb, { dayId, sortId: 5 });
    const c = await addSortingLetter(sb, { dayId, sortId: 9 });

    await renumberSortingLetters(dayId);

    const { data } = await sb
      .from("sorting_letters")
      .select("id, sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data).toEqual([
      { id: a, sort_id: 0 },
      { id: b, sort_id: 1 },
      { id: c, sort_id: 2 },
    ]);
  });

  it("should leave an already-compact day untouched", async () => {
    const dayId = await addDay(sb, { suffix: "renumber-noop", number: 9372 });
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 1 });

    await renumberSortingLetters(dayId);

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 1]);
  });
});

describe("bulkDeleteSortingLetters", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
  });

  it("should delete only the selected letters", async () => {
    const dayId = await addDay(sb, { suffix: "bulk-delete", number: 9381 });
    const a = await addSortingLetter(sb, { dayId, sortId: 0 });
    const b = await addSortingLetter(sb, { dayId, sortId: 1 });
    const keep = await addSortingLetter(sb, { dayId, sortId: 2 });

    await bulkDeleteSortingLetters([a, b]);

    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("day_id", dayId);

    expect(data).toEqual([{ id: keep }]);
  });
});

describe("generateSortingLetters", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
    await cleanupSortingRules(sb);
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
    await cleanupSortingRules(sb);
  });

  /** A day, a rule keyed on the sender's last name, and citizens to draw from. */
  async function seedGeneratable(opts: { number: number; suffix: string }) {
    const dayId = await addDay(sb, { suffix: opts.suffix, number: opts.number });
    const ruleId = await addRule(sb, {
      letter: "A",
      dayImplementedId: dayId,
      destinationSlot: 3,
    });
    await addRuleCondition(sb, {
      ruleId,
      target: "sender_last_name",
      operator: "equals",
      referenceType: "string",
      referenceValue: testName(`${opts.suffix}-sender`),
    });
    // One citizen matches the rule's sender condition; the rest are filler the
    // planner can use as recipients.
    await addCitizen(sb, { suffix: `${opts.suffix}-sender`, firstName: "Grace" });
    await addCitizen(sb, { suffix: `${opts.suffix}-other-1`, firstName: "Ada" });
    await addCitizen(sb, { suffix: `${opts.suffix}-other-2`, firstName: "Alan" });
    return { dayId, ruleId };
  }

  it("should create letters that sort to the requested rule", async () => {
    const { dayId, ruleId } = await seedGeneratable({
      number: 9391,
      suffix: "gen-ok",
    });

    const result = await generateSortingLetters({
      dayId,
      requests: [{ ruleId, count: 2 }],
    });

    expect(result).toMatchObject({ created: 2, requested: 2 });
    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id, sender_name, sender_citizen_id, recipient_citizen_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data).toHaveLength(2);
    expect(data?.map((r) => r.sort_id)).toEqual([0, 1]);
    for (const row of data ?? []) {
      expect(row.sender_name).toContain(testName("gen-ok-sender"));
      expect(row.sender_citizen_id).not.toBeNull();
      expect(row.recipient_citizen_id).not.toBeNull();
    }
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/letters");
  });

  it("should fill the gaps left by existing letters", async () => {
    const { dayId, ruleId } = await seedGeneratable({
      number: 9392,
      suffix: "gen-gap",
    });
    await addSortingLetter(sb, { dayId, sortId: 0 });
    await addSortingLetter(sb, { dayId, sortId: 2 });

    await generateSortingLetters({ dayId, requests: [{ ruleId, count: 1 }] });

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id")
      .eq("day_id", dayId)
      .order("sort_id");

    expect(data?.map((r) => r.sort_id)).toEqual([0, 1, 2]);
  });

  it("should generate per rule in one pass, reporting each separately", async () => {
    const dayId = await addDay(sb, { suffix: "gen-multi", number: 9394 });
    // Two rules on the same day, each keyed on a different sender surname.
    const ruleA = await addRule(sb, {
      letter: "A",
      dayImplementedId: dayId,
      destinationSlot: 1,
    });
    await addRuleCondition(sb, {
      ruleId: ruleA,
      target: "sender_last_name",
      operator: "equals",
      referenceType: "string",
      referenceValue: testName("gen-multi-a"),
    });
    const ruleB = await addRule(sb, {
      letter: "B",
      dayImplementedId: dayId,
      destinationSlot: 2,
    });
    await addRuleCondition(sb, {
      ruleId: ruleB,
      target: "sender_last_name",
      operator: "equals",
      referenceType: "string",
      referenceValue: testName("gen-multi-b"),
    });
    await addCitizen(sb, { suffix: "gen-multi-a", firstName: "Grace" });
    await addCitizen(sb, { suffix: "gen-multi-b", firstName: "Ada" });
    await addCitizen(sb, { suffix: "gen-multi-filler", firstName: "Alan" });

    const result = await generateSortingLetters({
      dayId,
      requests: [
        { ruleId: ruleA, count: 2 },
        { ruleId: ruleB, count: 1 },
      ],
    });

    expect(result).toMatchObject({ created: 3, requested: 3 });
    expect(result.perRule.map((r) => [r.ruleLetter, r.created])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);

    const { data } = await sb
      .from("sorting_letters")
      .select("sort_id, sender_name")
      .eq("day_id", dayId)
      .order("sort_id");

    // IDs are handed out across the whole batch, not restarted per rule.
    expect(data?.map((r) => r.sort_id)).toEqual([0, 1, 2]);
    const surnames = (data ?? []).map((r) => String(r.sender_name));
    expect(surnames.filter((n) => n.includes(testName("gen-multi-a")))).toHaveLength(2);
    expect(surnames.filter((n) => n.includes(testName("gen-multi-b")))).toHaveLength(1);
  });

  it("should skip a rule asked for zero letters", async () => {
    const { dayId, ruleId } = await seedGeneratable({
      number: 9395,
      suffix: "gen-zero",
    });

    const result = await generateSortingLetters({
      dayId,
      requests: [{ ruleId, count: 0 }],
    });

    expect(result).toMatchObject({ created: 0, requested: 0, perRule: [] });
    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("day_id", dayId);
    expect(data).toHaveLength(0);
  });

  it("should report why nothing could be generated", async () => {
    const dayId = await addDay(sb, { suffix: "gen-impossible", number: 9393 });
    const ruleId = await addRule(sb, {
      letter: "B",
      dayImplementedId: dayId,
      destinationSlot: 1,
    });
    await addRuleCondition(sb, {
      ruleId,
      target: "sender_last_name",
      operator: "equals",
      referenceType: "string",
      referenceValue: "NobodyHasThisName",
    });
    await addCitizen(sb, { suffix: "gen-impossible-1", firstName: "Ada" });

    const result = await generateSortingLetters({
      dayId,
      requests: [{ ruleId, count: 3 }],
    });

    expect(result.created).toBe(0);
    expect(result.perRule[0].reason).toMatch(/no citizen satisfies/i);
    const { data } = await sb
      .from("sorting_letters")
      .select("id")
      .eq("day_id", dayId);
    expect(data).toHaveLength(0);
  });
});

describe("bulkApplyRuleToLetters", () => {
  const sb = makeTestClient();

  beforeAll(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
    await cleanupSortingRules(sb);
  });

  afterEach(async () => {
    await cleanupTestData(sb);
    await cleanupReferenceData(sb);
    await cleanupSortingRules(sb);
  });

  it("should rewrite senders so the letters sort to the rule", async () => {
    const dayId = await addDay(sb, { suffix: "apply-rule", number: 9401 });
    const ruleId = await addRule(sb, {
      letter: "A",
      dayImplementedId: dayId,
      destinationSlot: 2,
    });
    await addRuleCondition(sb, {
      ruleId,
      target: "sender_last_name",
      operator: "equals",
      referenceType: "string",
      referenceValue: testName("apply-sender"),
    });
    await addCitizen(sb, { suffix: "apply-sender", firstName: "Grace" });
    await addCitizen(sb, { suffix: "apply-other", firstName: "Ada" });
    const letterId = await addSortingLetter(sb, { dayId, sortId: 0 });

    const result = await bulkApplyRuleToLetters([letterId], ruleId);

    expect(result).toMatchObject({ updated: 1, requested: 1 });
    const { data } = await sb
      .from("sorting_letters")
      .select("sender_name, sort_id")
      .eq("id", letterId)
      .single();

    expect(data?.sender_name).toContain(testName("apply-sender"));
    // The letter keeps its place in the day — only the address is rewritten.
    expect(data?.sort_id).toBe(0);
  });

  it("should refuse a selection spanning two days", async () => {
    const dayA = await addDay(sb, { suffix: "apply-day-a", number: 9402 });
    const dayB = await addDay(sb, { suffix: "apply-day-b", number: 9403 });
    const ruleId = await addRule(sb, { letter: "C", destinationSlot: 1 });
    await addRuleCondition(sb, { ruleId });
    const a = await addSortingLetter(sb, { dayId: dayA, sortId: 0 });
    const b = await addSortingLetter(sb, { dayId: dayB, sortId: 0 });

    await expect(bulkApplyRuleToLetters([a, b], ruleId)).rejects.toThrow(
      /single day/i
    );
  });
});
