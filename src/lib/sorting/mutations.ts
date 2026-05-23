/**
 * Client-agnostic domain helper for RFID slot observations.
 *
 * Called by the /api/osc inbound route (service-role client). Accepts a
 * Supabase client so it can also be called from Server Actions when needed.
 * Contains no "use server" directive, no revalidatePath/redirect calls — those
 * stay in the callers.
 *
 * Lookup chain:
 *   payload → physical_letters → content_ref_type/content_ref_id
 *   → sorting_letters_view + nations (for RuleContext)
 *   → sorting_rules + sorting_rule_conditions (for the active slot rule)
 *   → evaluateRule()
 *   → upsert playthrough_slot_state
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { evaluateRule } from "@/lib/rules/evaluate";
import type { RuleCondition, RuleContext } from "@/lib/rules/evaluate";
import type { SortingLetterView } from "@/lib/db/types";
import { splitName } from "@/lib/citizen-name";

// Re-use the same SupabaseClient type shape as playthroughs/mutations.ts.
export type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplySlotObservationInput {
  playthroughId: string;
  slotId: number; // 0 = report (per slots reference table); 1..8 = sorting
  payload: string; // SL###### RFID token
}

export type SlotObservationError =
  | "unknown_payload" // SL###### not in physical_letters
  | "wrong_phase" // content type doesn't match playthrough.current_phase
  | "no_rule" // no sorting rule for this slot on the current day
  | "unknown_slot" // slot_id not in slots reference table
  | "no_playthrough"; // playthrough_id not found

export interface SlotObservationResult {
  physicalLetterId: string | null; // null if payload not found
  passed: boolean | null; // null when not evaluated (wrong phase, no rule, etc.)
  errorCode: SlotObservationError | null;
  evaluatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function applySlotObservation(
  client: SupabaseClient,
  input: ApplySlotObservationInput
): Promise<SlotObservationResult> {
  const { playthroughId, slotId, payload } = input;

  // -------------------------------------------------------------------------
  // Step 1: Resolve playthrough
  // -------------------------------------------------------------------------
  const { data: playthrough, error: ptError } = await client
    .from("playthroughs")
    .select("id, current_day_id, current_phase")
    .eq("id", playthroughId)
    .maybeSingle();
  if (ptError) throw new Error(ptError.message);
  if (!playthrough) {
    return {
      physicalLetterId: null,
      passed: null,
      errorCode: "no_playthrough",
      evaluatedAt: null,
    };
  }

  const currentDayId = playthrough.current_day_id as string | null;
  const currentPhase = playthrough.current_phase as string;

  // -------------------------------------------------------------------------
  // Step 2: Resolve slot role
  // -------------------------------------------------------------------------
  const { data: slot, error: slotError } = await client
    .from("slots")
    .select("role")
    .eq("slot_id", slotId)
    .maybeSingle();
  if (slotError) throw new Error(slotError.message);
  if (!slot) {
    return {
      physicalLetterId: null,
      passed: null,
      errorCode: "unknown_slot",
      evaluatedAt: null,
    };
  }
  const slotRole = slot.role as "report" | "sorting";

  // -------------------------------------------------------------------------
  // Step 3: Resolve payload → physical letter
  // -------------------------------------------------------------------------
  const { data: physLetter, error: plError } = await client
    .from("physical_letters")
    .select("id, content_ref_type, content_ref_id")
    .eq("rfid_payload", payload)
    .maybeSingle();
  if (plError) throw new Error(plError.message);

  if (!physLetter) {
    // Upsert with unknown_payload; no eval.
    const observedAt = new Date().toISOString();
    await _upsertSlotState(client, {
      playthroughId,
      slotId,
      physicalLetterId: null,
      sortingRuleId: null,
      passed: null,
      errorCode: "unknown_payload",
      evaluatedAt: null,
      observedAt,
    });
    return {
      physicalLetterId: null,
      passed: null,
      errorCode: "unknown_payload",
      evaluatedAt: null,
    };
  }

  const physicalLetterId = physLetter.id as string;
  const contentRefType = physLetter.content_ref_type as string;
  const contentRefId = physLetter.content_ref_id as string;

  // -------------------------------------------------------------------------
  // Step 4 / 5: Determine if this is a sorting eval scenario & wrong-phase check.
  //
  // Sorting eval only when:
  //   - current_phase = 'sorting'
  //   - slots.role = 'sorting'
  //   - physical_letter.content_ref_type = 'sorting'
  // -------------------------------------------------------------------------
  const isSortingPhase = currentPhase === "sorting";
  const isSortingSlot = slotRole === "sorting";
  const isSortingLetter = contentRefType === "sorting";

  const shouldEvaluate = isSortingPhase && isSortingSlot && isSortingLetter;

  // Wrong phase: in sorting phase but letter is not a sorting letter.
  const isWrongPhase =
    isSortingPhase && isSortingSlot && !isSortingLetter;

  if (!shouldEvaluate) {
    const errorCode: SlotObservationError | null = isWrongPhase
      ? "wrong_phase"
      : null;
    const observedAt = new Date().toISOString();
    await _upsertSlotState(client, {
      playthroughId,
      slotId,
      physicalLetterId,
      sortingRuleId: null,
      passed: null,
      errorCode,
      evaluatedAt: null,
      observedAt,
    });
    return {
      physicalLetterId,
      passed: null,
      errorCode,
      evaluatedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // Step 6: Resolve sorting rule for this slot on the current day.
  //
  // A rule is active when:
  //   destination_slot = slotId
  //   AND day_implemented_id IS NOT NULL (the rule has been introduced)
  //   AND the implemented day's number <= current day's number
  //   AND (day_cancelled_id IS NULL OR cancelled day number > current day number)
  //
  // Strategy: fetch the current day's number, then join sorting_rules against
  // days to resolve day_implemented_id / day_cancelled_id to numbers.
  // -------------------------------------------------------------------------

  // Fetch the current day number.
  let currentDayNumber: number | null = null;
  if (currentDayId) {
    const { data: dayRow, error: dayError } = await client
      .from("days")
      .select("number")
      .eq("id", currentDayId)
      .maybeSingle();
    if (dayError) throw new Error(dayError.message);
    currentDayNumber = (dayRow?.number as number | null) ?? null;
  }

  // Fetch all rules for this slot along with implemented/cancelled day numbers.
  // We join via sub-selects by fetching the days rows separately to stay within
  // the Supabase PostgREST query model (no arbitrary SQL from the client).
  // Fetch all sorting rules with destination_slot matching, then filter in TS.
  const { data: allRules, error: rulesError } = await client
    .from("sorting_rules")
    .select(
      "id, match_mode, day_implemented_id, day_cancelled_id, destination_slot"
    )
    .eq("destination_slot", slotId);
  if (rulesError) throw new Error(rulesError.message);

  // Collect all distinct day IDs we need to look up numbers for.
  const dayIdsNeeded = new Set<string>();
  for (const r of allRules ?? []) {
    if (r.day_implemented_id) dayIdsNeeded.add(r.day_implemented_id as string);
    if (r.day_cancelled_id) dayIdsNeeded.add(r.day_cancelled_id as string);
  }

  // Batch-fetch those day rows.
  const dayNumberMap = new Map<string, number>();
  if (dayIdsNeeded.size > 0) {
    const { data: dayRows, error: daysError } = await client
      .from("days")
      .select("id, number")
      .in("id", [...dayIdsNeeded]);
    if (daysError) throw new Error(daysError.message);
    for (const d of dayRows ?? []) {
      dayNumberMap.set(d.id as string, d.number as number);
    }
  }

  // Filter to active rules for the current day.
  const activeRules = (allRules ?? []).filter((r) => {
    // Must have an implemented day.
    if (!r.day_implemented_id) return false;
    const implNumber = dayNumberMap.get(r.day_implemented_id as string);
    if (implNumber == null) return false;
    // The rule's implemented day number must be <= current day number.
    if (currentDayNumber == null || implNumber > currentDayNumber) return false;
    // If the rule has a cancelled day, it must be > current day number to be
    // still active.
    if (r.day_cancelled_id) {
      const cancelNumber = dayNumberMap.get(r.day_cancelled_id as string);
      if (cancelNumber != null && cancelNumber <= currentDayNumber) return false;
    }
    return true;
  });

  if (activeRules.length === 0) {
    const observedAt = new Date().toISOString();
    await _upsertSlotState(client, {
      playthroughId,
      slotId,
      physicalLetterId,
      sortingRuleId: null,
      passed: null,
      errorCode: "no_rule",
      evaluatedAt: null,
      observedAt,
    });
    return {
      physicalLetterId,
      passed: null,
      errorCode: "no_rule",
      evaluatedAt: null,
    };
  }

  // Use the most recently implemented rule (highest day_implemented number).
  const rule = activeRules.sort((a, b) => {
    const na = dayNumberMap.get(a.day_implemented_id as string) ?? 0;
    const nb = dayNumberMap.get(b.day_implemented_id as string) ?? 0;
    return nb - na;
  })[0];

  // -------------------------------------------------------------------------
  // Step 7: Fetch conditions for the rule.
  // -------------------------------------------------------------------------
  const { data: conditionRows, error: condError } = await client
    .from("sorting_rule_conditions")
    .select(
      "target, target_slice, operator, reference_value, reference_type"
    )
    .eq("rule_id", rule.id)
    .order("position");
  if (condError) throw new Error(condError.message);

  const conditions: RuleCondition[] = (conditionRows ?? []).map((c) => ({
    target: c.target as RuleCondition["target"],
    target_slice: c.target_slice as RuleCondition["target_slice"],
    operator: c.operator as RuleCondition["operator"],
    reference_value: c.reference_value as string | null,
    reference_type: c.reference_type as RuleCondition["reference_type"],
  }));

  // -------------------------------------------------------------------------
  // Step 7b: Fetch the sorting_letter view row for the physical letter's ref.
  // -------------------------------------------------------------------------
  const { data: sortingLetterRaw, error: slError } = await client
    .from("sorting_letters_view")
    .select("*")
    .eq("id", contentRefId)
    .maybeSingle();
  if (slError) throw new Error(slError.message);
  // Cast to our hand-maintained view type.
  const sortingLetter = sortingLetterRaw as SortingLetterView | null;

  if (!sortingLetter) {
    // Content ref points to a non-existent sorting letter — treat as wrong_phase.
    const observedAt = new Date().toISOString();
    await _upsertSlotState(client, {
      playthroughId,
      slotId,
      physicalLetterId,
      sortingRuleId: rule.id as string,
      passed: null,
      errorCode: "wrong_phase",
      evaluatedAt: null,
      observedAt,
    });
    return {
      physicalLetterId,
      passed: null,
      errorCode: "wrong_phase",
      evaluatedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // Resolve nation names for sender + recipient (needed for RuleContext).
  // -------------------------------------------------------------------------
  const nationIdsNeeded = new Set<string>();
  if (sortingLetter.sender_nation_id)
    nationIdsNeeded.add(sortingLetter.sender_nation_id);
  if (sortingLetter.recipient_nation_id)
    nationIdsNeeded.add(sortingLetter.recipient_nation_id);

  const nationNameMap = new Map<string, string>();
  if (nationIdsNeeded.size > 0) {
    const { data: nationRows, error: natError } = await client
      .from("nations")
      .select("id, name")
      .in("id", [...nationIdsNeeded]);
    if (natError) throw new Error(natError.message);
    for (const n of nationRows ?? []) {
      nationNameMap.set(n.id as string, n.name as string);
    }
  }

  // Resolve the current day's day_of_week for the RuleContext.
  let currentDayOfWeek: string | null = null;
  if (currentDayId) {
    const { data: dayRow, error: dowError } = await client
      .from("days")
      .select("day_of_week")
      .eq("id", currentDayId)
      .maybeSingle();
    if (dowError) throw new Error(dowError.message);
    currentDayOfWeek = (dayRow?.day_of_week as string | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Step 7c: Build RuleContext from the sorting letter.
  //
  // SortingLetter stores:
  //   sender_name      — a combined "First [Middle] Last" string
  //   sender_citizen_id — the citizen ID string
  //   sender_city_name, sender_city_code, sender_nation_id (FK)
  //
  // RuleContext needs:
  //   sender_name (whole), sender_first_name, sender_middle_name,
  //   sender_last_name, sender_citizen_id, sender_city_name,
  //   sender_city_code, sender_nation (name string)
  //   (same for recipient_*)
  // -------------------------------------------------------------------------
  const senderRaw = sortingLetter.sender_name ?? "";
  const recipientRaw = sortingLetter.recipient_name ?? "";

  // Split "First Last" into parts using the same logic as migration 0040.
  const senderParts = senderRaw ? splitName(senderRaw) : null;
  const recipientParts = recipientRaw ? splitName(recipientRaw) : null;

  const senderNationId = sortingLetter.sender_nation_id;
  const recipientNationId = sortingLetter.recipient_nation_id;

  const ctx: RuleContext = {
    sender_name: senderRaw || null,
    sender_first_name: senderParts?.first_name || null,
    sender_middle_name: null, // SortingLetter stores name as a single field; no discrete middle name
    sender_last_name: senderParts?.last_name || null,
    sender_citizen_id: sortingLetter.sender_citizen_id,
    sender_city_name: sortingLetter.sender_city_name,
    sender_city_code: sortingLetter.sender_city_code,
    sender_nation: senderNationId ? (nationNameMap.get(senderNationId) ?? null) : null,
    recipient_name: recipientRaw || null,
    recipient_first_name: recipientParts?.first_name || null,
    recipient_middle_name: null, // same — single name field
    recipient_last_name: recipientParts?.last_name || null,
    recipient_citizen_id: sortingLetter.recipient_citizen_id,
    recipient_city_name: sortingLetter.recipient_city_name,
    recipient_city_code: sortingLetter.recipient_city_code,
    recipient_nation: recipientNationId
      ? (nationNameMap.get(recipientNationId) ?? null)
      : null,
    is_counterfeit: sortingLetter.is_counterfeit,
    current_day_of_week: currentDayOfWeek,
  };

  // -------------------------------------------------------------------------
  // Step 8: Run evaluateRule and persist the result.
  // -------------------------------------------------------------------------
  const passed = evaluateRule(
    conditions,
    rule.match_mode as "all" | "any" | "exclusive",
    ctx
  );

  const evaluatedAt = new Date().toISOString();
  const observedAt = evaluatedAt; // same timestamp — both happen now

  await _upsertSlotState(client, {
    playthroughId,
    slotId,
    physicalLetterId,
    sortingRuleId: rule.id as string,
    passed,
    errorCode: null,
    evaluatedAt,
    observedAt,
  });

  return {
    physicalLetterId,
    passed,
    errorCode: null,
    evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

interface UpsertSlotStateArgs {
  playthroughId: string;
  slotId: number;
  physicalLetterId: string | null;
  sortingRuleId: string | null;
  passed: boolean | null;
  errorCode: SlotObservationError | null;
  evaluatedAt: string | null;
  observedAt: string;
}

async function _upsertSlotState(
  client: SupabaseClient,
  args: UpsertSlotStateArgs
): Promise<void> {
  const {
    playthroughId,
    slotId,
    physicalLetterId,
    sortingRuleId,
    passed,
    errorCode,
    evaluatedAt,
    observedAt,
  } = args;

  const { error } = await client.from("playthrough_slot_state").upsert(
    {
      playthrough_id: playthroughId,
      slot_id: slotId,
      physical_letter_id: physicalLetterId,
      sorting_rule_id: sortingRuleId,
      passed,
      error_code: errorCode,
      evaluated_at: evaluatedAt,
      observed_at: observedAt,
    },
    { onConflict: "playthrough_id,slot_id" }
  );
  if (error) throw new Error(error.message);
}
