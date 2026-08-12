"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AddressType } from "@/lib/db/enums";
import type {
  Citizen,
  City,
  Day,
  Nation,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import { attachConditions, dayNumbers } from "@/lib/rules/destination";
import {
  addressColumns,
  clearedAddressColumns,
  makeCandidates,
  planLetters,
  type Candidate,
  type GeneratedPair,
} from "@/lib/rules/generate";

/** Paths that show a sorting letter's ID or day and so go stale when one is
 *  created, moved, or deleted. Field edits only touch the letters page.
 *  Not exported: every export of a "use server" module must be an async
 *  server action, and this is a plain helper. */
function revalidateSortingLetterSurfaces() {
  revalidatePath("/sorting/letters");
  revalidatePath("/physical");
  revalidatePath("/days/[identifier]/sorting", "page");
}

/**
 * The lowest unused sort_id on a day. Letters are numbered 0–99 per day and
 * the pair is unique, so a gap left by a deletion is reused before the tail
 * grows — that is what "lowest open ID" means everywhere in this feature.
 */
export async function lowestFreeSortId(dayId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_letters")
    .select("sort_id")
    .eq("day_id", dayId)
    .order("sort_id");
  const taken = new Set((data ?? []).map((r) => r.sort_id as number));
  for (let i = 0; i <= 99; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error("That day already holds 100 sorting letters (IDs 0–99).");
}

export async function createSortingLetter({
  dayId,
}: {
  dayId?: string | null;
} = {}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  let day_id = dayId ?? "";
  if (!day_id) {
    const { data: firstDay } = await supabase
      .from("days")
      .select("id")
      .order("number")
      .limit(1);
    day_id = firstDay?.[0]?.id ?? "";
  }
  if (!day_id) throw new Error("Create a day before adding sorting letters.");
  const sort_id = await lowestFreeSortId(day_id);

  const { data, error } = await supabase
    .from("sorting_letters")
    .insert({
      day_id,
      sort_id,
      recipient_type: "full" as AddressType,
      sender_type: "full" as AddressType,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateSortingLetterSurfaces();
  return { id: data!.id as string };
}

export async function deleteSortingLetter(id: string) {
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  // Stamp the deleter first: the DELETE payload realtime broadcasts carries
  // the prior row, which is how peers learn who removed the letter.
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase.from("sorting_letters").update({ updated_by: updatedBy }).eq("id", id);
  }
  const { error } = await supabase.from("sorting_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateSortingLetterSurfaces();
}

/** How many letters to build for one rule. */
export type GenerationRequest = { ruleId: string; count: number };

export type GenerationResult = {
  created: number;
  requested: number;
  /** Per-rule outcome, in the order requested; only rules with a count > 0. */
  perRule: Array<{
    ruleId: string;
    ruleLetter: string;
    created: number;
    requested: number;
    reason?: string;
  }>;
};

/**
 * Fill a day with letters, so many per rule.
 *
 * The intention isn't stored anywhere: each letter is built so its rule wins
 * *at the moment it is generated*, and a rule authored later may well capture
 * it. That is the same deal every hand-authored letter gets.
 *
 * Rules are planned in sequence against one shared pool: citizens used by an
 * earlier rule's letters are avoided by the later ones, and the day's free IDs
 * are handed out across the whole batch rather than per rule.
 */
export async function generateSortingLetters({
  dayId,
  requests,
}: {
  dayId: string;
  requests: GenerationRequest[];
}): Promise<GenerationResult> {
  const supabase = await createSupabaseServerClient();
  if (!dayId) throw new Error("Pick a day to generate for.");
  const wanted = requests.filter((r) => r.ruleId && r.count > 0);
  const totalRequested = wanted.reduce((sum, r) => sum + r.count, 0);
  if (totalRequested === 0) return { created: 0, requested: 0, perRule: [] };

  const [
    { data: dayData },
    { data: rulesData },
    { data: conditionsData },
    { data: citizensData },
    { data: citiesData },
    { data: nationsData },
    { data: daysData },
    { data: existingData },
  ] = await Promise.all([
    supabase.from("days").select("*").eq("id", dayId).single(),
    supabase.from("sorting_rules").select("*"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("citizens").select("*"),
    supabase.from("cities").select("*"),
    supabase.from("nations").select("*"),
    supabase.from("days").select("*").order("number"),
    supabase
      .from("sorting_letters")
      .select("sort_id, sender_citizen_id, recipient_citizen_id")
      .eq("day_id", dayId),
  ]);

  const day = dayData as Day | null;
  if (!day) throw new Error("That day no longer exists.");

  const existing = existingData ?? [];
  const taken = new Set(existing.map((r) => r.sort_id as number));
  let capacity = 0;
  for (let i = 0; i <= 99; i++) if (!taken.has(i)) capacity++;

  const rules = attachConditions(
    (rulesData ?? []) as SortingRule[],
    (conditionsData ?? []) as SortingRuleCondition[]
  );
  const letterFor = (ruleId: string) =>
    rules.find((r) => r.rule.id === ruleId)?.rule.letter ?? "?";

  // Capacity is knowable up front — no point sampling letters there is no room
  // for.
  if (capacity === 0) {
    return {
      created: 0,
      requested: totalRequested,
      perRule: wanted.map((r) => ({
        ruleId: r.ruleId,
        ruleLetter: letterFor(r.ruleId),
        created: 0,
        requested: r.count,
        reason: "That day already holds 100 sorting letters (IDs 0–99).",
      })),
    };
  }

  // Citizens already on the day's letters, grown as each rule's letters land
  // so two rules don't both reach for the same person.
  const usedCitizenIds = new Set<string>();
  for (const row of existing) {
    if (row.sender_citizen_id) usedCitizenIds.add(row.sender_citizen_id as string);
    if (row.recipient_citizen_id)
      usedCitizenIds.add(row.recipient_citizen_id as string);
  }

  const candidates = makeCandidates(
    (citizensData ?? []) as Citizen[],
    (citiesData ?? []) as City[],
    (nationsData ?? []) as Nation[]
  );
  const dayNumberById = dayNumbers((daysData ?? []) as Day[]);

  const perRule: GenerationResult["perRule"] = [];
  let created = 0;

  for (const request of wanted) {
    const room = Math.min(request.count, capacity);
    if (room === 0) {
      perRule.push({
        ruleId: request.ruleId,
        ruleLetter: letterFor(request.ruleId),
        created: 0,
        requested: request.count,
        reason: "No free IDs left on that day.",
      });
      continue;
    }

    const { pairs, shortfall } = planLetters({
      rules,
      targetRuleId: request.ruleId,
      dayNumber: day.number,
      dayOfWeek: day.day_of_week,
      dayNumberById,
      candidates,
      usedCitizenIds,
      count: room,
      rng: Math.random,
    });

    let ruleCreated = 0;
    let lostToRace = 0;
    for (const pair of pairs) {
      const inserted = await insertGeneratedLetter(dayId, pair);
      if (!inserted) {
        lostToRace++;
        continue;
      }
      ruleCreated++;
      capacity--;
      usedCitizenIds.add(pair.sender.citizen.id);
      usedCitizenIds.add(pair.recipient.citizen.id);
    }
    created += ruleCreated;

    // Order matters: a letter lost to a concurrent writer is a different story
    // from a rule nothing could satisfy, and the planner's reason shouldn't be
    // reported for a letter that planned fine and just lost its slot.
    const reason =
      ruleCreated < request.count
        ? lostToRace > 0
          ? "Another session claimed those IDs while generating — try again."
          : (shortfall ??
            (room < request.count ? "No free IDs left on that day." : undefined))
        : undefined;

    perRule.push({
      ruleId: request.ruleId,
      ruleLetter: letterFor(request.ruleId),
      created: ruleCreated,
      requested: request.count,
      reason,
    });
  }

  revalidateSortingLetterSurfaces();
  return { created, requested: totalRequested, perRule };
}

/**
 * Insert one generated letter, claiming the lowest free ID at the moment of
 * writing. Two people generating into the same day race on
 * `unique (day_id, sort_id)`, so a duplicate-key rejection is retried against
 * a freshly read slot rather than failing the whole batch.
 *
 * ponytail: retry loop, not a transaction — the Supabase client has no
 * transaction. Move generation into a Postgres function if concurrent
 * generation ever becomes routine.
 */
async function insertGeneratedLetter(
  dayId: string,
  pair: GeneratedPair
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    const sort_id = await lowestFreeSortId(dayId);
    const { error } = await supabase.from("sorting_letters").insert({
      day_id: dayId,
      sort_id,
      stamp_valid: pair.stampValid,
      sender_type: "full" as AddressType,
      recipient_type: "full" as AddressType,
      ...addressColumns("sender", pair.sender),
      ...addressColumns("recipient", pair.recipient),
    });
    if (!error) return true;
    // 23505 = unique_violation: someone took the slot between the read and the
    // insert. Anything else is a real failure.
    if (error.code !== "23505") throw new Error(error.message);
  }
  return false;
}

// ── bulk operations ─────────────────────────────────────────────────────────

/** What the bulk bar can set or clear across a selection. */
export type BulkField =
  | { kind: "storage"; value: string | null }
  | { kind: "notes"; value: string | null }
  | { kind: "stamp"; value: boolean }
  | { kind: "sender"; citizenId: string | null }
  | { kind: "recipient"; citizenId: string | null }
  /** Everything a letter says about who it is from, to, where it is kept. */
  | { kind: "all" };

/**
 * Apply one field change to every selected letter. Clearing and setting are
 * the same operation with a null value, which is why "clear storage" and "set
 * storage" share a code path.
 */
export async function bulkPatchSortingLetters(ids: string[], field: BulkField) {
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  const patch = await bulkPatchFor(field);
  const { error } = await supabase
    .from("sorting_letters")
    .update(patch)
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidateSortingLetterSurfaces();
}

async function bulkPatchFor(field: BulkField): Promise<Record<string, unknown>> {
  switch (field.kind) {
    case "storage":
      return { storage_location: field.value };
    case "notes":
      return { notes: field.value };
    case "stamp":
      return { stamp_valid: field.value };
    case "sender":
    case "recipient": {
      if (!field.citizenId) return clearedAddressColumns(field.kind);
      const candidate = await candidateFor(field.citizenId);
      return addressColumns(field.kind, candidate);
    }
    case "all":
      return {
        storage_location: null,
        notes: null,
        ...clearedAddressColumns("sender"),
        ...clearedAddressColumns("recipient"),
      };
  }
}

/** Load one citizen and denormalize their address, as the generator does. */
async function candidateFor(citizenId: string): Promise<Candidate> {
  const supabase = await createSupabaseServerClient();
  const [{ data: citizen }, { data: cities }, { data: nations }] = await Promise.all([
    supabase.from("citizens").select("*").eq("id", citizenId).single(),
    supabase.from("cities").select("*"),
    supabase.from("nations").select("*"),
  ]);
  if (!citizen) throw new Error("That citizen no longer exists.");
  const [candidate] = makeCandidates(
    [citizen as Citizen],
    (cities ?? []) as City[],
    (nations ?? []) as Nation[]
  );
  return candidate;
}

/**
 * Move letters to another day, re-IDing only where the target day already uses
 * the letter's current ID. Keeping the ID when it's free means a batch moved
 * wholesale keeps its numbering.
 */
export async function bulkSetSortingLetterDay(ids: string[], dayId: string) {
  if (ids.length === 0 || !dayId) return;
  const supabase = await createSupabaseServerClient();

  const { data: letters } = await supabase
    .from("sorting_letters")
    .select("id, day_id, sort_id")
    .in("id", ids)
    .order("sort_id");

  const { data: targetRows } = await supabase
    .from("sorting_letters")
    .select("id, sort_id")
    .eq("day_id", dayId);

  // Every slot the target day currently uses is taken — including slots held
  // by selected letters that are ALREADY on that day. Those letters don't
  // move, so treating their slots as free would hand one to an incoming
  // letter and trip the unique constraint.
  const taken = new Set((targetRows ?? []).map((r) => r.sort_id as number));

  const incoming = (letters ?? []).filter((r) => r.day_id !== dayId);

  for (const letter of incoming) {
    let sort_id = letter.sort_id as number;
    if (taken.has(sort_id)) {
      const free = firstFree(taken);
      if (free == null) {
        throw new Error("That day has no room left (IDs 0–99 are all taken).");
      }
      sort_id = free;
    }
    taken.add(sort_id);
    const { error } = await supabase
      .from("sorting_letters")
      .update({ day_id: dayId, sort_id })
      .eq("id", letter.id);
    if (error) throw new Error(error.message);
  }
  revalidateSortingLetterSurfaces();
}

function firstFree(taken: ReadonlySet<number>): number | null {
  for (let i = 0; i <= 99; i++) if (!taken.has(i)) return i;
  return null;
}

/**
 * Compact a day's IDs to 0..n-1, preserving current order.
 *
 * No temporary offset is needed: compaction only ever lowers an ID, so
 * applying the moves in ascending target order always writes into a slot the
 * previous move has already vacated.
 */
export async function renumberSortingLetters(dayId: string) {
  if (!dayId) return;
  const supabase = await createSupabaseServerClient();
  const { data: letters } = await supabase
    .from("sorting_letters")
    .select("id, sort_id")
    .eq("day_id", dayId)
    .order("sort_id");

  let target = 0;
  for (const letter of letters ?? []) {
    if ((letter.sort_id as number) !== target) {
      const { error } = await supabase
        .from("sorting_letters")
        .update({ sort_id: target })
        .eq("id", letter.id);
      if (error) throw new Error(error.message);
    }
    target++;
  }
  revalidateSortingLetterSurfaces();
}

export async function bulkDeleteSortingLetters(ids: string[]) {
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase.from("sorting_letters").update({ updated_by: updatedBy }).in("id", ids);
  }
  const { error } = await supabase.from("sorting_letters").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidateSortingLetterSurfaces();
}

/**
 * Rewrite the selected letters' senders and recipients so they sort to
 * `ruleId`. Every selected letter must share a day — the rules in force differ
 * per day, so a mixed selection has no single answer.
 */
export async function bulkApplyRuleToLetters(
  ids: string[],
  ruleId: string
): Promise<{ updated: number; requested: number; reason?: string }> {
  if (ids.length === 0) return { updated: 0, requested: 0 };
  const supabase = await createSupabaseServerClient();

  const { data: selected } = await supabase
    .from("sorting_letters")
    .select("id, day_id, sort_id")
    .in("id", ids)
    .order("sort_id");
  const rows = selected ?? [];
  const dayIds = new Set(rows.map((r) => r.day_id as string));
  if (dayIds.size !== 1) {
    throw new Error("Select letters from a single day to set their sorting rule.");
  }
  const dayId = [...dayIds][0];

  const [
    { data: dayData },
    { data: rulesData },
    { data: conditionsData },
    { data: citizensData },
    { data: citiesData },
    { data: nationsData },
    { data: daysData },
    { data: dayLetters },
  ] = await Promise.all([
    supabase.from("days").select("*").eq("id", dayId).single(),
    supabase.from("sorting_rules").select("*"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("citizens").select("*"),
    supabase.from("cities").select("*"),
    supabase.from("nations").select("*"),
    supabase.from("days").select("*").order("number"),
    supabase
      .from("sorting_letters")
      .select("id, sender_citizen_id, recipient_citizen_id")
      .eq("day_id", dayId),
  ]);

  const day = dayData as Day | null;
  if (!day) throw new Error("That day no longer exists.");

  // Citizens on the day's OTHER letters are the ones worth avoiding; the
  // selected letters are about to be overwritten anyway.
  const selectedIds = new Set(rows.map((r) => r.id as string));
  const usedCitizenIds = new Set<string>();
  for (const row of dayLetters ?? []) {
    if (selectedIds.has(row.id as string)) continue;
    if (row.sender_citizen_id) usedCitizenIds.add(row.sender_citizen_id as string);
    if (row.recipient_citizen_id)
      usedCitizenIds.add(row.recipient_citizen_id as string);
  }

  const { pairs, shortfall } = planLetters({
    rules: attachConditions(
      (rulesData ?? []) as SortingRule[],
      (conditionsData ?? []) as SortingRuleCondition[]
    ),
    targetRuleId: ruleId,
    dayNumber: day.number,
    dayOfWeek: day.day_of_week,
    dayNumberById: dayNumbers((daysData ?? []) as Day[]),
    candidates: makeCandidates(
      (citizensData ?? []) as Citizen[],
      (citiesData ?? []) as City[],
      (nationsData ?? []) as Nation[]
    ),
    usedCitizenIds,
    count: rows.length,
    rng: Math.random,
  });

  let updated = 0;
  for (let i = 0; i < pairs.length; i++) {
    const { error } = await supabase
      .from("sorting_letters")
      .update({
        stamp_valid: pairs[i].stampValid,
        sender_type: "full" as AddressType,
        recipient_type: "full" as AddressType,
        ...addressColumns("sender", pairs[i].sender),
        ...addressColumns("recipient", pairs[i].recipient),
      })
      .eq("id", rows[i].id);
    if (error) throw new Error(error.message);
    updated++;
  }

  revalidateSortingLetterSurfaces();
  return {
    updated,
    requested: rows.length,
    reason: updated < rows.length ? shortfall : undefined,
  };
}

/**
 * Narrow per-field patch for instant-save. Does NOT call revalidatePath —
 * realtime fans out the change to all subscribed clients.
 */
export async function patchSortingLetter(
  id: string,
  patch: Partial<{
    day_id: string;
    sort_id: number;
    storage_location: string | null;
    stamp_valid: boolean;
    recipient_type: import("@/lib/db/enums").AddressType;
    recipient_name: string | null;
    recipient_citizen_number: string | null;
    recipient_city_id: string | null;
    recipient_city_name: string | null;
    recipient_city_code: string | null;
    recipient_nation_id: string | null;
    sender_type: import("@/lib/db/enums").AddressType;
    sender_name: string | null;
    sender_citizen_number: string | null;
    sender_city_id: string | null;
    sender_city_name: string | null;
    sender_city_code: string | null;
    sender_nation_id: string | null;
    notes: string | null;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sorting_letters")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
