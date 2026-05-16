// Test data builders. Imported by unit and integration tests.
//
// Rule: every builder takes a `Partial<T>` of overrides and merges. Defaults
// should be the simplest valid value, not a "realistic" one — tests that need
// realism set it explicitly.

import type { RuleCondition, RuleContext } from "@/lib/rules/evaluate";
import type { ActionRow, Nation } from "@/lib/db/types";

export function makeRuleCondition(
  overrides: Partial<RuleCondition> = {}
): RuleCondition {
  return {
    target: "sender_name",
    target_slice: "whole",
    operator: "equals",
    reference_value: "Alice",
    reference_type: "string",
    ...overrides,
  };
}

export function makeAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "action-1",
    inspection_letter_id: "letter-1",
    action_template_id: null,
    name: "Test action",
    icon_type: "lucide",
    icon_value: null,
    color_hex: "#000000",
    report_segment_id: null,
    next_letter_id: null,
    impact_world_status: 0,
    impact_demerits: 0,
    impact_proletariat: 0,
    impact_gentry: 0,
    impact_epicenter: 0,
    impact_folos: 0,
    impact_emberlyn: 0,
    impact_spokgrad: 0,
    impact_pelico: 0,
    sort_order: 0,
    ...overrides,
  };
}

export function makeNation(overrides: Partial<Nation> = {}): Nation {
  return {
    id: "nation-1",
    name: "Folos",
    abbreviation: "F",
    color_hex: "#000000",
    sort_order: 0,
    icon_type: "lucide",
    icon_value: null,
    ...overrides,
  };
}

export function makeRuleContext(
  overrides: Partial<RuleContext> = {}
): RuleContext {
  return {
    sender_name: null,
    sender_citizen_id: null,
    sender_city_name: null,
    sender_city_code: null,
    sender_nation: null,
    recipient_name: null,
    recipient_citizen_id: null,
    recipient_city_name: null,
    recipient_city_code: null,
    recipient_nation: null,
    is_counterfeit: false,
    current_day_of_week: null,
    ...overrides,
  };
}
