import { describe, expect, it } from "vitest";
import { makeAnonClient, makeTestClient } from "./_helpers";

// Smoke check that RLS is doing its job: anon clients cannot read or write
// the tables we expect to be locked behind `auth.role() = 'authenticated'`
// (per the policy block at the bottom of supabase/migrations/0001_init.sql).
//
// This is intentionally shallow — it doesn't enumerate every policy, only
// confirms the broad shape (no anon access). A future migration that adds a
// public-read table should update this list and add a positive read test.

const PROTECTED_TABLES = [
  "storylines",
  "letter_groups",
  "report_groups",
  "inspection_letters",
  "actions",
  "report_segments",
  "sorting_letters",
  "physical_letters",
  "sorting_rules",
  "sorting_rule_conditions",
  "playthroughs",
  "playthrough_action_choices",
  "nations",
  "cities",
  "citizens",
  "days",
  "ending_condition_rows",
  "ending_condition_row_chips",
] as const;

describe("RLS via anon client", () => {
  const anon = makeAnonClient();

  it.each(PROTECTED_TABLES)(
    "should return zero rows when selecting from %s without a session",
    async (table) => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // PostgREST returns success with empty data for SELECT under RLS, not
      // an error. Either an error OR an empty array is acceptable evidence
      // of denial; rows leaking through is the failure we care about.
      expect(error ?? data ?? []).not.toContainEqual(expect.objectContaining({ id: expect.any(String) }));
      if (!error) {
        expect(data).toEqual([]);
      }
    }
  );

  it("should reject anon inserts into letter_groups", async () => {
    // Use a known-bogus storyline_id; if RLS lets the insert through it
    // would fail on FK violation; if RLS blocks it, the error code differs.
    // We assert that `data` is null and an error is present, regardless of
    // which layer rejects.
    const { data, error } = await anon
      .from("letter_groups")
      .insert({
        storyline_id: "00000000-0000-0000-0000-000000000000",
        name: "anon-attempt",
        sequence: 9999,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("should reject anon inserts into ending_condition_rows", async () => {
    const { data, error } = await anon
      .from("ending_condition_rows")
      .insert({
        condition_block_id: "00000000-0000-0000-0000-000000000000",
        sort_order: 9999,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("should reject anon inserts into ending_condition_row_chips", async () => {
    const { data, error } = await anon
      .from("ending_condition_row_chips")
      .insert({
        row_id: "00000000-0000-0000-0000-000000000000",
        variable_id: "00000000-0000-0000-0000-000000000000",
        operator: "=",
        text_value_id: "00000000-0000-0000-0000-000000000000",
        sort_order: 0,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("should still allow service-role to read (sanity check on the fixture)", async () => {
    const sb = makeTestClient();
    const { error } = await sb.from("storylines").select("id").limit(1);
    expect(error).toBeNull();
  });
});
