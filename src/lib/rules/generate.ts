import type { RuleContext } from "@/lib/rules/evaluate";
import { evaluateRule } from "@/lib/rules/evaluate";
import { citizenDisplayName } from "@/lib/citizen-name";
import type { Citizen, City, Nation, SortingRule } from "@/lib/db/types";
import { uniqueWinner, type RuleWithConditions } from "./destination";

/**
 * Picking sender/recipient pairs that make a letter sort to a chosen rule.
 *
 * Blind rejection sampling looks tempting here and is a trap: a rule keyed on
 * the day of week, or on a city no citizen lives in, never converges — it just
 * spins until a retry cap and reports nothing useful. So conditions are split
 * by the side they constrain, each side's candidates are filtered up front,
 * and an empty pool becomes a specific answer ("no citizen satisfies …")
 * rather than a timeout.
 *
 * Rules that aren't a plain conjunction (`any` / `exclusive`) can't be split
 * that way, so those fall back to a bounded scan over shuffled pairs — still
 * terminating, still with a reason when it fails.
 */

/** A citizen plus the address text a letter denormalizes from them. */
export interface Candidate {
  citizen: Citizen;
  cityName: string | null;
  cityCode: string | null;
  nationName: string | null;
}

export interface GeneratedPair {
  sender: Candidate;
  recipient: Candidate;
  stampValid: boolean;
}

export interface PlanResult {
  pairs: GeneratedPair[];
  /** Set when fewer pairs were produced than asked for. */
  shortfall?: string;
}

/** Pair count scanned before a non-conjunctive rule gives up, per letter. */
const SCAN_LIMIT = 2000;

export function makeCandidates(
  citizens: Citizen[],
  cities: City[],
  nations: Nation[]
): Candidate[] {
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const nationById = new Map(nations.map((n) => [n.id, n]));
  return citizens.map((citizen) => {
    const city = citizen.city_id ? cityById.get(citizen.city_id) : undefined;
    const nation = citizen.nation_id ? nationById.get(citizen.nation_id) : undefined;
    return {
      citizen,
      cityName: city?.name ?? null,
      cityCode: city?.code ?? null,
      nationName: nation?.name ?? null,
    };
  });
}

/** The evaluator context a letter built from these two citizens would have. */
export function contextFor(
  sender: Candidate,
  recipient: Candidate,
  stampValid: boolean,
  dayOfWeek: string | null
): RuleContext {
  return {
    sender_name: citizenDisplayName(sender.citizen) || null,
    sender_first_name: sender.citizen.first_name || null,
    sender_middle_name: sender.citizen.middle_name,
    sender_last_name: sender.citizen.last_name || null,
    sender_citizen_id: sender.citizen.citizen_id,
    sender_city_name: sender.cityName,
    sender_city_code: sender.cityCode,
    sender_nation: sender.nationName,
    recipient_name: citizenDisplayName(recipient.citizen) || null,
    recipient_first_name: recipient.citizen.first_name || null,
    recipient_middle_name: recipient.citizen.middle_name,
    recipient_last_name: recipient.citizen.last_name || null,
    recipient_citizen_id: recipient.citizen.citizen_id,
    recipient_city_name: recipient.cityName,
    recipient_city_code: recipient.cityCode,
    recipient_nation: recipient.nationName,
    stamp_valid: stampValid,
    current_day_of_week: dayOfWeek,
  };
}

/**
 * The columns a letter denormalizes from a citizen. Written on both generated
 * and bulk-assigned letters so the rule evaluator reads a complete address
 * without following the FK.
 */
export function addressColumns(
  side: "sender" | "recipient",
  candidate: Candidate
): Record<string, string | null> {
  return {
    [`${side}_citizen_id`]: candidate.citizen.id,
    [`${side}_name`]: citizenDisplayName(candidate.citizen) || null,
    [`${side}_citizen_number`]: candidate.citizen.citizen_id
      ? `#${candidate.citizen.citizen_id}`
      : null,
    [`${side}_city_id`]: candidate.citizen.city_id,
    [`${side}_city_name`]: candidate.cityName,
    [`${side}_city_code`]: candidate.cityCode,
    [`${side}_nation_id`]: candidate.citizen.nation_id,
  };
}

