// Enum values mirrored from supabase/migrations/0001_init.sql.

export const ICON_TYPES = ["lucide", "tabler", "emoji", "svg"] as const;
export type IconType = (typeof ICON_TYPES)[number];

export const CITIZEN_TYPES = ["hero", "npc"] as const;
export type CitizenType = (typeof CITIZEN_TYPES)[number];

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const PHASES = [
  "top_of_day",
  "sorting",
  "inspection",
  "end_of_day",
] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  top_of_day: "Top of Day",
  sorting: "Sorting",
  inspection: "Inspection",
  end_of_day: "End of Day",
};

export const ADDRESS_TYPES = [
  "full",
  "lookup_1",
  "lookup_2",
  "lookup_3",
] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];
export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  full: "Full address",
  lookup_1: "1-lookup (no nation)",
  lookup_2: "2-lookup (no nation, no city name)",
  lookup_3: "3-lookup (name + citizen ID only)",
};

export const CONTENT_REF_TYPES = ["sorting", "inspection"] as const;
export type ContentRefType = (typeof CONTENT_REF_TYPES)[number];

export const RULE_MATCH_MODES = ["all", "any"] as const;
export type RuleMatchMode = (typeof RULE_MATCH_MODES)[number];

export const RULE_TARGETS = [
  "sender_name",
  "sender_citizen_id",
  "sender_city_name",
  "sender_city_code",
  "sender_nation",
  "recipient_name",
  "recipient_citizen_id",
  "recipient_city_name",
  "recipient_city_code",
  "recipient_nation",
  "is_counterfeit",
  "current_day_of_week",
] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];
export const RULE_TARGET_LABELS: Record<RuleTarget, string> = {
  sender_name: "Sender name",
  sender_citizen_id: "Sender citizen ID",
  sender_city_name: "Sender city name",
  sender_city_code: "Sender city code",
  sender_nation: "Sender nation",
  recipient_name: "Recipient name",
  recipient_citizen_id: "Recipient citizen ID",
  recipient_city_name: "Recipient city name",
  recipient_city_code: "Recipient city code",
  recipient_nation: "Recipient nation",
  is_counterfeit: "Is counterfeit",
  current_day_of_week: "Current day of week",
};

export const RULE_TARGET_SLICES = ["whole", "first_char", "last_char"] as const;
export type RuleTargetSlice = (typeof RULE_TARGET_SLICES)[number];
export const RULE_TARGET_SLICE_LABELS: Record<RuleTargetSlice, string> = {
  whole: "whole",
  first_char: "first character",
  last_char: "last character",
};

