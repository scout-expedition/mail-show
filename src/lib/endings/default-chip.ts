import {
  AGGREGATE_OPTIONS_BY_REF,
  type EndingChipOperator,
} from "@/lib/db/enums";
import type { VariableState, ChipState } from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";

export interface DefaultChipInput {
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
}

/**
 * Compute the default chip for a freshly-seeded chip on `variable`,
 * preferring a value not yet used by other chips on the same condition
 * block. Falls back to the variable's `default_value_id`, then the first
 * available value.
 *
 * Returns null when no value is reachable (e.g. text variable with zero
 * values defined yet); caller skips creating the chip in that case.
 *
 * Shared between the client `RowChipAdder` and the server's
 * `computeDefaultChip` so client optimistic seeding agrees with what the
 * server will pick after revalidate.
 */
export function computeDefaultChipFor(input: {
  variable: VariableState;
  values: ReadonlyArray<EndingVariableValue>;
  smartReturns?: ReadonlyArray<string>;
  usedValuesOnBlock: ReadonlyArray<ChipState>;
}): DefaultChipInput | null {
  const { variable, values, smartReturns, usedValuesOnBlock } = input;
  const usedForVariable = usedValuesOnBlock.filter(
    (c) => c.variable_id === variable.id
  );

  if (variable.kind === "text") {
    const variableValues = values
      .filter((v) => v.variable_id === variable.id)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    if (variableValues.length === 0) return null;
    const usedIds = new Set(
      usedForVariable
        .map((c) => c.text_value_id)
        .filter((id): id is string => Boolean(id))
    );
    const nextUnused = variableValues.find((v) => !usedIds.has(v.id));
    const chosen =
      nextUnused?.id ??
      variable.default_value_id ??
      variableValues[0].id;
    return {
      operator: "=",
      text_value_id: chosen,
      number_value: null,
      aggregate_value: null,
    };
  }

  if (variable.kind === "number_ref") {
    return {
      operator: "=",
      text_value_id: null,
      number_value: 0,
      aggregate_value: null,
    };
  }

  if (variable.kind === "aggregate_ref") {
    const aref = variable.aggregate_ref;
    if (!aref) return null;
    const operator: EndingChipOperator =
      aref === "nation_tiebreak_set" ? "set_includes" : "top=";
    const options = AGGREGATE_OPTIONS_BY_REF[aref] ?? [];
    if (options.length === 0) return null;
    const usedAggValues = new Set(
      usedForVariable
        .map((c) => c.aggregate_value)
        .filter((v): v is string => v != null)
    );
    const chosen =
      options.find((opt) => !usedAggValues.has(opt)) ?? options[0];
    return {
      operator,
      text_value_id: null,
      number_value: null,
      aggregate_value: chosen,
    };
  }

  if (variable.kind === "smart_ref") {
    const returns = smartReturns ?? [];
    const usedAggValues = new Set(
      usedForVariable
        .map((c) => c.aggregate_value)
        .filter((v): v is string => v != null)
    );
    const chosen =
      returns.find((r) => !usedAggValues.has(r)) ?? returns[0] ?? "";
    return {
      operator: "=",
      text_value_id: null,
      number_value: null,
      aggregate_value: chosen,
    };
  }

  return null;
}
