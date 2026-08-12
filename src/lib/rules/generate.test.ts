import { describe, expect, it } from "vitest";
import { makeRuleCondition } from "../../../tests/fixtures/builders";
import type { Citizen, SortingRule } from "@/lib/db/types";
import type { RuleWithConditions } from "./destination";
import {
  addressColumns,
  clearedAddressColumns,
  makeCandidates,
  planLetters,
  type Candidate,
} from "./generate";

// ── fixtures ─────────────────────────────────────────────────────────────────

const DAY_NUMBERS = new Map([
  ["day-1", 1],
  ["day-2", 2],
]);

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: "citizen-1",
    type: "npc",
    first_name: "Ada",
    last_name: "Lovelace",
    middle_name: null,
    honorific: null,
    title: null,
    suffix: null,
    name_display_format: null,
    address_line: null,
    citizen_id: "A1B2",
    nation_id: null,
    city_id: null,
    notes: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<SortingRule> = {}): SortingRule {
  return {
    id: "rule-a",
    letter: "A",
    storage_location: null,
    summary: null,
    notes: null,
    color_hex: null,
    // Dated by default: a rule with no implemented day is never active, so an
    // undated one could never be a generation target.
    day_implemented_id: "day-1",
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

function candidatesNamed(...names: Array<[string, string]>): Candidate[] {
  return makeCandidates(
    names.map(([first, last], i) =>
      makeCitizen({ id: `citizen-${i}`, first_name: first, last_name: last })
    ),
    [],
    []
  );
}

/** Deterministic "shuffle" — always picks the first element of the range. */
const noShuffle = () => 0;

function plan(
  rules: RuleWithConditions[],
  candidates: Candidate[],
  count: number,
  used: Set<string> = new Set(),
  dayOfWeek: string | null = "monday"
) {
  return planLetters({
    rules,
    targetRuleId: rules[0].rule.id,
    dayNumber: 1,
    dayOfWeek,
    dayNumberById: DAY_NUMBERS,
    candidates,
    usedCitizenIds: used,
    count,
    rng: noShuffle,
  });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("planLetters", () => {
  it("builds pairs whose sender satisfies the rule", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Hopper",
          }),
        ],
      },
    ];
    const candidates = candidatesNamed(
      ["Grace", "Hopper"],
      ["Ada", "Lovelace"],
      ["Alan", "Turing"]
    );

    const result = plan(rules, candidates, 1);

    expect(result.shortfall).toBeUndefined();
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].sender.citizen.last_name).toBe("Hopper");
  });

  it("never pairs a citizen with themselves", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_first_name",
            operator: "contains",
            reference_type: "string",
            reference_value: "a",
          }),
        ],
      },
    ];
    const candidates = candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]);

    const result = plan(rules, candidates, 1);

    expect(result.pairs[0].sender.citizen.id).not.toBe(
      result.pairs[0].recipient.citizen.id
    );
  });

  it("prefers citizens not already used that day", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "not_equals",
            reference_type: "string",
            reference_value: "Nobody",
          }),
        ],
      },
    ];
    const candidates = candidatesNamed(
      ["Grace", "Hopper"],
      ["Ada", "Lovelace"],
      ["Alan", "Turing"]
    );
    // citizen-0 is spoken for; the planner should reach past it.
    const result = plan(rules, candidates, 1, new Set(["citizen-0"]));

    expect(result.pairs[0].sender.citizen.id).not.toBe("citizen-0");
  });

  it("reports the empty side when no citizen can be the sender", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Nonexistent",
          }),
        ],
      },
    ];

    const result = plan(rules, candidatesNamed(["Ada", "Lovelace"]), 1);

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/no citizen satisfies the sender conditions/i);
  });

  it("fails immediately when the rule only applies on another weekday", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "current_day_of_week",
            operator: "is",
            reference_type: "string",
            reference_value: "friday",
          }),
        ],
      },
    ];

    const result = plan(
      rules,
      candidatesNamed(["Ada", "Lovelace"], ["Alan", "Turing"]),
      3,
      new Set(),
      "monday"
    );

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/different day of the week/i);
  });

  it("forces the stamp value the rule demands", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "stamp_valid",
            operator: "is",
            reference_type: "false",
            reference_value: null,
          }),
        ],
      },
    ];

    const result = plan(rules, candidatesNamed(["Ada", "L"], ["Alan", "T"]), 1);

    expect(result.pairs[0].stampValid).toBe(false);
  });

  it("defaults to a valid stamp when the rule says nothing about it", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_first_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Ada",
          }),
        ],
      },
    ];

    const result = plan(rules, candidatesNamed(["Ada", "L"], ["Alan", "T"]), 1);

    expect(result.pairs[0].stampValid).toBe(true);
  });

  it("skips pairs a higher-precedence rule would capture", () => {
    const target = makeRule({
      id: "target",
      letter: "A",
      day_implemented_id: "day-1",
      destination_slot: 1,
    });
    const thief = makeRule({
      id: "thief",
      letter: "B",
      day_implemented_id: "day-1",
      destination_slot: 5,
    });
    const rules: RuleWithConditions[] = [
      {
        rule: target,
        conditions: [
          makeRuleCondition({
            target: "sender_first_name",
            operator: "contains",
            reference_type: "string",
            reference_value: "a",
          }),
        ],
      },
      {
        // Same precedence, different destination: any letter matching both is
        // a conflict, so the planner must avoid Grace entirely.
        rule: thief,
        conditions: [
          makeRuleCondition({
            target: "sender_first_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Grace",
          }),
        ],
      },
    ];
    const candidates = candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]);

    const result = planLetters({
      rules,
      targetRuleId: "target",
      dayNumber: 1,
      dayOfWeek: null,
      dayNumberById: DAY_NUMBERS,
      candidates,
      usedCitizenIds: new Set(),
      count: 1,
      rng: noShuffle,
    });

    expect(result.pairs[0]?.sender.citizen.first_name).toBe("Ada");
  });

  it("returns what it could build and says how short it fell", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Hopper",
          }),
        ],
      },
    ];
    // Only one citizen can be the sender, and a pair needs a distinct
    // recipient, so a second letter is impossible without reuse — which is
    // allowed, so both letters build but share the sender.
    const candidates = candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]);

    const result = plan(rules, candidates, 2);

    expect(result.pairs).toHaveLength(2);
    expect(result.pairs.every((p) => p.sender.citizen.last_name === "Hopper")).toBe(
      true
    );
  });

  it("refuses a rule with no conditions", () => {
    const rules: RuleWithConditions[] = [{ rule: makeRule(), conditions: [] }];

    const result = plan(rules, candidatesNamed(["Ada", "L"], ["Alan", "T"]), 1);

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/no conditions/i);
  });

  it("reports an empty citizen directory", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "sender_first_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Ada",
          }),
        ],
      },
    ];

    const result = plan(rules, [], 1);

    expect(result.shortfall).toMatch(/directory is empty/i);
  });
});