/** The same columns, emptied — what "clear sender" / "clear recipient" write. */
export function clearedAddressColumns(
  side: "sender" | "recipient"
): Record<string, null> {
  return {
    [`${side}_citizen_id`]: null,
    [`${side}_name`]: null,
    [`${side}_citizen_number`]: null,
    [`${side}_city_id`]: null,
    [`${side}_city_name`]: null,
    [`${side}_city_code`]: null,
    [`${side}_nation_id`]: null,
  };
}

/** Fisher-Yates against an injected rng, so tests can pin the order. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which stamp values the target rule tolerates. A rule that says nothing about
 * the stamp tolerates both, and generation defaults to a valid one.
 */
function stampOptions(target: RuleWithConditions, dayOfWeek: string | null): boolean[] {
  const stampConditions = target.conditions.filter((c) => c.target === "stamp_valid");
  if (stampConditions.length === 0) return [true];
  // Under `any` / `exclusive` the stamp condition may be the one that fails,
  // so both values stay in play and the full evaluation decides.
  if (target.rule.match_mode !== "all") return [true, false];
  return [true, false].filter((value) =>
    evaluateRule(stampConditions, "all", blankContext(value, dayOfWeek))
  );
}

function blankContext(stampValid: boolean, dayOfWeek: string | null): RuleContext {
  return {
    sender_name: null,
    sender_first_name: null,
    sender_middle_name: null,
    sender_last_name: null,
    sender_citizen_id: null,
    sender_city_name: null,
    sender_city_code: null,
    sender_nation: null,
    recipient_name: null,
    recipient_first_name: null,
    recipient_middle_name: null,
    recipient_last_name: null,
    recipient_citizen_id: null,
    recipient_city_name: null,
    recipient_city_code: null,
    recipient_nation: null,
    stamp_valid: stampValid,
    current_day_of_week: dayOfWeek,
  };
}

/**
 * Plan up to `count` letters that sort to `targetRuleId` on the given day.
 *
 * `usedCitizenIds` are citizens already appearing on that day's letters — they
 * are avoided while alternatives exist, and only reused once the pool runs
 * dry, because repeats are acceptable but dull.
 */
export function planLetters({
  rules,
  targetRuleId,
  dayNumber,
  dayOfWeek,
  dayNumberById,
  candidates,
  usedCitizenIds,
  count,
  rng = Math.random,
}: {
  rules: RuleWithConditions[];
  targetRuleId: string;
  dayNumber: number;
  dayOfWeek: string | null;
  dayNumberById: ReadonlyMap<string, number>;
  candidates: Candidate[];
  usedCitizenIds: ReadonlySet<string>;
  count: number;
  rng?: () => number;
}): PlanResult {
  const target = rules.find((r) => r.rule.id === targetRuleId);
  if (!target) return { pairs: [], shortfall: "That rule no longer exists." };
  if (target.conditions.length === 0) {
    return {
      pairs: [],
      shortfall: `Rule ${target.rule.letter} has no conditions, so no letter can be built to match it.`,
    };
  }
  if (candidates.length === 0) {
    return { pairs: [], shortfall: "The citizen directory is empty." };
  }

  // Day-of-week conditions are decided by the day itself. In a conjunction, one
  // that fails makes the rule unreachable on that day no matter the citizens.
  const dayConditions = target.conditions.filter(
    (c) => c.target === "current_day_of_week"
  );
  if (
    target.rule.match_mode === "all" &&
    dayConditions.some(
      (c) => !evaluateRule([c], "all", blankContext(true, dayOfWeek))
    )
  ) {
    return {
      pairs: [],
      shortfall: `Rule ${target.rule.letter} only applies on a different day of the week.`,
    };
  }

  const stamps = stampOptions(target, dayOfWeek);
  if (stamps.length === 0) {
    return {
      pairs: [],
      shortfall: `Rule ${target.rule.letter} contradicts itself about the stamp.`,
    };
  }

  const pools = candidatePools(target, candidates, dayOfWeek);
  if ("shortfall" in pools) return { pairs: [], shortfall: pools.shortfall };

  const pairs: GeneratedPair[] = [];
  const used = new Set(usedCitizenIds);
  let exhausted = false;

  for (let i = 0; i < count; i++) {
    const pair = pickPair({
      rules,
      target: target.rule,
      senders: pools.senders,
      recipients: pools.recipients,
      stamps,
      dayOfWeek,
      dayNumber,
      dayNumberById,
      used,
      rng,
    });
    if (!pair) {
      exhausted = true;
      break;
    }
    used.add(pair.sender.citizen.id);
    used.add(pair.recipient.citizen.id);
    pairs.push(pair);
  }

  if (exhausted) {
    return {
      pairs,
      shortfall:
        pairs.length === 0
          ? `No sender/recipient pair makes a letter sort to rule ${target.rule.letter} — a higher-precedence rule may be capturing them.`
          : `Only ${pairs.length} of ${count} letters could be built for rule ${target.rule.letter}.`,
    };
  }
  return { pairs };
}