export const RULE_OPERATORS = [
  "equals",
  "contains",
  "is",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: "=",
  contains: "contains",
  is: "is",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

export const RULE_REFERENCE_TYPES = [
  "string",
  "number",
  "any_number",
  "even",
  "odd",
  "letter",
  "true",
  "false",
] as const;
export type RuleReferenceType = (typeof RULE_REFERENCE_TYPES)[number];

/** Human-readable label shown in the reference-type dropdown. */
export const RULE_REFERENCE_TYPE_LABELS: Record<RuleReferenceType, string> = {
  string: "this string",
  number: "this number",
  any_number: "a number",
  even: "an even number",
  odd: "an odd number",
  letter: "a letter",
  true: "true",
  false: "false",
};

/** Reference types that require the user to supply an explicit value. */
export const REFERENCE_TYPES_WITH_VALUE: RuleReferenceType[] = [
  "string",
  "number",
];

/** Reference types that demand a numeric value when present. */
export const NUMERIC_REFERENCE_TYPES: RuleReferenceType[] = [
  "number",
  "any_number",
  "even",
  "odd",
];

/**
 * Valid operator × reference_type combinations.
 * equals  → this string / this number        (exact match)
 * contains → this string / this number
 * is      → a number / an even / an odd / a letter / true / false
 * gt/gte/lt/lte → this number
 */
export const VALID_OPERATOR_REFERENCES: Record<RuleOperator, RuleReferenceType[]> = {
  equals: ["string", "number"],
  contains: ["string", "number"],
  is: ["any_number", "even", "odd", "letter", "true", "false"],
  gt: ["number"],
  gte: ["number"],
  lt: ["number"],
  lte: ["number"],
};

/** Targets that never take a reference value (is_counterfeit only pairs with true/false). */
export const BOOLEAN_TARGETS: RuleTarget[] = ["is_counterfeit"];

// Endings — chip operator + variable kind. Mirrored from
// supabase/migrations/0014_endings_v3.sql + 0020_endings_aggregate.sql
// CHECK constraints.

export const ENDING_CHIP_OPERATORS = [
  "=",
  "≠",
  "<",
  "≤",
  ">",
  "≥",
  "top=",
  "top≠",
  "bottom=",
  "bottom≠",
  // Set-narrowing operators for the nation tiebreak docs. Evaluated
  // against the *working* tiebreak set during a set-narrowing pass —
  // not against any score column. Outside a tiebreak context the
  // evaluator returns false.
  "set_includes",
  "set_excludes",
] as const;
export type EndingChipOperator = (typeof ENDING_CHIP_OPERATORS)[number];

export const ENDING_VARIABLE_KINDS = [
  "text",
  "number_ref",
  "aggregate_ref",
] as const;
export type EndingVariableKind = (typeof ENDING_VARIABLE_KINDS)[number];

/** Operators allowed for each variable kind. */
export const ENDING_OPERATORS_BY_KIND: Record<
  EndingVariableKind,
  EndingChipOperator[]
> = {
  text: ["=", "≠"],
  number_ref: ["=", "≠", "<", "≤", ">", "≥"],
  aggregate_ref: [
    "top=",
    "top≠",
    "bottom=",
    "bottom≠",
    "set_includes",
    "set_excludes",
  ],
};

/**
 * Aggregate refs. `class_affinity` + `nation_affinity` (0020) compare
 * impact-column scores via `top=` / `bottom=`. `nation_tiebreak_set`
 * (0028) is the dedicated home for set-narrowing chips on nation
 * tiebreak docs — the chip's `aggregate_value` is a nation column
 * name, but the operators are `set_includes` / `set_excludes` which
 * consult the working tiebreak set rather than scoring columns.
 */
export const AGGREGATE_REFS = [
  "class_affinity",
  "nation_affinity",
  "nation_tiebreak_set",
] as const;
export type AggregateRef = (typeof AGGREGATE_REFS)[number];

/**
 * Underlying impact-column / set-membership values compared by each
 * aggregate ref. The chip's aggregate_value is one of them.
 */
export const AGGREGATE_OPTIONS_BY_REF: Record<AggregateRef, string[]> = {
  class_affinity: ["proletariat", "gentry"],
  nation_affinity: ["folos", "emberlyn", "spokgrad", "pelico", "epicenter"],
  nation_tiebreak_set: [
    "folos",
    "emberlyn",
    "spokgrad",
    "pelico",
    "epicenter",
  ],
};

/** Friendly labels for aggregate operators in the picker / chip UI. */
export const AGGREGATE_OPERATOR_LABELS: Record<string, string> = {
  "top=": "top is",
  "top≠": "top is not",
  "bottom=": "bottom is",
  "bottom≠": "bottom is not",
  set_includes: "includes",
  set_excludes: "excludes",
};

// Endings — document kinds + block types. Mirrored from
// supabase/migrations/0022_endings_logic_v2.sql.

export const ENDING_DOCUMENT_KINDS = [
  "framework",
  "framework_selection",
  "class_affinity_top",
  "nation_affinity_top",
  "nation_affinity_bottom",
] as const;
export type EndingDocumentKind = (typeof ENDING_DOCUMENT_KINDS)[number];

/** Non-`framework` kinds — the four tiebreak/selection docs surfaced under the Logic tab.
 *
 * Class affinity has only 2 options, so its bottom-on-tie is redundant
 * (the option that isn't the top winner). Only `class_affinity_top` is
 * stored; `TIEBREAK_KIND_BY_REF_SIDE` flips an `invert` flag for
 * `class_affinity.bottom` so the evaluator derives the bottom from the
 * top doc's result. */
export const ENDING_LOGIC_KINDS = [
  "framework_selection",
  "class_affinity_top",
  "nation_affinity_top",
  "nation_affinity_bottom",
] as const satisfies readonly Exclude<EndingDocumentKind, "framework">[];
export type EndingLogicKind = (typeof ENDING_LOGIC_KINDS)[number];

export const ENDING_DOCUMENT_KIND_LABELS: Record<EndingDocumentKind, string> = {
  framework: "Framework",
  framework_selection: "Framework Logic",
  class_affinity_top: "Tiebreak",
  nation_affinity_top: "Top",
  nation_affinity_bottom: "Bottom",
};

/** Tab grouping for the Logic page. */
export const ENDING_LOGIC_TABS = [
  { id: "framework_selection", label: "Ending", kinds: ["framework_selection"] as const },
  {
    id: "class_affinity",
    label: "Class Tiebreak",
    kinds: ["class_affinity_top"] as const,
  },
  {
    id: "nation_affinity",
    label: "Nation Tiebreak",
    kinds: ["nation_affinity_top", "nation_affinity_bottom"] as const,
  },
] as const;

/**
 * Allowed result_value sets for each logic doc kind.
 *
 * `framework_selection` is resolved at runtime from the framework documents
 * (the picker offers each `kind='framework'` document by id), so it's null
 * here.
 */
export const ENDING_LOGIC_RESULT_OPTIONS_BY_KIND: Record<
  EndingLogicKind,
  readonly string[] | null
> = {
  framework_selection: null,
  class_affinity_top: AGGREGATE_OPTIONS_BY_REF.class_affinity,
  nation_affinity_top: AGGREGATE_OPTIONS_BY_REF.nation_affinity,
  nation_affinity_bottom: AGGREGATE_OPTIONS_BY_REF.nation_affinity,
};

/**
 * Map from aggregate ref + side to the tiebreak doc kind, plus an
 * `invert` flag for the 2-option-aggregate special case.
 *
 * Class affinity has only 2 options (proletariat, gentry), so a single
 * `class_affinity_top` document covers both sides — knowing the top in
 * a tie tells you the bottom (the other option). The evaluator reads
 * `invert: true` for the bottom side and resolves the bottom value as
 * the option from `AGGREGATE_OPTIONS_BY_REF[ref]` that the top doc
 * didn't return.
 */
/** Aggregate refs that participate in score-based top/bottom
 *  tiebreak resolution. `nation_tiebreak_set` is excluded — it's a
 *  set-membership concept, not a scoring axis, and has no
 *  corresponding tiebreak doc. */
export type ScoringAggregateRef = Exclude<AggregateRef, "nation_tiebreak_set">;

export const TIEBREAK_KIND_BY_REF_SIDE: Record<
  ScoringAggregateRef,
  Record<"top" | "bottom", { kind: EndingLogicKind; invert: boolean }>
> = {
  class_affinity: {
    top: { kind: "class_affinity_top", invert: false },
    bottom: { kind: "class_affinity_top", invert: true },
  },
  nation_affinity: {
    top: { kind: "nation_affinity_top", invert: false },
    bottom: { kind: "nation_affinity_bottom", invert: false },
  },
};

export const ENDING_BLOCK_TYPES = [
  "text",
  "condition",
  "result",
  "fallback",
] as const;
export type EndingBlockType = (typeof ENDING_BLOCK_TYPES)[number];

/**
 * Sentinel `result_value`s for "pick a random option at evaluation
 * time". The evaluator expands them at call sites:
 *
 *   - `__random_tied__` → for aggregate tiebreak result blocks, pick
 *     uniformly from the currently-tied options. The "I'm picking who
 *     wins from the tied set" semantic.
 *   - `__random_all__` → pick uniformly from every option in the
 *     aggregate's column set (or every framework, for
 *     framework_selection). May land on a non-tied option for an
 *     aggregate tiebreak; the chip then evaluates false unless that
 *     option happened to be tied.
 *
 * `__random__` is preserved as an alias for `__random_tied__` (the
 * pre-split behavior). Existing rows with that value behave identically
 * after this change.
 *
 * Stored in `ending_blocks.result_value` directly; `validateResultValue`
 * accepts any of them bypassing the per-kind option list. The preview
 * keeps the resolution stable across renders by rolling once via
 * `resolveAggregates`.
 */
export const RANDOM_RESULT_SENTINEL = "__random__";
export const RANDOM_TIED_SENTINEL = "__random_tied__";
export const RANDOM_ALL_SENTINEL = "__random_all__";
/** Pick uniformly from the *working* tiebreak set at the moment the
 *  leaf fires. Only meaningful inside a nation tiebreak doc evaluated
 *  with set-narrowing semantics; outside that context falls through. */
export const RANDOM_REMAINING_SENTINEL = "__random_remaining__";

/**
 * Set-narrowing result_value: removes one nation from the working
 * tiebreak set instead of returning a definite result. Format:
 * `__remove__:<nation_name>` (e.g. `__remove__:spokgrad`). The
 * evaluator continues evaluation after applying the removal.
 */
export const REMOVE_SENTINEL_PREFIX = "__remove__:";

export function formatRemoveSentinel(nation: string): string {
  return `${REMOVE_SENTINEL_PREFIX}${nation}`;
}

export function parseRemoveSentinel(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  if (!value.startsWith(REMOVE_SENTINEL_PREFIX)) return null;
  const rest = value.slice(REMOVE_SENTINEL_PREFIX.length);
  return rest.length > 0 ? rest : null;
}

/**
 * Custom-subset random for `framework_selection` result blocks. Author
 * picks a specific list of framework document_ids to randomize over;
 * runtime expansion uniformly samples one of them. Storage is the
 * prefix followed by a JSON array of UUIDs:
 *
 *   __random_subset__:["fwId1","fwId2","fwId3"]
 *
 * `parseRandomSubset` returns the id array, or `null` if the value
 * isn't a subset sentinel or the JSON payload doesn't parse to a
 * non-empty array of strings.
 */
export const RANDOM_SUBSET_SENTINEL_PREFIX = "__random_subset__:";

export const RANDOM_SENTINELS = [
  RANDOM_RESULT_SENTINEL,
  RANDOM_TIED_SENTINEL,
  RANDOM_ALL_SENTINEL,
  RANDOM_REMAINING_SENTINEL,
] as const;

export function isRandomSentinel(value: string | null | undefined): boolean {
  if (value == null) return false;
  return (
    value === RANDOM_RESULT_SENTINEL ||
    value === RANDOM_TIED_SENTINEL ||
    value === RANDOM_ALL_SENTINEL ||
    value === RANDOM_REMAINING_SENTINEL ||
    value.startsWith(RANDOM_SUBSET_SENTINEL_PREFIX)
  );
}

export function formatRandomSubset(ids: readonly string[]): string {
  return `${RANDOM_SUBSET_SENTINEL_PREFIX}${JSON.stringify(ids)}`;
}

export function parseRandomSubset(
  value: string | null | undefined
): string[] | null {
  if (value == null) return null;
  if (!value.startsWith(RANDOM_SUBSET_SENTINEL_PREFIX)) return null;
  const json = value.slice(RANDOM_SUBSET_SENTINEL_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return null;
  if (!parsed.every((v): v is string => typeof v === "string")) return null;
  return parsed;
}
