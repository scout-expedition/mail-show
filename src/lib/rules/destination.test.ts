import { describe, expect, it } from "vitest";
import { makeRuleCondition, makeRuleContext } from "../../../tests/fixtures/builders";
import type { Citizen, Day, SortingRule } from "@/lib/db/types";
import {
  activeRules,
  attachConditions,
  contextFromLetter,
  dayNumbers,
  makeLookups,
  resolveDestination,
  uniqueWinner,
  type RuleWithConditions,
} from "./destination";

// ── fixtures ─────────────────────────────────────────────────────────────────

const DAYS: Day[] = [1, 2, 3, 4].map((n) => ({
  id: `day-${n}`,
  number: n,
  identifier: `W${n}`,
  name: null,
  notes: null,
  until_qup: null,
  month: null,
  day_of_month: null,
  year: null,
  day_of_week: null,
  sort_phase_length_seconds: null,
  inspection_phase_length_seconds: null,
  base_report: null,
  report_sign_off: null,
  end_of_day_sign_off: null,
}));

const DAY_NUMBERS = dayNumbers(DAYS);

function makeRule(overrides: Partial<SortingRule> = {}): SortingRule {
  return {
    id: "rule-a",
    letter: "A",
    storage_location: null,
    summary: null,
    notes: null,
    color_hex: null,
    day_implemented_id: null,
    day_cancelled_id: null,
    destination_slot: 1,
    routes_to_reporting: false,
    match_mode: "all",
    sort_order: 0,
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: null,
    ...overrides,
  };
}

/** A rule that matches any letter whose sender first name is `name`. Dated to
 *  day 1 unless a test says otherwise, since an undated rule is never active. */
function ruleMatchingSender(
  name: string,
  overrides: Partial<SortingRule> = {}
): RuleWithConditions {
  return {
    rule: makeRule({ day_implemented_id: "day-1", ...overrides }),
    conditions: [
      makeRuleCondition({
        target: "sender_first_name",
        operator: "equals",
        reference_type: "string",
        reference_value: name,
      }),
    ],
  };
}

// ── activeRules ──────────────────────────────────────────────────────────────

describe("activeRules", () => {
  it("never activates a rule with no implemented day", () => {
    // An unset implemented day means "not a rule yet", not "a rule since the
    // beginning of the show".
    const rules = [ruleMatchingSender("Ada", { day_implemented_id: null })];
    for (const day of [1, 2, 3, 4]) {
      expect(activeRules(rules, DAY_NUMBERS, day)).toHaveLength(0);
    }
  });

  it("excludes a rule implemented after the day", () => {
    const rules = [ruleMatchingSender("Ada", { day_implemented_id: "day-3" })];
    expect(activeRules(rules, DAY_NUMBERS, 2)).toHaveLength(0);
    expect(activeRules(rules, DAY_NUMBERS, 3)).toHaveLength(1);
  });

  it("stops applying a rule on its cancelled day", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        day_implemented_id: "day-1",
        day_cancelled_id: "day-3",
      }),
    ];
    expect(activeRules(rules, DAY_NUMBERS, 2)).toHaveLength(1);
    expect(activeRules(rules, DAY_NUMBERS, 3)).toHaveLength(0);
  });

  it("never activates a rule cancelled before it was implemented", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        day_implemented_id: "day-3",
        day_cancelled_id: "day-2",
      }),
    ];
    for (const day of [1, 2, 3, 4]) {
      expect(activeRules(rules, DAY_NUMBERS, day)).toHaveLength(0);
    }
  });

  it("treats a dangling implemented day as never implemented", () => {
    const rules = [ruleMatchingSender("Ada", { day_implemented_id: "deleted-day" })];
    expect(activeRules(rules, DAY_NUMBERS, 2)).toHaveLength(0);
  });

  it("treats a dangling cancelled day as uncancelled", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        day_implemented_id: "day-1",
        day_cancelled_id: "also-deleted",
      }),
    ];
    expect(activeRules(rules, DAY_NUMBERS, 2)).toHaveLength(1);
  });
});

// ── resolveDestination ───────────────────────────────────────────────────────

