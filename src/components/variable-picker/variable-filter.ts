import type { EndingVariableKind } from "@/lib/db/enums";

/**
 * Minimal structural shape the variable filter + option list need. Both
 * `VariableState` (endings block editor) and `EndingVariable` (db row)
 * satisfy it. Scoped to filtering + row rendering only — it is NOT a
 * shared variable model, and must not grow to imply `default_value_id`,
 * `sort_order`, or the ref fields exist.
 */
export interface VariableLike {
  id: string;
  name: string;
  kind: EndingVariableKind;
  color_index: number;
  color_hex: string | null;
}

// Output order of the kind-grouped filter; matches the option list's
// section order.
const KIND_ORDER: EndingVariableKind[] = [
  "text",
  "number_ref",
  "aggregate_ref",
];

/**
 * Case-insensitive filter, grouped by variable kind (text → number →
 * aggregate). Within each group: prefix matches first (alphabetical),
 * then substring matches (alphabetical). Result is a flat array so
 * keyboard nav stays a simple index; the option list inserts dividers
 * wherever consecutive items differ in kind.
 */
export function filterVariables<T extends VariableLike>(
  variables: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  const out: T[] = [];
  for (const kind of KIND_ORDER) {
    const group = variables.filter((v) => v.kind === kind);
    if (group.length === 0) continue;
    if (!q) {
      out.push(...group.sort((a, b) => a.name.localeCompare(b.name)));
      continue;
    }
    const prefix: T[] = [];
    const substring: T[] = [];
    for (const v of group) {
      const n = v.name.toLowerCase();
      if (n.startsWith(q)) prefix.push(v);
      else if (n.includes(q)) substring.push(v);
    }
    prefix.sort((a, b) => a.name.localeCompare(b.name));
    substring.sort((a, b) => a.name.localeCompare(b.name));
    out.push(...prefix, ...substring);
  }
  return out;
}
