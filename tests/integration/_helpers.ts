import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const noopCookies: CookieMethodsServer = {
  getAll: () => [],
  setAll: () => {},
};

/**
 * Build a Supabase client against the test instance with the service-role
 * key. Bypasses RLS by design — integration tests assume a trusted setup
 * harness; RLS is exercised separately in `rls.test.ts`.
 */
export function makeTestClient(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY (see tests/integration/README.md)."
    );
  }
  return createServerClient(url, key, { cookies: noopCookies });
}

/**
 * Build an anon (publishable-key) client. Used only by RLS tests to verify
 * unauthenticated reads/writes are blocked. Requires SUPABASE_TEST_ANON_KEY
 * in the env (the "Publishable" key from `supabase start` output).
 */
export function makeAnonClient(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY (see tests/integration/README.md)."
    );
  }
  return createServerClient(url, key, { cookies: noopCookies });
}

const TEST_PREFIX = "__INT_TEST__";

/**
 * Floor of the `days.number` range this harness allocates from. `addDay`
 * defaults its `number` arg into this range; `seedStoryline.dayNumberBase`
 * defaults here too; `cleanupTestData` sweeps everything ≥ this value. Kept
 * as a single named constant so changing the range doesn't require touching
 * every call site (and the cleanup sweep stays in sync with whatever the
 * builders insert).
 */
export const TEST_DAY_NUMBER_MIN = 9000;

/** Marker prepended to every storyline name we seed, so cleanup is safe even
 *  if a previous run aborted mid-test. */
export function testName(suffix: string): string {
  return `${TEST_PREFIX}${suffix}`;
}

/**
 * Delete every row this harness might have created. Cascades take care of
 * letter_groups → report_groups → letters → actions → report_segments →
 * playthrough_action_choices, and days → sorting_letters. Playthroughs are
 * deleted explicitly because no FK from storyline reaches them. Idempotent.
 */
export async function cleanupTestData(sb: SupabaseClient): Promise<void> {
  await sb.from("playthroughs").delete().like("name", `${TEST_PREFIX}%`);
  await sb.from("storylines").delete().like("name", `${TEST_PREFIX}%`);
  await sb.from("days").delete().like("notes", `${TEST_PREFIX}%`);
  // Backstop: builders allocate `days.number` from TEST_DAY_NUMBER_MIN up to
  // dodge seeded prod days, and a few server actions (notably `updateDay`
  // with blank FormData values) null out the `notes` marker — which makes
  // the LIKE cleanup miss them and a follow-up `addDay` at the same number
  // trip the unique constraint. Sweep the whole test number range so re-runs
  // against the same DB are deterministic.
  await sb.from("days").delete().gte("number", TEST_DAY_NUMBER_MIN);
  // Action templates + groups aren't reachable via storyline cascade.
  await sb.from("action_templates").delete().like("name", `${TEST_PREFIX}%`);
  await sb.from("action_template_groups").delete().like("name", `${TEST_PREFIX}%`);
}

export interface SeededStoryline {
  storylineId: string;
  abbreviation: string;
  groupId: string;
  reportGroupId: string;
  dayIds: string[];
}

/**
 * Insert a deterministic storyline + one letter group + N days with the
 * test marker, returning ids the test can act on. Defaults to
 * `abbreviation = 'T'`; cross-storyline tests pass an explicit abbreviation.
 * storylines.abbreviation is char(1) and unique, so distinct test storylines
 * must use distinct single chars.
 */
