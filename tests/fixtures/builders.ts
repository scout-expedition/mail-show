// Test data builders. Imported by unit and integration tests.
//
// Rule: every builder takes a `Partial<T>` of overrides and merges. Defaults
// should be the simplest valid value, not a "realistic" one — tests that need
// realism set it explicitly.

import type { RuleCondition, RuleContext } from "@/lib/rules/evaluate";
import type { ActionRow, Nation } from "@/lib/db/types";
import type { UserAvatarData } from "@/components/user-avatar";
import type {
  BlockState,
  BlockVariableState,
  ChipState,
  RowState,
} from "@/lib/endings/block-state";

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
    updated_at: new Date(0).toISOString(),
    updated_by: null,
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

export function makeBlockState(
  overrides: Partial<BlockState> = {}
): BlockState {
  return {
    id: "block-1",
    document_id: "doc-1",
    parent_block_id: null,
    parent_row_id: null,
    block_type: "text",
    text: "",
    result_value: null,
    summary: "",
    sort_order: 0,
    ...overrides,
  };
}

export function makeRowState(overrides: Partial<RowState> = {}): RowState {
  return {
    id: "row-1",
    condition_block_id: "block-1",
    sort_order: 0,
    ...overrides,
  };
}

export function makeBlockVariableState(
  overrides: Partial<BlockVariableState> = {}
): BlockVariableState {
  return {
    id: "blockvar-1",
    condition_block_id: "block-1",
    variable_id: "var-1",
    sort_order: 0,
    ...overrides,
  };
}

export function makeChipState(overrides: Partial<ChipState> = {}): ChipState {
  return {
    id: "chip-1",
    row_id: "row-1",
    variable_id: "var-1",
    operator: "=",
    text_value_id: null,
    number_value: null,
    aggregate_value: null,
    sort_order: 0,
    ...overrides,
  };
}

export function makeUserAvatarData(
  overrides: Partial<UserAvatarData> = {}
): UserAvatarData {
  return {
    display_name: null,
    avatar_icon_type: null,
    avatar_icon_value: null,
    avatar_color_hex: null,
    ...overrides,
  };
}

export function makeRuleContext(
  overrides: Partial<RuleContext> = {}
): RuleContext {
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
    stamp_valid: true,
    current_day_of_week: null,
    ...overrides,
  };
}