/**
 * Per-side candidate pools for a conjunctive rule. Each side's conditions are
 * evaluated against a context where only that side is filled, so a sender
 * condition never rejects a recipient.
 */
function candidatePools(
  target: RuleWithConditions,
  candidates: Candidate[],
  dayOfWeek: string | null
): { senders: Candidate[]; recipients: Candidate[] } | { shortfall: string } {
  if (target.rule.match_mode !== "all") {
    // Non-conjunctive rules can't be decomposed — every citizen stays in play
    // and the bounded scan does the work.
    return { senders: candidates, recipients: candidates };
  }

  const senderConditions = target.conditions.filter((c) =>
    c.target.startsWith("sender_")
  );
  const recipientConditions = target.conditions.filter((c) =>
    c.target.startsWith("recipient_")
  );

  const senders = senderConditions.length
    ? candidates.filter((c) =>
        evaluateRule(senderConditions, "all", contextFor(c, c, true, dayOfWeek))
      )
    : candidates;
  if (senders.length === 0) {
    return {
      shortfall: `No citizen satisfies the sender conditions of rule ${target.rule.letter}.`,
    };
  }

  const recipients = recipientConditions.length
    ? candidates.filter((c) =>
        evaluateRule(recipientConditions, "all", contextFor(c, c, true, dayOfWeek))
      )
    : candidates;
  if (recipients.length === 0) {
    return {
      shortfall: `No citizen satisfies the recipient conditions of rule ${target.rule.letter}.`,
    };
  }

  return { senders, recipients };
}

/**
 * One pair that satisfies the target rule and isn't outranked by another
 * active rule. Fresh citizens are tried before reused ones; the scan is capped
 * so a hopeless rule fails fast instead of hanging the request.
 */
function pickPair({
  rules,
  target,
  senders,
  recipients,
  stamps,
  dayOfWeek,
  dayNumber,
  dayNumberById,
  used,
  rng,
}: {
  rules: RuleWithConditions[];
  target: SortingRule;
  senders: Candidate[];
  recipients: Candidate[];
  stamps: boolean[];
  dayOfWeek: string | null;
  dayNumber: number;
  dayNumberById: ReadonlyMap<string, number>;
  used: ReadonlySet<string>;
  rng: () => number;
}): GeneratedPair | null {
  const freshFirst = (pool: Candidate[]) => {
    const fresh = pool.filter((c) => !used.has(c.citizen.id));
    const stale = pool.filter((c) => used.has(c.citizen.id));
    return [...shuffled(fresh, rng), ...shuffled(stale, rng)];
  };

  const senderOrder = freshFirst(senders);
  const recipientOrder = freshFirst(recipients);

  let scanned = 0;
  for (const sender of senderOrder) {
    for (const recipient of recipientOrder) {
      if (sender.citizen.id === recipient.citizen.id) continue;
      for (const stampValid of stamps) {
        if (scanned++ > SCAN_LIMIT) return null;
        const ctx = contextFor(sender, recipient, stampValid, dayOfWeek);
        const winner = uniqueWinner(rules, ctx, dayNumberById, dayNumber);
        if (winner?.id === target.id) {
          return { sender, recipient, stampValid };
        }
      }
    }
  }
  return null;
}