export async function seedStoryline(
  sb: SupabaseClient,
  opts: {
    suffix: string;
    days?: number;
    abbreviation?: string;
    dayNumberBase?: number;
  } = { suffix: "default" }
): Promise<SeededStoryline> {
  const days = opts.days ?? 2;
  const abbreviation = opts.abbreviation ?? "T";
  const dayBase = opts.dayNumberBase ?? TEST_DAY_NUMBER_MIN;

  const { data: storyline, error: sErr } = await sb
    .from("storylines")
    .insert({
      name: testName(opts.suffix),
      abbreviation,
      sort_order: 9999,
    })
    .select("id, abbreviation")
    .single();
  if (sErr || !storyline) throw new Error(`seed storyline: ${sErr?.message}`);

  const dayRows = Array.from({ length: days }, (_, i) => ({
    // Use a high `number` slot to avoid colliding with seeded production days.
    number: dayBase + i,
    notes: testName(opts.suffix),
  }));
  const { data: insertedDays, error: dErr } = await sb
    .from("days")
    .insert(dayRows)
    .select("id, number")
    .order("number");
  if (dErr || !insertedDays) throw new Error(`seed days: ${dErr?.message}`);

  const { data: group, error: gErr } = await sb
    .from("letter_groups")
    .insert({
      storyline_id: storyline.id,
      name: testName(`${opts.suffix}-group`),
      sequence: 1,
      delivery_day_id: insertedDays[0].id,
    })
    .select("id")
    .single();
  if (gErr || !group) throw new Error(`seed group: ${gErr?.message}`);

  // The letter_groups_auto_report_group trigger creates the report_group row.
  const { data: rg } = await sb
    .from("report_groups")
    .select("id")
    .eq("letter_group_id", group.id)
    .single();

  return {
    storylineId: storyline.id as string,
    abbreviation: storyline.abbreviation as string,
    groupId: group.id as string,
    reportGroupId: (rg?.id as string) ?? "",
    dayIds: insertedDays.map((d) => d.id as string),
  };
}

/** Insert an additional letter_group into an existing storyline. The
 *  trigger creates a matching report_group automatically. Returns both ids. */
export async function addGroup(
  sb: SupabaseClient,
  opts: {
    storylineId: string;
    sequence: number;
    suffix: string;
    deliveryDayId?: string | null;
  }
): Promise<{ groupId: string; reportGroupId: string }> {
  const { data: group, error: gErr } = await sb
    .from("letter_groups")
    .insert({
      storyline_id: opts.storylineId,
      name: testName(`${opts.suffix}-g${opts.sequence}`),
      sequence: opts.sequence,
      delivery_day_id: opts.deliveryDayId ?? null,
    })
    .select("id")
    .single();
  if (gErr || !group) throw new Error(`addGroup: ${gErr?.message}`);
  const { data: rg } = await sb
    .from("report_groups")
    .select("id")
    .eq("letter_group_id", group.id)
    .single();
  return {
    groupId: group.id as string,
    reportGroupId: (rg?.id as string) ?? "",
  };
}

/** Insert a single test-marked day at an explicit number. Returns the new id. */
export async function addDay(
  sb: SupabaseClient,
  opts: { suffix: string; number: number }
): Promise<string> {
  const { data, error } = await sb
    .from("days")
    .insert({ number: opts.number, notes: testName(opts.suffix) })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addDay: ${error?.message}`);
  return data.id as string;
}

/**
 * Insert N letters into a group with variants 'a', 'b', 'c'... and optional
 * pieces. Returns ids in order. The view's content_id formula depends on the
 * number of letters in the group (single-letter groups hide the variant
 * suffix), so callers control multi vs. single by setting `count`.
 */
export async function addLetters(
  sb: SupabaseClient,
  opts: {
    groupId: string;
    count: number;
    pieces?: Array<number | null>;
    deliveryOverrides?: Array<string | null>;
    sortOrders?: number[];
  }
): Promise<string[]> {
  const rows = Array.from({ length: opts.count }, (_, i) => ({
    letter_group_id: opts.groupId,
    variant: String.fromCharCode(97 + i),
    piece: opts.pieces?.[i] ?? null,
    delivery_day_override_id: opts.deliveryOverrides?.[i] ?? null,
    sort_order: opts.sortOrders?.[i] ?? i,
  }));
  const { data, error } = await sb
    .from("inspection_letters")
    .insert(rows)
    .select("id, variant")
    .order("variant");
  if (error || !data) throw new Error(`addLetters: ${error?.message}`);
  return data.map((r) => r.id as string);
}

/** Insert a report segment with a given roman-numeral variant. */
export async function addReportSegment(
  sb: SupabaseClient,
  opts: {
    reportGroupId: string;
    variant: string;
    deliveryDayOverrideId?: string | null;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("report_segments")
    .insert({
      report_group_id: opts.reportGroupId,
      variant: opts.variant,
      delivery_day_override_id: opts.deliveryDayOverrideId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addReportSegment: ${error?.message}`);
  return data.id as string;
}