describe("resolveDestination", () => {
  const ctx = makeRuleContext({ sender_first_name: "Ada" });

  it("reports none when nothing matches", () => {
    const rules = [ruleMatchingSender("Grace")];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 1)).toEqual({
      status: "none",
    });
  });

  it("resolves a single match to its slot", () => {
    const rules = [ruleMatchingSender("Ada", { destination_slot: 4 })];
    const result = resolveDestination(rules, ctx, DAY_NUMBERS, 1);
    expect(result).toMatchObject({ status: "resolved", slot: 4 });
  });

  it("resolves a reporting rule", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        destination_slot: null,
        routes_to_reporting: true,
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 1)).toMatchObject({
      status: "resolved",
      routesToReporting: true,
    });
  });

  it("reports a match with no destination as unassigned, not resolved", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        destination_slot: null,
        routes_to_reporting: false,
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 1)).toMatchObject({
      status: "unassigned",
    });
  });

  it("lets the more recently implemented rule win", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        id: "old",
        letter: "A",
        destination_slot: 1,
        day_implemented_id: "day-1",
      }),
      ruleMatchingSender("Ada", {
        id: "new",
        letter: "B",
        destination_slot: 7,
        day_implemented_id: "day-2",
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 3)).toMatchObject({
      status: "resolved",
      slot: 7,
    });
  });

  it("ignores a matching rule that was never implemented", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        id: "undated",
        destination_slot: 1,
        day_implemented_id: null,
      }),
      ruleMatchingSender("Ada", {
        id: "dated",
        letter: "B",
        destination_slot: 9,
        day_implemented_id: "day-1",
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 1)).toMatchObject({
      status: "resolved",
      slot: 9,
    });
  });

  it("reports none when the only matching rule was never implemented", () => {
    const rules = [ruleMatchingSender("Ada", { day_implemented_id: null })];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 1)).toEqual({
      status: "none",
    });
  });

  it("flags equal-precedence rules that disagree as a conflict", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        id: "one",
        letter: "A",
        destination_slot: 2,
        day_implemented_id: "day-2",
      }),
      ruleMatchingSender("Ada", {
        id: "two",
        letter: "B",
        destination_slot: 5,
        day_implemented_id: "day-2",
      }),
    ];
    const result = resolveDestination(rules, ctx, DAY_NUMBERS, 2);
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.rules.map((r) => r.letter).sort()).toEqual(["A", "B"]);
    }
  });

  it("does not flag equal-precedence rules that agree", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        id: "one",
        letter: "A",
        destination_slot: 3,
        day_implemented_id: "day-2",
      }),
      ruleMatchingSender("Ada", {
        id: "two",
        letter: "B",
        destination_slot: 3,
        day_implemented_id: "day-2",
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 2)).toMatchObject({
      status: "resolved",
      slot: 3,
    });
  });

  it("ignores a rule that is not yet active on the letter's day", () => {
    const rules = [
      ruleMatchingSender("Ada", {
        id: "old",
        destination_slot: 1,
        day_implemented_id: "day-1",
      }),
      ruleMatchingSender("Ada", {
        id: "future",
        letter: "B",
        destination_slot: 8,
        day_implemented_id: "day-4",
      }),
    ];
    expect(resolveDestination(rules, ctx, DAY_NUMBERS, 2)).toMatchObject({
      status: "resolved",
      slot: 1,
    });
  });
});

// ── uniqueWinner ─────────────────────────────────────────────────────────────

