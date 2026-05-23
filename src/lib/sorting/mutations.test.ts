/**
 * Unit tests for applySlotObservation.
 *
 * These tests use a stubbed Supabase client — no local Supabase stack needed.
 * Integration tests (requiring `supabase start`) are deferred; the helper is
 * best exercised there against a seeded `playthrough_slot_state` table.
 *
 * Testing policy: docs/testing-protocol.md
 *   - Mock at the system boundary (the Supabase client).
 *   - Trust our own logic; don't test framework internals.
 */

import { describe, it, expect, vi } from "vitest";
import { applySlotObservation } from "./mutations";
import type { SupabaseClient } from "./mutations";

// ---------------------------------------------------------------------------
// Query chain stub
// ---------------------------------------------------------------------------

type Resp = { data: unknown; error: null | { message: string } };

/**
 * Returns a chainable query builder that resolves to `resp` when awaited, or
 * when any terminal method (.maybeSingle(), .single()) is called. `.in()` can
 * be given a separate `inResp` for batch lookups.
 *
 * Mirrors the Supabase PostgREST builder: every chained call returns a new
 * thenable so you can `await client.from(t).select(...).eq(...)` directly.
 */
function q(resp: Resp, inResp?: Resp): Record<string, unknown> {
  const ir = inResp ?? resp;
  const self: Record<string, unknown> = {};
  // Thenable — so `await q(...)` or `const { data } = await q(...).select().eq()` works.
  self.then = (resolve: (v: Resp) => void) =>
    Promise.resolve(resp).then(resolve);
  self.catch = (fn: (e: unknown) => void) => Promise.resolve(resp).catch(fn);
  self.finally = (fn: () => void) => Promise.resolve(resp).finally(fn);
  // Chainable — each returns a fresh thenable with the same resp.
  self.select = () => q(resp, ir);
  self.eq = () => q(resp, ir);
  self.order = () => q(resp, ir);
  // Terminals.
  self.maybeSingle = () => Promise.resolve(resp);
  self.single = () => Promise.resolve(resp);
  self.in = () => Promise.resolve(ir);
  self.upsert = () => Promise.resolve({ data: null, error: null });
  return self;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PLAYTHROUGH_ID = "pt-1";
const SLOT_ID = 3;
const PAYLOAD = "SL000042";
const PHYS_LETTER_ID = "pl-1";
const SORTING_LETTER_ID = "sl-1";
const RULE_ID = "rule-1";
const DAY_ID = "day-1";

const BASE_DAY = { id: DAY_ID, number: 1, day_of_week: "monday" };

function basePlaythrough(phase = "sorting") {
  return { id: PLAYTHROUGH_ID, current_day_id: DAY_ID, current_phase: phase };
}

function basePhysLetter(contentRefType = "sorting") {
  return {
    id: PHYS_LETTER_ID,
    content_ref_type: contentRefType,
    content_ref_id: SORTING_LETTER_ID,
  };
}

function baseSortingLetterView() {
  return {
    id: SORTING_LETTER_ID,
    is_counterfeit: false,
    sender_name: "Alice Smith",
    sender_citizen_id: "12345",
    sender_city_name: "Folos City",
    sender_city_code: "FC",
    sender_nation_id: "nation-folos",
    recipient_name: "Bob Jones",
    recipient_citizen_id: "67890",
    recipient_city_name: "Emberlyn",
    recipient_city_code: "EM",
    recipient_nation_id: "nation-emberlyn",
    day_id: DAY_ID,
  };
}

function baseRule() {
  return {
    id: RULE_ID,
    match_mode: "all",
    day_implemented_id: DAY_ID,
    day_cancelled_id: null,
    destination_slot: SLOT_ID,
  };
}

/**
 * Builds a from() dispatcher. `table → query chain` mapping. Tables not in
 * the map return an empty-result chain by default.
 */
function makeFrom(
  map: Record<string, Record<string, unknown>>
): (table: string) => Record<string, unknown> {
  return (table) => map[table] ?? q({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applySlotObservation", () => {
  // -------------------------------------------------------------------------
  // no_playthrough
  // -------------------------------------------------------------------------
  describe("when the playthrough is not found", () => {
    it("should return errorCode 'no_playthrough' without writing anything", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const client: SupabaseClient = {
        from: makeFrom({
          playthroughs: q({ data: null, error: null }),
          // If any other table is hit, upsert would be called — catch that.
          playthrough_slot_state: { upsert: upsertSpy } as Record<string, unknown>,
        }),
      } as unknown as SupabaseClient;

      const result = await applySlotObservation(client, {
        playthroughId: "pt-missing",
        slotId: SLOT_ID,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBe("no_playthrough");
      expect(result.physicalLetterId).toBeNull();
      expect(result.passed).toBeNull();
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // unknown_slot
  // -------------------------------------------------------------------------
  describe("when the slot_id is not in the slots table", () => {
    it("should return errorCode 'unknown_slot'", async () => {
      const client: SupabaseClient = {
        from: makeFrom({
          playthroughs: q({ data: basePlaythrough(), error: null }),
          slots: q({ data: null, error: null }), // not found
        }),
      } as unknown as SupabaseClient;

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: 99,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBe("unknown_slot");
      expect(result.physicalLetterId).toBeNull();
      expect(result.passed).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // unknown_payload
  // -------------------------------------------------------------------------
  describe("when the RFID payload is not found in physical_letters", () => {
    it("should return errorCode 'unknown_payload' with null physicalLetterId", async () => {
      const client: SupabaseClient = {
        from: makeFrom({
          playthroughs: q({ data: basePlaythrough(), error: null }),
          slots: q({ data: { slot_id: SLOT_ID, role: "sorting" }, error: null }),
          physical_letters: q({ data: null, error: null }), // not found
          playthrough_slot_state: q({ data: null, error: null }),
        }),
      } as unknown as SupabaseClient;

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: SLOT_ID,
        payload: "SL999999",
      });

      expect(result.errorCode).toBe("unknown_payload");
      expect(result.physicalLetterId).toBeNull();
      expect(result.passed).toBeNull();
      expect(result.evaluatedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // wrong_phase — sorting phase + sorting slot + inspection letter
  // -------------------------------------------------------------------------
  describe("when an inspection letter is dropped in a sorting slot during sorting phase", () => {
    it("should return errorCode 'wrong_phase' and persist with passed = null", async () => {
      const client: SupabaseClient = {
        from: makeFrom({
          playthroughs: q({ data: basePlaythrough("sorting"), error: null }),
          slots: q({ data: { slot_id: SLOT_ID, role: "sorting" }, error: null }),
          physical_letters: q({ data: basePhysLetter("inspection"), error: null }),
          playthrough_slot_state: q({ data: null, error: null }),
        }),
      } as unknown as SupabaseClient;

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: SLOT_ID,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBe("wrong_phase");
      expect(result.physicalLetterId).toBe(PHYS_LETTER_ID);
      expect(result.passed).toBeNull();
      expect(result.evaluatedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // no_rule
  // -------------------------------------------------------------------------
  describe("when there is no active sorting rule for the slot on the current day", () => {
    it("should return errorCode 'no_rule' and persist with passed = null", async () => {
      // Rule implemented on day 2; current day is day 1 → not yet active.
      const futureRule = { ...baseRule(), day_implemented_id: "day-2" };
      const day2 = { id: "day-2", number: 2, day_of_week: "tuesday" };

      const client: SupabaseClient = {
        from: makeFrom({
          playthroughs: q({ data: basePlaythrough("sorting"), error: null }),
          slots: q({ data: { slot_id: SLOT_ID, role: "sorting" }, error: null }),
          physical_letters: q({ data: basePhysLetter("sorting"), error: null }),
          sorting_rules: q({ data: [futureRule], error: null }),
          // days: maybeSingle → BASE_DAY; .in() → both days (for number lookup).
          days: q(
            { data: BASE_DAY, error: null },
            { data: [BASE_DAY, day2], error: null }
          ),
          playthrough_slot_state: q({ data: null, error: null }),
        }),
      } as unknown as SupabaseClient;

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: SLOT_ID,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBe("no_rule");
      expect(result.physicalLetterId).toBe(PHYS_LETTER_ID);
      expect(result.passed).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // happy path — evaluates rule and persists pass/fail
  // -------------------------------------------------------------------------
  describe("happy path: sorting phase, sorting slot, sorting letter, active rule", () => {
    /**
     * Builds the full client for the happy path with the given condition.
     * `upsertSpy` is called when playthrough_slot_state is written.
     */
    function makeHappyClient(
      condition: {
        target: string;
        target_slice: string;
        operator: string;
        reference_value: string;
        reference_type: string;
      },
      upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
    ): SupabaseClient {
      const nations = [
        { id: "nation-folos", name: "Folos" },
        { id: "nation-emberlyn", name: "Emberlyn" },
      ];
      return {
        from: makeFrom({
          playthroughs: q({ data: basePlaythrough("sorting"), error: null }),
          slots: q({ data: { slot_id: SLOT_ID, role: "sorting" }, error: null }),
          physical_letters: q({ data: basePhysLetter("sorting"), error: null }),
          sorting_rules: q({ data: [baseRule()], error: null }),
          days: q(
            { data: BASE_DAY, error: null },
            { data: [BASE_DAY], error: null }
          ),
          sorting_rule_conditions: q({ data: [condition], error: null }),
          sorting_letters_view: q({ data: baseSortingLetterView(), error: null }),
          nations: q({ data: null, error: null }, { data: nations, error: null }),
          playthrough_slot_state: { upsert: upsertSpy } as Record<string, unknown>,
        }),
      } as unknown as SupabaseClient;
    }

    it("should evaluate the rule, return passed=true, set evaluatedAt, write upsert", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      // Condition: sender_name equals "Alice Smith" → fixture has exactly that.
      const client = makeHappyClient(
        {
          target: "sender_name",
          target_slice: "whole",
          operator: "equals",
          reference_value: "Alice Smith",
          reference_type: "string",
        },
        upsertSpy
      );

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: SLOT_ID,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBeNull();
      expect(result.physicalLetterId).toBe(PHYS_LETTER_ID);
      expect(result.passed).toBe(true);
      expect(result.evaluatedAt).not.toBeNull();
      expect(upsertSpy).toHaveBeenCalledOnce();
      // Confirm the upsert row carries the correct pass result.
      const row = upsertSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(row.passed).toBe(true);
      expect(row.error_code).toBeNull();
    });

    it("should return passed=false when the condition does not match", async () => {
      const client = makeHappyClient({
        target: "sender_name",
        target_slice: "whole",
        operator: "equals",
        reference_value: "Not Alice",
        reference_type: "string",
      });

      const result = await applySlotObservation(client, {
        playthroughId: PLAYTHROUGH_ID,
        slotId: SLOT_ID,
        payload: PAYLOAD,
      });

      expect(result.errorCode).toBeNull();
      expect(result.passed).toBe(false);
    });
  });
});