/** Insert a sorting letter on a given day at a given slot. */
export async function addSortingLetter(
  sb: SupabaseClient,
  opts: { dayId: string; sortId: number }
): Promise<string> {
  const { data, error } = await sb
    .from("sorting_letters")
    .insert({ day_id: opts.dayId, sort_id: opts.sortId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addSortingLetter: ${error?.message}`);
  return data.id as string;
}

export interface ImpactPatch {
  impact_world_status?: number;
  impact_demerits?: number;
  impact_proletariat?: number;
  impact_gentry?: number;
  impact_epicenter?: number;
  impact_folos?: number;
  impact_emberlyn?: number;
  impact_spokgrad?: number;
  impact_pelico?: number;
}

/** Insert an action attached to an inspection letter, with impact overrides
 *  and an optional triggering link to a report segment (sets
 *  actions.report_segment_id — what report_segments_view reads to find a
 *  report's triggering letters). */
export async function addAction(
  sb: SupabaseClient,
  opts: {
    letterId: string;
    actionTemplateId?: string | null;
    impacts?: ImpactPatch;
    reportSegmentId?: string | null;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("actions")
    .insert({
      inspection_letter_id: opts.letterId,
      action_template_id: opts.actionTemplateId ?? null,
      report_segment_id: opts.reportSegmentId ?? null,
      ...(opts.impacts ?? {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addAction: ${error?.message}`);
  return data.id as string;
}

/** Insert a test-marked playthrough. */
export async function addPlaythrough(
  sb: SupabaseClient,
  opts: { suffix: string; currentDayId?: string | null } = { suffix: "default" }
): Promise<string> {
  const { data, error } = await sb
    .from("playthroughs")
    .insert({
      name: testName(opts.suffix),
      current_day_id: opts.currentDayId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addPlaythrough: ${error?.message}`);
  return data.id as string;
}

/** Record an action choice for a playthrough+letter pair. */
export async function addPlaythroughChoice(
  sb: SupabaseClient,
  opts: { playthroughId: string; letterId: string; actionId: string }
): Promise<void> {
  const { error } = await sb.from("playthrough_action_choices").insert({
    playthrough_id: opts.playthroughId,
    inspection_letter_id: opts.letterId,
    chosen_action_id: opts.actionId,
  });
  if (error) throw new Error(`addPlaythroughChoice: ${error.message}`);
}

/**
 * Delete every sorting_rules row. `sorting_rules` is not reachable from a
 * storyline cascade, so `cleanupTestData` doesn't touch it — sorting-rule
 * tests must call this in `beforeAll` and `afterEach`. `letter` is a UNIQUE
 * char(1) (A–Z), so leftover rows from an aborted run would exhaust the 26
 * slots. `sorting_rule_conditions` cascade-delete with their rule.
 */
export async function cleanupSortingRules(sb: SupabaseClient): Promise<void> {
  await sb.from("sorting_rules").delete().neq("id", ZERO_UUID);
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Insert a `sorting_rules` row. Defaults match the simplest valid rule.
 * `letter` defaults to "A" — pass distinct letters when seeding several rules
 * in one test (the column is UNIQUE). Returns the new id.
 */
export async function addRule(
  sb: SupabaseClient,
  opts: {
    letter?: string;
    matchMode?: "all" | "any";
    storageLocation?: string | null;
    summary?: string | null;
    dayImplementedId?: string | null;
    destinationSlot?: number | null;
  } = {}
): Promise<string> {
  const { data, error } = await sb
    .from("sorting_rules")
    .insert({
      letter: opts.letter ?? "A",
      match_mode: opts.matchMode ?? "all",
      storage_location: opts.storageLocation ?? null,
      summary: opts.summary ?? null,
      day_implemented_id: opts.dayImplementedId ?? null,
      destination_slot: opts.destinationSlot ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addRule: ${error?.message}`);
  return data.id as string;
}

/**
 * Insert a `sorting_rule_conditions` row. Defaults are a valid
 * target/operator/reference triple (`sender_name` whole `equals` string).
 * Returns the new id.
 */
export async function addRuleCondition(
  sb: SupabaseClient,
  opts: {
    ruleId: string;
    position?: number;
    target?: string;
    targetSlice?: string;
    operator?: string;
    referenceValue?: string | null;
    referenceType?: string;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("sorting_rule_conditions")
    .insert({
      rule_id: opts.ruleId,
      position: opts.position ?? 1,
      target: opts.target ?? "sender_name",
      target_slice: opts.targetSlice ?? "whole",
      operator: opts.operator ?? "equals",
      reference_value: opts.referenceValue ?? "Alice",
      reference_type: opts.referenceType ?? "string",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addRuleCondition: ${error?.message}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Reference data — nations, cities, citizens. These tables aren't reachable
// from the storyline cascade, so `cleanupTestData()` doesn't touch them.
// Tests that seed reference data should call `cleanupReferenceData()` in
// `beforeAll` and `afterEach`. `supabase/seed.sql` seeds 5 production nations
// — the `__INT_TEST__` marker keeps test rows clearly distinct from those.
// ---------------------------------------------------------------------------

/** Insert a test-marked nation. */
export async function addNation(
  sb: SupabaseClient,
  opts: {
    suffix: string;
    abbreviation?: string | null;
    colorHex?: string;
    sortOrder?: number;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("nations")
    .insert({
      name: testName(opts.suffix),
      abbreviation: opts.abbreviation ?? null,
      color_hex: opts.colorHex ?? "#888888",
      sort_order: opts.sortOrder ?? 9999,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addNation: ${error?.message}`);
  return data.id as string;
}

/** Insert a test-marked city. `code` must match /^[A-Z0-9]{3} [A-Z0-9]{3}$/
 *  — a per-call random token is generated when omitted. */
export async function addCity(
  sb: SupabaseClient,
  opts: { suffix: string; nationId: string; code?: string }
): Promise<string> {
  const code =
    opts.code ??
    `T${Math.floor(100 + Math.random() * 900)} T${Math.floor(
      100 + Math.random() * 900
    )}`;
  const { data, error } = await sb
    .from("cities")
    .insert({
      name: testName(opts.suffix),
      code,
      nation_id: opts.nationId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addCity: ${error?.message}`);
  return data.id as string;
}

/** Insert a test-marked citizen. The test marker rides on `last_name` so
 *  `cleanupReferenceData()` can find it. */
export async function addCitizen(
  sb: SupabaseClient,
  opts: {
    suffix: string;
    type?: "hero" | "npc";
    firstName?: string;
    cityId?: string | null;
    nationId?: string | null;
    citizenId?: string | null;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("citizens")
    .insert({
      type: opts.type ?? "npc",
      first_name: opts.firstName ?? "First",
      last_name: testName(opts.suffix),
      city_id: opts.cityId ?? null,
      nation_id: opts.nationId ?? null,
      citizen_id: opts.citizenId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addCitizen: ${error?.message}`);
  return data.id as string;
}

/** Delete reference-data rows in FK order (citizens → cities → nations).
 *  Tests own every citizens / cities row (none are seeded), so they're
 *  wiped wholesale — action-created rows like `"New city"` carry no
 *  `__INT_TEST__` marker, and leaving them behind FK-pins their test
 *  nation and breaks the next test's unique-name insert. For nations,
 *  the 5 seeded production rows from `supabase/seed.sql` are preserved. */
export async function cleanupReferenceData(sb: SupabaseClient): Promise<void> {
  await sb
    .from("citizens")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  await sb
    .from("cities")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  await sb
    .from("nations")
    .delete()
    .not("name", "in", "(Folos,Emberlyn,Spokgrad,Pelico,Epicenter)");
}

// ---------------------------------------------------------------------------
// Action templates, day-report blocks, physical letters — tables not on a
// storyline cascade either.
// ---------------------------------------------------------------------------

/** Insert an action template. The `name` carries the `__INT_TEST__` marker. */
export async function addActionTemplate(
  sb: SupabaseClient,
  opts: {
    suffix?: string;
    iconType?: string;
    colorHex?: string;
    sortOrder?: number;
    groupId?: string | null;
  } = {}
): Promise<string> {
  const { data, error } = await sb
    .from("action_templates")
    .insert({
      name: testName(opts.suffix ?? "tpl"),
      icon_type: opts.iconType ?? "lucide",
      color_hex: opts.colorHex ?? "#888888",
      sort_order: opts.sortOrder ?? 9999,
      group_id: opts.groupId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addActionTemplate: ${error?.message}`);
  return data.id as string;
}

/** Insert an action template group. Always carries the `__INT_TEST__` name
 *  marker so cleanup can find it. Pass `name: null` only at your peril. */
export async function addActionTemplateGroup(
  sb: SupabaseClient,
  opts: { name?: string | null; sortOrder?: number } = {}
): Promise<string> {
  const { data, error } = await sb
    .from("action_template_groups")
    .insert({
      name: opts.name === undefined ? testName("grp") : opts.name,
      sort_order: opts.sortOrder ?? 9999,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addActionTemplateGroup: ${error?.message}`);
  return data.id as string;
}

/** Delete every test-marked action_templates + action_template_groups row. */
export async function cleanupActionTemplates(sb: SupabaseClient): Promise<void> {
  await sb.from("action_templates").delete().like("name", `${TEST_PREFIX}%`);
  await sb.from("action_template_groups").delete().like("name", `${TEST_PREFIX}%`);
}

/** Insert a `kind='generic'` day_report_blocks row. */
export async function addGenericReportBlock(
  sb: SupabaseClient,
  opts: {
    dayId: string;
    variant: string;
    content?: string | null;
    summary?: string | null;
    sortOrder?: number;
  }
): Promise<string> {
  const { data, error } = await sb
    .from("day_report_blocks")
    .insert({
      day_id: opts.dayId,
      kind: "generic",
      variant: opts.variant,
      content: opts.content ?? null,
      summary: opts.summary ?? null,
      sort_order: opts.sortOrder ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`addGenericReportBlock: ${error?.message}`);
  }
  return data.id as string;
}

/** Insert a physical_letters row. `letter_id` is auto-generated when
 *  omitted; matches the action's `randomLetterId()` shape (random 6-digit
 *  integer). The column is `int`, so a numeric string is also accepted by
 *  Postgres' implicit cast. */
export async function addPhysicalLetter(
  sb: SupabaseClient,
  opts: {
    contentRefType: "sorting" | "inspection";
    contentRefId: string;
    letterId?: number | string;
    storageLocation?: string | null;
    notes?: string | null;
  }
): Promise<string> {
  const letterId = opts.letterId ?? Math.floor(Math.random() * 1_000_000);
  const { data, error } = await sb
    .from("physical_letters")
    .insert({
      content_ref_type: opts.contentRefType,
      content_ref_id: opts.contentRefId,
      letter_id: letterId,
      storage_location: opts.storageLocation ?? null,
      notes: opts.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addPhysicalLetter: ${error?.message}`);
  return data.id as string;
}

/** Delete every physical_letters row (the table has no test marker;
 *  tests own all rows on a fresh DB). */
export async function cleanupPhysicalLetters(sb: SupabaseClient): Promise<void> {
  await sb
    .from("physical_letters")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
}