describe("uniqueWinner", () => {
  const ctx = makeRuleContext({ sender_first_name: "Ada" });

  it("returns the sole top-rank match", () => {
    const rules = [ruleMatchingSender("Ada", { id: "only" })];
    expect(uniqueWinner(rules, ctx, DAY_NUMBERS, 1)?.id).toBe("only");
  });

  it("returns null when equal-rank rules tie, even agreeing ones", () => {
    const rules = [
      ruleMatchingSender("Ada", { id: "one", destination_slot: 3 }),
      ruleMatchingSender("Ada", { id: "two", letter: "B", destination_slot: 3 }),
    ];
    expect(uniqueWinner(rules, ctx, DAY_NUMBERS, 1)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(
      uniqueWinner([ruleMatchingSender("Grace")], ctx, DAY_NUMBERS, 1)
    ).toBeNull();
  });
});

// ── contextFromLetter ────────────────────────────────────────────────────────

const CITIZEN: Citizen = {
  id: "citizen-1",
  type: "hero",
  first_name: "Ada",
  last_name: "Lovelace",
  middle_name: "Byron",
  honorific: null,
  title: null,
  suffix: null,
  name_display_format: null,
  address_line: null,
  citizen_id: "A1B2",
  nation_id: "nation-1",
  city_id: "city-1",
  notes: null,
};

const LOOKUPS = makeLookups(
  [CITIZEN],
  [{ id: "city-1", name: "Pelico", code: "PL", nation_id: "nation-1" }],
  [
    {
      id: "nation-1",
      name: "Folos",
      abbreviation: null,
      color_hex: "#888888",
      sort_order: 0,
      icon_type: "lucide",
      icon_value: null,
    },
  ]
);

function letterFields(overrides: Record<string, unknown> = {}) {
  return {
    stamp_valid: true,
    sender_citizen_id: null,
    sender_name: null,
    sender_citizen_number: null,
    sender_city_id: null,
    sender_city_name: null,
    sender_city_code: null,
    sender_nation_id: null,
    recipient_citizen_id: null,
    recipient_name: null,
    recipient_citizen_number: null,
    recipient_city_id: null,
    recipient_city_name: null,
    recipient_city_code: null,
    recipient_nation_id: null,
    ...overrides,
  } as Parameters<typeof contextFromLetter>[0];
}

describe("contextFromLetter", () => {
  it("takes name parts from the linked citizen, including the middle name", () => {
    const ctx = contextFromLetter(
      letterFields({ sender_citizen_id: "citizen-1", sender_name: "Ada Lovelace" }),
      LOOKUPS,
      null
    );
    expect(ctx.sender_first_name).toBe("Ada");
    expect(ctx.sender_middle_name).toBe("Byron");
    expect(ctx.sender_last_name).toBe("Lovelace");
    expect(ctx.sender_citizen_id).toBe("A1B2");
  });

  it("splits a bare name when no citizen is linked, leaving the middle null", () => {
    const ctx = contextFromLetter(
      letterFields({ recipient_name: "Grace Brewster Hopper" }),
      LOOKUPS,
      null
    );
    expect(ctx.recipient_first_name).toBe("Grace Brewster");
    expect(ctx.recipient_middle_name).toBeNull();
    expect(ctx.recipient_last_name).toBe("Hopper");
  });

  it("resolves city and nation through their ids", () => {
    const ctx = contextFromLetter(
      letterFields({ sender_city_id: "city-1", sender_nation_id: "nation-1" }),
      LOOKUPS,
      null
    );
    expect(ctx.sender_city_name).toBe("Pelico");
    expect(ctx.sender_city_code).toBe("PL");
    expect(ctx.sender_nation).toBe("Folos");
  });

  it("falls back to the letter's own city text when no city is linked", () => {
    const ctx = contextFromLetter(
      letterFields({ sender_city_name: "Nowhere", sender_city_code: "NW" }),
      LOOKUPS,
      null
    );
    expect(ctx.sender_city_name).toBe("Nowhere");
    expect(ctx.sender_city_code).toBe("NW");
  });

  it("strips the display hash from a typed citizen number", () => {
    const ctx = contextFromLetter(
      letterFields({ recipient_citizen_number: "#C3D4" }),
      LOOKUPS,
      null
    );
    expect(ctx.recipient_citizen_id).toBe("C3D4");
  });
});

// ── attachConditions ─────────────────────────────────────────────────────────

describe("attachConditions", () => {
  it("groups conditions by rule and orders them by position", () => {
    const rules = [makeRule({ id: "r1" }), makeRule({ id: "r2", letter: "B" })];
    const conditions = [
      { ...makeRuleCondition({}), id: "c2", rule_id: "r1", position: 2 },
      { ...makeRuleCondition({}), id: "c1", rule_id: "r1", position: 1 },
      { ...makeRuleCondition({}), id: "c3", rule_id: "r2", position: 1 },
    ];
    const attached = attachConditions(rules, conditions);
    expect(attached[0].conditions).toHaveLength(2);
    expect(attached[1].conditions).toHaveLength(1);
  });

  it("gives a rule with no conditions an empty list", () => {
    const attached = attachConditions([makeRule({ id: "r1" })], []);
    expect(attached[0].conditions).toEqual([]);
  });
});
