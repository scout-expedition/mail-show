import type {
  AddressType,
  CitizenType,
  ContentRefType,
  DayOfWeek,
  EndingBlockType,
  EndingChipOperator,
  EndingDocumentKind,
  EndingVariableKind,
  IconType,
  Phase,
  RuleMatchMode,
  RuleOperator,
  RuleReferenceType,
  RuleTarget,
  RuleTargetSlice,
} from "@/lib/db/enums";

/** Minimal hand-maintained types for rows we commonly read.
 * (We could replace this with supabase-generated types later.) */

export interface Nation {
  id: string;
  name: string;
  abbreviation: string | null;
  color_hex: string;
  sort_order: number;
  icon_type: IconType;
  icon_value: string | null;
}

export interface City {
  id: string;
  name: string;
  code: string;
  nation_id: string;
}

export interface Citizen {
  id: string;
  type: CitizenType;
  name: string;
  citizen_id: string | null;
  nation_id: string | null;
  city_id: string | null;
  notes: string | null;
}

export interface Day {
  id: string;
  number: number;
  identifier: string;
  name: string | null;
  notes: string | null;
  until_qup: number | null;
  month: number | null;
  day_of_month: number | null;
  year: number | null;
  day_of_week: DayOfWeek | null;
  sort_phase_length_seconds: number | null;
  inspection_phase_length_seconds: number | null;
  base_report: string | null;
  report_sign_off: string | null;
  end_of_day_sign_off: string | null;
}

export interface Storyline {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
  sort_order: number;
}

export interface LetterGroup {
  id: string;
  storyline_id: string;
  name: string;
  notes: string | null;
  sequence: number;
  delivery_day_id: string | null;
}

export interface ReportGroup {
  id: string;
  letter_group_id: string;
  name: string;
  notes: string | null;
  display_order: number;
}