describe("recipient-side conditions", () => {
  it("reports the empty side when no citizen can be the recipient", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "recipient_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Nonexistent",
          }),
        ],
      },
    ];

    const result = plan(rules, candidatesNamed(["Ada", "Lovelace"]), 1);

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/no citizen satisfies the recipient conditions/i);
  });

  it("picks a recipient that satisfies the rule", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "recipient_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Hopper",
          }),
        ],
      },
    ];

    const result = plan(
      rules,
      candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]),
      1
    );

    expect(result.pairs[0].recipient.citizen.last_name).toBe("Hopper");
  });
});

describe("non-conjunctive rules", () => {
  it("satisfies an `any` rule through the bounded scan", () => {
    const rules: RuleWithConditions[] = [
      {
        // `any` can't be split per side, so the planner falls back to scanning
        // shuffled pairs rather than filtering pools.
        rule: makeRule({ match_mode: "any" }),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Hopper",
          }),
          makeRuleCondition({
            target: "recipient_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Nobody",
          }),
        ],
      },
    ];

    const result = plan(
      rules,
      candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]),
      1
    );

    expect(result.shortfall).toBeUndefined();
    expect(result.pairs[0].sender.citizen.last_name).toBe("Hopper");
  });

  it("gives up cleanly when no pair can satisfy the rule", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule({ match_mode: "any" }),
        conditions: [
          makeRuleCondition({
            target: "sender_last_name",
            operator: "equals",
            reference_type: "string",
            reference_value: "Nobody",
          }),
        ],
      },
    ];

    const result = plan(
      rules,
      candidatesNamed(["Grace", "Hopper"], ["Ada", "Lovelace"]),
      1
    );

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/no sender\/recipient pair/i);
  });

  it("reports a rule whose stamp conditions contradict each other", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule(),
        conditions: [
          makeRuleCondition({
            target: "stamp_valid",
            operator: "is",
            reference_type: "true",
            reference_value: null,
          }),
          makeRuleCondition({
            target: "stamp_valid",
            operator: "is",
            reference_type: "false",
            reference_value: null,
          }),
        ],
      },
    ];

    const result = plan(rules, candidatesNamed(["Ada", "L"], ["Alan", "T"]), 1);

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/contradicts itself about the stamp/i);
  });

  it("returns nothing for a rule id that no longer exists", () => {
    const rules: RuleWithConditions[] = [
      {
        rule: makeRule({ id: "real" }),
        conditions: [makeRuleCondition({})],
      },
    ];

    const result = planLetters({
      rules,
      targetRuleId: "deleted",
      dayNumber: 1,
      dayOfWeek: null,
      dayNumberById: DAY_NUMBERS,
      candidates: candidatesNamed(["Ada", "L"]),
      usedCitizenIds: new Set(),
      count: 1,
      rng: noShuffle,
    });

    expect(result.pairs).toHaveLength(0);
    expect(result.shortfall).toMatch(/no longer exists/i);
  });
});

