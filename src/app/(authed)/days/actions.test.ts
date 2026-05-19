import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addDay,
  addPlaythrough,
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

// Imports of the actions MUST come after the mocks above.
import {
  advanceActivePlaythrough,
  createDay,
  deleteDay,
  updateDay,
} from "./actions";

const sb = makeTestClient();

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

describe("createDay", () => {
  /** createDay does NOT tag the inserted row with __INT_TEST__, so we have to
   *  delete it ourselves to keep the DB clean for sibling specs. */
  async function dropDaysWithIdentifier(identifier: string): Promise<void> {
    await sb.from("days").delete().eq("identifier", identifier);
  }

  it("should insert a day with number = (current max) + 1, revalidate /days, and redirect to the overview", async () => {
    // Seed a test-marked day at a high number to make the new row predictable.
    // seedStoryline always creates dayBase + (days - 1) as the max.
    const seed = await seedStoryline(sb, { suffix: "create-day", days: 1 });
    expect(seed.dayIds.length).toBe(1);

    const { data: maxBefore } = await sb
      .from("days")
      .select("number")
      .order("number", { ascending: false })
      .limit(1)
      .single();
    const expectedNumber = (maxBefore?.number ?? -1) + 1;
    const expectedIdentifier = `D${expectedNumber}`;

    try {
      await createDay();

      const { data: created } = await sb
        .from("days")
        .select("number, identifier")
        .eq("number", expectedNumber)
        .single();

      expect(created?.number).toBe(expectedNumber);
      expect(created?.identifier).toBe(expectedIdentifier);

      expect(revalidatePath).toHaveBeenCalledWith("/days");
      expect(redirect).toHaveBeenCalledWith(
        `/days/${expectedIdentifier.toLowerCase()}/overview`
      );
    } finally {
      await dropDaysWithIdentifier(expectedIdentifier);
    }
  });
});

describe("updateDay", () => {
  it("should apply form fields to the row and revalidate /days as a layout", async () => {
    const dayId = await addDay(sb, { suffix: "update-day", number: 9500 });

    const fd = new FormData();
    fd.set("id", dayId);
    fd.set("notes", "__INT_TEST__update-day"); // keep cleanup marker intact
    fd.set("until_qup", "5");
    fd.set("month", "3");
    fd.set("day_of_month", "14");
    fd.set("year", "2026");
    fd.set("day_of_week", "tuesday");
    fd.set("sort_phase_length_seconds", "90");
    fd.set("inspection_phase_length_seconds", "240");
    fd.set("base_report", "base report body");
    fd.set("report_sign_off", "— TPO");
    fd.set("end_of_day_sign_off", "Goodnight.");

    await updateDay(fd);

    const { data } = await sb
      .from("days")
      .select(
        "until_qup, month, day_of_month, year, day_of_week, sort_phase_length_seconds, inspection_phase_length_seconds, base_report, report_sign_off, end_of_day_sign_off"
      )
      .eq("id", dayId)
      .single();
    expect(data).toEqual({
      until_qup: 5,
      month: 3,
      day_of_month: 14,
      year: 2026,
      day_of_week: "tuesday",
      sort_phase_length_seconds: 90,
      inspection_phase_length_seconds: 240,
      base_report: "base report body",
      report_sign_off: "— TPO",
      end_of_day_sign_off: "Goodnight.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/days", "layout");
  });

  it("should clear nullable fields when the form value is blank", async () => {
    const dayId = await addDay(sb, { suffix: "update-null", number: 9501 });
    // Seed non-null values so we can assert the action nulls them out.
    await sb
      .from("days")
      .update({
        until_qup: 9,
        day_of_week: "monday",
        base_report: "stale-body",
      })
      .eq("id", dayId);

    const fd = new FormData();
    fd.set("id", dayId);
    fd.set("until_qup", "");
    fd.set("day_of_week", "");
    fd.set("base_report", "");

    await updateDay(fd);

    const { data } = await sb
      .from("days")
      .select("until_qup, day_of_week, base_report")
      .eq("id", dayId)
      .single();
    expect(data).toEqual({
      until_qup: null,
      day_of_week: null,
      base_report: null,
    });
  });

  it("should no-op and not revalidate when id is missing", async () => {
    const fd = new FormData();
    fd.set("name", "orphan");

    await updateDay(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteDay", () => {
  it("should delete the row and call redirect('/days')", async () => {
    const dayId = await addDay(sb, { suffix: "delete-day", number: 9600 });

    const fd = new FormData();
    fd.set("id", dayId);
    await deleteDay(fd);

    const { data } = await sb
      .from("days")
      .select("id")
      .eq("id", dayId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(redirect).toHaveBeenCalledWith("/days");
  });

  it("should null out playthroughs.current_day_id (FK ON DELETE SET NULL)", async () => {
    const dayId = await addDay(sb, { suffix: "delete-cascade", number: 9601 });
    const playthroughId = await addPlaythrough(sb, {
      suffix: "delete-cascade",
      currentDayId: dayId,
    });

    const fd = new FormData();
    fd.set("id", dayId);
    await deleteDay(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("current_day_id")
      .eq("id", playthroughId)
      .single();
    expect(data?.current_day_id).toBeNull();
  });

  it("should no-op and not redirect when id is missing", async () => {
    const fd = new FormData();

    await deleteDay(fd);

    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("advanceActivePlaythrough", () => {
  it("should set current_day_id and current_phase on the playthrough and revalidate /days", async () => {
    const dayId = await addDay(sb, { suffix: "advance-set", number: 9700 });
    const playthroughId = await addPlaythrough(sb, { suffix: "advance-set" });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("current_day_id", dayId);
    fd.set("current_phase", "inspection");

    await advanceActivePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("current_day_id, current_phase")
      .eq("id", playthroughId)
      .single();
    expect(data).toEqual({
      current_day_id: dayId,
      current_phase: "inspection",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/days");
  });

  it("should clear current_day_id when the form value is an empty string", async () => {
    const dayId = await addDay(sb, { suffix: "advance-clear", number: 9701 });
    const playthroughId = await addPlaythrough(sb, {
      suffix: "advance-clear",
      currentDayId: dayId,
    });

    const fd = new FormData();
    fd.set("playthrough_id", playthroughId);
    fd.set("current_day_id", "");
    fd.set("current_phase", "top_of_day");

    await advanceActivePlaythrough(fd);

    const { data } = await sb
      .from("playthroughs")
      .select("current_day_id, current_phase")
      .eq("id", playthroughId)
      .single();
    expect(data).toEqual({
      current_day_id: null,
      current_phase: "top_of_day",
    });
  });

  it("should no-op and not revalidate when playthrough_id is missing", async () => {
    const fd = new FormData();
    fd.set("current_phase", "sorting");

    await advanceActivePlaythrough(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