export interface InspectionLetter {
  id: string;
  letter_group_id: string;
  variant: string | null;
  piece: number | null;
  sort_order: number;
  delivery_day_override_id: string | null;
  summary: string | null;
  content: string | null;
  sender_citizen_id: string | null;
  receiver_citizen_id: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface InspectionLetterView extends InspectionLetter {
  effective_day_id: string | null;
  storyline_abbreviation: string;
  group_sequence: number;
  storyline_id: string;
  content_id: string;
}

export interface ActionTemplate {
  id: string;
  name: string;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
  sort_order: number;
  paired_template_id: string | null;
}

export interface ActionRow {
  id: string;
  inspection_letter_id: string;
  action_template_id: string | null;
  name: string;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
  report_segment_id: string | null;
  next_letter_variant: string | null;
  impact_world_status: number;
  impact_demerits: number;
  impact_proletariat: number;
  impact_gentry: number;
  impact_epicenter: number;
  impact_folos: number;
  impact_emberlyn: number;
  impact_spokgrad: number;
  impact_pelico: number;
  sort_order: number;
}

export interface ReportSegment {
  id: string;
  report_group_id: string;
  variant: string;
  summary: string | null;
  content: string | null;
  delivery_day_override_id: string | null;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

export interface ReportSegmentView extends ReportSegment {
  letter_group_id: string;
  storyline_id: string;
  storyline_abbreviation: string;
  group_sequence: number;
  report_id: string;
  effective_day_id: string | null;
}

export interface SortingLetter {
  id: string;
  day_id: string;
  sort_id: number;
  storage_location: string | null;
  is_counterfeit: boolean;
  recipient_type: AddressType;
  recipient_citizen_id: string | null;
  recipient_name: string | null;
  recipient_citizen_number: string | null;
  recipient_city_id: string | null;
  recipient_city_name: string | null;
  recipient_city_code: string | null;
  recipient_nation_id: string | null;
  sender_type: AddressType;
  sender_citizen_id: string | null;
  sender_name: string | null;
  sender_citizen_number: string | null;
  sender_city_id: string | null;
  sender_city_name: string | null;
  sender_city_code: string | null;
  sender_nation_id: string | null;
  notes: string | null;
}

export interface SortingLetterView extends SortingLetter {
  day_number: number;
  content_id: string;
}

export interface PhysicalLetter {
  id: string;
  letter_id: number;
  rfid_payload: string;
  content_ref_type: ContentRefType;
  content_ref_id: string;
  storage_location: string | null;
  notes: string | null;
}

export interface SortingRule {
  id: string;
  letter: string;
  storage_location: string | null;
  summary: string | null;
  day_implemented_id: string | null;
  destination_slot: number | null;
  match_mode: RuleMatchMode;
}

export interface SortingRuleCondition {
  id: string;
  rule_id: string;
  position: number;
  target: RuleTarget;
  target_slice: RuleTargetSlice;
  operator: RuleOperator;
  reference_value: string | null;
  reference_type: RuleReferenceType;
}

export interface Playthrough {
  id: string;
  name: string;
  notes: string | null;
  current_day_id: string | null;
  current_phase: Phase;
  is_active: boolean;
}

export interface PlaythroughActionChoice {
  id: string;
  playthrough_id: string;
  inspection_letter_id: string;
  chosen_action_id: string;
}

export interface PlaythroughVariables {
  playthrough_id: string;
  world_status: number;
  demerits: number;
  proletariat: number;
  gentry: number;
  epicenter: number;
  folos: number;
  emberlyn: number;
  spokgrad: number;
  pelico: number;
  combined_national: number;
}

export interface EndingVariable {
  id: string;
  name: string;
  default_value_id: string | null;
  sort_order: number;
  kind: EndingVariableKind;
  number_ref: string | null;
  aggregate_ref: string | null;
  color_index: number;
}

export interface EndingVariableValue {
  id: string;
  variable_id: string;
  value: string;
  sort_order: number;
}

/**
 * Unified document row introduced in 0022. A `framework`-kind document
 * carries the user-facing `name` (and `sort_order`) — that's the row a
 * Framework-tab consumer renders. Logic-kind documents are anonymous
 * singletons; one row per non-framework kind.
 */
export interface EndingDocument {
  id: string;
  kind: EndingDocumentKind;
  name: string | null;
  sort_order: number;
}

/**
 * Block in the unified tree. block_type is one of `text` | `condition` |
 * `result`. Exactly one of `text` / `result_value` is set per leaf block;
 * condition blocks have neither.
 */
export interface EndingBlock {
  id: string;
  document_id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: EndingBlockType;
  text: string | null;
  result_value: string | null;
  sort_order: number;
}

/**
 * Pre-0022 framework row. Retained so the Frameworks workspace keeps
 * compiling until step 2 of `docs/endings-logic-v2-plan.md` switches
 * those callers to `EndingDocument`. New code should use `EndingDocument`.
 */
export interface EndingFramework {
  id: string;
  name: string;
  sort_order: number;
}

/**
 * Pre-0022 framework block row. Retained alongside `EndingBlock` for the
 * same step-2 transition reason as `EndingFramework`. New code should
 * use `EndingBlock`.
 */
export interface EndingFrameworkBlock {
  id: string;
  framework_id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: "text" | "condition";
  text: string;
  sort_order: number;
}

export interface EndingConditionRow {
  id: string;
  condition_block_id: string;
  sort_order: number;
}

export interface EndingConditionBlockVariable {
  id: string;
  condition_block_id: string;
  variable_id: string;
  sort_order: number;
}

export interface EndingConditionRowChip {
  id: string;
  row_id: string;
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
  sort_order: number;
}

export interface EndingLogicRule {
  id: string;
  framework_id: string;
  sort_order: number;
}

export interface EndingLogicRuleCondition {
  id: string;
  rule_id: string;
  variable_id: string;
  value_id: string;
}

export interface InspectionActionEndingAssignment {
  id: string;
  action_id: string;
  variable_id: string;
  value_id: string;
}