describe("addressColumns", () => {
  it("denormalizes a citizen into the letter's columns", () => {
    const [candidate] = makeCandidates(
      [makeCitizen({ city_id: "city-1", nation_id: "nation-1" })],
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

    expect(addressColumns("sender", candidate)).toEqual({
      sender_citizen_id: "citizen-1",
      sender_name: "Ada Lovelace",
      // Stored raw, displayed with the hash.
      sender_citizen_number: "#A1B2",
      sender_city_id: "city-1",
      sender_city_name: "Pelico",
      sender_city_code: "PL",
      sender_nation_id: "nation-1",
    });
  });

  it("leaves the citizen number null when the citizen has no ID", () => {
    const [candidate] = makeCandidates(
      [makeCitizen({ citizen_id: null })],
      [],
      []
    );
    expect(addressColumns("recipient", candidate).recipient_citizen_number).toBeNull();
  });

  it("clears every column of one side", () => {
    expect(clearedAddressColumns("recipient")).toEqual({
      recipient_citizen_id: null,
      recipient_name: null,
      recipient_citizen_number: null,
      recipient_city_id: null,
      recipient_city_name: null,
      recipient_city_code: null,
      recipient_nation_id: null,
    });
  });
});

describe("makeCandidates", () => {
  it("denormalizes the citizen's city and nation", () => {
    const [candidate] = makeCandidates(
      [makeCitizen({ city_id: "city-1", nation_id: "nation-1" })],
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

    expect(candidate.cityName).toBe("Pelico");
    expect(candidate.cityCode).toBe("PL");
    expect(candidate.nationName).toBe("Folos");
  });

  it("leaves address text null for a citizen with no city", () => {
    const [candidate] = makeCandidates([makeCitizen()], [], []);
    expect(candidate.cityName).toBeNull();
    expect(candidate.nationName).toBeNull();
  });
});
