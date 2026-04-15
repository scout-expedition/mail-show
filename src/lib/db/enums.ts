// Enum values mirrored from supabase/migrations/0001_init.sql.

export const ICON_TYPES = ["lucide", "svg", "emoji"] as const;
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
  equals: "equals",
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
  "even",
  "odd",
  "letter",
  "true",
  "false",
] as const;
export type RuleReferenceType = (typeof RULE_REFERENCE_TYPES)[number];

/**
 * Valid operator × reference_type combinations.
 * equals  → string / number          (exact match)
 * contains → string / number
 * is      → number / even / odd / letter / true / false
 * gt/gte/lt/lte → number
 */
export const VALID_OPERATOR_REFERENCES: Record<RuleOperator, RuleReferenceType[]> = {
  equals: ["string", "number"],
  contains: ["string", "number"],
  is: ["number", "even", "odd", "letter", "true", "false"],
  gt: ["number"],
  gte: ["number"],
  lt: ["number"],
  lte: ["number"],
};

/** Targets that never take a reference value (is_counterfeit only pairs with true/false). */
export const BOOLEAN_TARGETS: RuleTarget[] = ["is_counterfeit"];
