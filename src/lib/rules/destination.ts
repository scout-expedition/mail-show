import type { RuleContext, RuleCondition } from "@/lib/rules/evaluate";
import { evaluateRule } from "@/lib/rules/evaluate";
import { splitName } from "@/lib/citizen-name";
import type {
  Citizen,
  City,
  Day,
  Nation,
  SortingLetter,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";

/**
 * Where a sorting letter ends up once the rules active on its day are applied.
 *
 * The rules page states the precedence: "on conflict, most recently implemented
 * rule takes precedence". That is the whole tiebreak — the rule whose
 * `day_implemented` day number is highest wins. Two rules implemented on the
 * same day that disagree about the destination are a genuine authoring
 * conflict, and this module reports it rather than picking one.
 */

/** A rule with its conditions attached — what the resolver actually needs. */
export interface RuleWithConditions {
  rule: SortingRule;
  conditions: RuleCondition[];
}

export type Destination =
  /** No active rule matched the letter. */
  | { status: "none" }
  /** A rule matched, but it names neither a slot nor Reporting. */
  | { status: "unassigned"; rule: SortingRule }
  | {
      status: "resolved";
      rule: SortingRule;
      slot: number | null;
      routesToReporting: boolean;
    }
  /** Equal-precedence rules disagree about where the letter goes. */
  | { status: "conflict"; rules: SortingRule[] };

/**
 * Precedence rank of a rule: the day number it was implemented on. An undated
 * rule ranks 0 — active from the start of the show, and below every dated rule
 * (day numbers start at 1), so it never ties with a real day-1 rule.
 */
export function implementedRank(
  rule: SortingRule,
  dayNumberById: ReadonlyMap<string, number>
): number {
  if (!rule.day_implemented_id) return 0;
  return dayNumberById.get(rule.day_implemented_id) ?? 0;
}

/** Day number lookup keyed by day id — built once, passed everywhere. */
export function dayNumbers(days: Day[]): Map<string, number> {
  return new Map(days.map((d) => [d.id, d.number]));
}

/**
 * The rules in force on a given day: implemented on or before it, and not yet
 * cancelled. Cancellation is inclusive of the cancelling day — a rule
 * cancelled on day 4 does not apply on day 4.
 *
 * Degenerate data degrades rather than throws: a dangling implemented-day
 * reference reads as undated, a dangling cancelled-day reference as
 * uncancelled, and a rule cancelled before it was implemented is never active.
 */
export function activeRules<T extends { rule: SortingRule }>(
  rules: T[],
  dayNumberById: ReadonlyMap<string, number>,
  dayNumber: number
): T[] {
  return rules.filter(({ rule }) => {
    const implemented = implementedRank(rule, dayNumberById);
    if (implemented > dayNumber) return false;
    if (!rule.day_cancelled_id) return true;
    const cancelled = dayNumberById.get(rule.day_cancelled_id);
    if (cancelled == null) return true;
    if (cancelled <= implemented) return false;
    return dayNumber < cancelled;
  });
}

/** Two rules agree about the destination when slot and reporting both match. */
function sameDestination(a: SortingRule, b: SortingRule): boolean {
  return (
    a.destination_slot === b.destination_slot &&
    a.routes_to_reporting === b.routes_to_reporting
  );
}

/**
 * Resolve the destination of a letter described by `ctx`, delivered on
 * `dayNumber`. `rules` may hold every rule — inactive ones are filtered here.
 */
export function resolveDestination(
  rules: RuleWithConditions[],
  ctx: RuleContext,
  dayNumberById: ReadonlyMap<string, number>,
  dayNumber: number
): Destination {
  const matches = activeRules(rules, dayNumberById, dayNumber).filter((r) =>
    evaluateRule(r.conditions, r.rule.match_mode, ctx)
  );
  if (matches.length === 0) return { status: "none" };

  const topRank = Math.max(
    ...matches.map((m) => implementedRank(m.rule, dayNumberById))
  );
  const winners = matches.filter(
    (m) => implementedRank(m.rule, dayNumberById) === topRank
  );

  // Several rules implemented on the same day are only a conflict when they
  // disagree about where the letter goes. Agreeing duplicates resolve.
  const disagreeing = winners.filter((w) => !sameDestination(w.rule, winners[0].rule));
  if (disagreeing.length > 0) {
    return { status: "conflict", rules: winners.map((w) => w.rule) };
  }

  const rule = winners[0].rule;
  if (rule.destination_slot == null && !rule.routes_to_reporting) {
    return { status: "unassigned", rule };
  }
  return {
    status: "resolved",
    rule,
    slot: rule.destination_slot,
    routesToReporting: rule.routes_to_reporting,
  };
}

/**
 * The generator needs to know which rule it satisfied, so an agreeing tie is
 * no good to it either — it requires exactly one top-rank match.
 */
export function uniqueWinner(
  rules: RuleWithConditions[],
  ctx: RuleContext,
  dayNumberById: ReadonlyMap<string, number>,
  dayNumber: number
): SortingRule | null {
  const matches = activeRules(rules, dayNumberById, dayNumber).filter((r) =>
    evaluateRule(r.conditions, r.rule.match_mode, ctx)
  );
  if (matches.length === 0) return null;
  const topRank = Math.max(
    ...matches.map((m) => implementedRank(m.rule, dayNumberById))
  );
  const winners = matches.filter(
    (m) => implementedRank(m.rule, dayNumberById) === topRank
  );
  return winners.length === 1 ? winners[0].rule : null;
}

// ── context building ─────────────────────────────────────────────────────────

/** Name parts for one side of a letter. */
interface NameParts {
  first: string | null;
  middle: string | null;
  last: string | null;
}

/**
 * Name parts for an address. A linked citizen is authoritative (it carries a
 * real middle name); otherwise the denormalized `*_name` string is split the
 * same way the citizens backfill splits pasted names, and the middle name is
 * unknowable — it stays null, which `not_*` operators treat as "no match".
 */
function nameParts(
  citizen: Citizen | undefined,
  name: string | null
): NameParts {
  if (citizen) {
    return {
      first: citizen.first_name || null,
      middle: citizen.middle_name,
      last: citizen.last_name || null,
    };
  }
  if (!name) return { first: null, middle: null, last: null };
  const { first_name, last_name } = splitName(name);
  return { first: first_name || null, middle: null, last: last_name || null };
}

export interface ContextLookups {
  citizensById: ReadonlyMap<string, Citizen>;
  citiesById: ReadonlyMap<string, City>;
  nationsById: ReadonlyMap<string, Nation>;
}

export function makeLookups(
  citizens: Citizen[],
  cities: City[],
  nations: Nation[]
): ContextLookups {
  return {
    citizensById: new Map(citizens.map((c) => [c.id, c])),
    citiesById: new Map(cities.map((c) => [c.id, c])),
    nationsById: new Map(nations.map((n) => [n.id, n])),
  };
}

/**
 * Build the evaluator's context from a stored sorting letter. City and nation
 * resolve through the id columns when set, falling back to the denormalized
 * text the letter carries (a letter may name a city that isn't in the
 * directory).
 */
export function contextFromLetter(
  letter: Pick<
    SortingLetter,
    | "stamp_valid"
    | "sender_citizen_id"
    | "sender_name"
    | "sender_citizen_number"
    | "sender_city_id"
    | "sender_city_name"
    | "sender_city_code"
    | "sender_nation_id"
    | "recipient_citizen_id"
    | "recipient_name"
    | "recipient_citizen_number"
    | "recipient_city_id"
    | "recipient_city_name"
    | "recipient_city_code"
    | "recipient_nation_id"
  >,
  lookups: ContextLookups,
  dayOfWeek: string | null
): RuleContext {
  const { citizensById, citiesById, nationsById } = lookups;

  const senderCitizen = letter.sender_citizen_id
    ? citizensById.get(letter.sender_citizen_id)
    : undefined;
  const recipientCitizen = letter.recipient_citizen_id
    ? citizensById.get(letter.recipient_citizen_id)
    : undefined;

  const sender = nameParts(senderCitizen, letter.sender_name);
  const recipient = nameParts(recipientCitizen, letter.recipient_name);

  const senderCity = letter.sender_city_id
    ? citiesById.get(letter.sender_city_id)
    : undefined;
  const recipientCity = letter.recipient_city_id
    ? citiesById.get(letter.recipient_city_id)
    : undefined;
  const senderNation = letter.sender_nation_id
    ? nationsById.get(letter.sender_nation_id)
    : undefined;
  const recipientNation = letter.recipient_nation_id
    ? nationsById.get(letter.recipient_nation_id)
    : undefined;

  return {
    sender_name: letter.sender_name,
    sender_first_name: sender.first,
    sender_middle_name: sender.middle,
    sender_last_name: sender.last,
    sender_citizen_id:
      senderCitizen?.citizen_id ?? stripHash(letter.sender_citizen_number),
    sender_city_name: senderCity?.name ?? letter.sender_city_name,
    sender_city_code: senderCity?.code ?? letter.sender_city_code,
    sender_nation: senderNation?.name ?? null,
    recipient_name: letter.recipient_name,
    recipient_first_name: recipient.first,
    recipient_middle_name: recipient.middle,
    recipient_last_name: recipient.last,
    recipient_citizen_id:
      recipientCitizen?.citizen_id ?? stripHash(letter.recipient_citizen_number),
    recipient_city_name: recipientCity?.name ?? letter.recipient_city_name,
    recipient_city_code: recipientCity?.code ?? letter.recipient_city_code,
    recipient_nation: recipientNation?.name ?? null,
    stamp_valid: letter.stamp_valid,
    current_day_of_week: dayOfWeek,
  };
}

/** Citizen ids are stored raw but typed with a leading "#" in the letter. */
function stripHash(v: string | null): string | null {
  if (v == null) return null;
  const body = v.trim().replace(/^#+/, "");
  return body || null;
}

/** Group flat condition rows by rule id, ordered by position. */
export function attachConditions(
  rules: SortingRule[],
  conditions: SortingRuleCondition[]
): RuleWithConditions[] {
  const byRule = new Map<string, SortingRuleCondition[]>();
  for (const c of conditions) {
    const list = byRule.get(c.rule_id);
    if (list) list.push(c);
    else byRule.set(c.rule_id, [c]);
  }
  return rules.map((rule) => ({
    rule,
    conditions: (byRule.get(rule.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position),
  }));
}
