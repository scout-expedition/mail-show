import type { RuleCondition } from "./evaluate";
import type { RuleMatchMode } from "@/lib/db/enums";
import { RULE_TARGET_LABELS } from "@/lib/db/enums";

export interface ConditionContradiction {
  indices: number[];
  message: string;
}

/**
 * Detects sorting-rule conditions that can never be simultaneously true.
 *
 * Returns `[]` when `matchMode === "any"` — contradictions only kill an
 * "all"-mode rule because "any" only requires one condition to pass.
 *
 * Within each group (same target + target_slice) the detector looks for:
 *  1. Boolean clash: a condition implying true and another implying false.
 *  2. Equality clash: two `equals` conditions with different non-null string/number values.
 *  3. Numeric range clash: impossible intersection of gt/gte/lt/lte/equals(number) constraints.
 *
 * Deduplication: a given set of indices produces at most one record even if it
 * matches multiple detection paths.
 */
export function detectContradictions(
  conditions: RuleCondition[],
  matchMode: RuleMatchMode,
): ConditionContradiction[] {
  // Pair contradictions only kill an "all"-mode rule. In "any" mode just one
  // condition needs to pass; in "exclusive" mode (Or, XOR) a pair that can't
  // both be true is actually consistent — the rule still passes when exactly
  // one fires. So we suppress the detector for both non-conjunctive modes.
  if (matchMode !== "all") return [];

  // Group condition indices by identity key (target + target_slice).
  const groups = new Map<string, number[]>();
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    const key = `${c.target}::${c.target_slice}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(key, [i]);
    }
  }

  // Track reported index-sets to avoid duplicates across detection paths.
  const reported = new Set<string>();
  const results: ConditionContradiction[] = [];

  function report(indices: number[], message: string): void {
    const sorted = [...indices].sort((a, b) => a - b);
    const key = sorted.join(",");
    if (!reported.has(key)) {
      reported.add(key);
      results.push({ indices: sorted, message });
    }
  }

  for (const [, idxs] of groups) {
    if (idxs.length < 2) continue;

    const group = idxs.map((i) => ({ i, c: conditions[i] }));
    const target = group[0].c.target;
    const targetLabel = RULE_TARGET_LABELS[target];

    // -----------------------------------------------------------------------
    // 1. Implied (in)equality clash.
    //
    // Each condition can imply "target = V" or "target ≠ V" via:
    //   equals V             → eq V
    //   not_equals V         → neq V
    //   is "..." (string)    → eq V       (value-equals via picker, e.g. city)
    //   is_not "..." (string) → neq V
    //   is true / is false   → eq "true" / eq "false"
    //   is_not true/false    → eq "false" / eq "true"  (bool has only two values)
    //
    // Pairs that contradict:
    //   eq V + eq W (V ≠ W)
    //   eq V + neq V
    // -----------------------------------------------------------------------
    type Implied = { kind: "eq" | "neq"; value: string; i: number };
    const implied: Implied[] = [];
    for (const { i, c } of group) {
      const r = c.reference_value;
      if (c.operator === "is" && c.reference_type === "true") {
        implied.push({ kind: "eq", value: "true", i });
      } else if (c.operator === "is" && c.reference_type === "false") {
        implied.push({ kind: "eq", value: "false", i });
      } else if (c.operator === "is_not" && c.reference_type === "true") {
        implied.push({ kind: "eq", value: "false", i });
      } else if (c.operator === "is_not" && c.reference_type === "false") {
        implied.push({ kind: "eq", value: "true", i });
      } else if (
        (c.operator === "equals" ||
          (c.operator === "is" && c.reference_type === "string")) &&
        r != null
      ) {
        implied.push({ kind: "eq", value: r, i });
      } else if (
        (c.operator === "not_equals" ||
          (c.operator === "is_not" && c.reference_type === "string")) &&
        r != null
      ) {
        implied.push({ kind: "neq", value: r, i });
      }
    }
    for (let a = 0; a < implied.length; a++) {
      for (let b = a + 1; b < implied.length; b++) {
        const x = implied[a];
        const y = implied[b];
        if (x.kind === "eq" && y.kind === "eq" && x.value !== y.value) {
          // Bool targets (true/false) read more naturally without quotes.
          const bothBool =
            (x.value === "true" || x.value === "false") &&
            (y.value === "true" || y.value === "false");
          const message = bothBool
            ? `${targetLabel} can't be both true and false.`
            : `${targetLabel} can't equal both "${x.value}" and "${y.value}".`;
          report([x.i, y.i], message);
        } else if (
          x.kind !== y.kind &&
          x.value === y.value
        ) {
          report(
            [x.i, y.i],
            `${targetLabel} can't both equal and not equal "${x.value}".`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. Contains / not-contains clash on the same substring.
    // -----------------------------------------------------------------------
    const contains = group.filter(
      ({ c }) => c.operator === "contains" && c.reference_value != null,
    );
    const notContains = group.filter(
      ({ c }) => c.operator === "not_contains" && c.reference_value != null,
    );
    for (const { i, c } of contains) {
      for (const { i: j, c: c2 } of notContains) {
        if (c.reference_value === c2.reference_value) {
          report(
            [i, j],
            `${targetLabel} can't both contain and not contain "${c.reference_value}".`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // 3. Numeric range clash.
    //    Collect numeric constraints, compute the effective feasible interval,
    //    and report a conflict if the interval is empty.
    //
    //    eq v  → point constraint [v, v]
    //    gt v  → lower bound (v, +∞)  — open
    //    gte v → lower bound [v, +∞)  — closed
    //    lt v  → upper bound (-∞, v)  — open
    //    lte v → upper bound (-∞, v]  — closed
    // -----------------------------------------------------------------------
    type NumConstraint = {
      i: number;
      type: "eq" | "gt" | "gte" | "lt" | "lte";
      v: number;
    };

    const numConstraints: NumConstraint[] = [];
    for (const { i, c } of group) {
      if (c.reference_value == null) continue;
      const v = Number(c.reference_value);
      if (!Number.isFinite(v)) continue;

      if (
        c.operator === "equals" &&
        (c.reference_type === "string" || c.reference_type === "number")
      ) {
        numConstraints.push({ i, type: "eq", v });
      } else if (c.operator === "gt") {
        numConstraints.push({ i, type: "gt", v });
      } else if (c.operator === "gte") {
        numConstraints.push({ i, type: "gte", v });
      } else if (c.operator === "lt") {
        numConstraints.push({ i, type: "lt", v });
      } else if (c.operator === "lte") {
        numConstraints.push({ i, type: "lte", v });
      }
    }

    if (numConstraints.length >= 2) {
      // Track the effective lower and upper bound with open/closed flags.
      // Each bound also accumulates the indices of all constraints that
      // participated in setting or tightening it (for reporting).
      type Bound = { val: number; closed: boolean; contributing: number[] };

      let lo: Bound = { val: -Infinity, closed: true, contributing: [] };
      let hi: Bound = { val: Infinity, closed: true, contributing: [] };

      for (const nc of numConstraints) {
        switch (nc.type) {
          case "eq": {
            // eq tightens the lower bound if it's higher than the current lo.
            if (nc.v > lo.val || (nc.v === lo.val && !lo.closed)) {
              lo = { val: nc.v, closed: true, contributing: [...lo.contributing, nc.i] };
            } else {
              lo = { ...lo, contributing: [...lo.contributing, nc.i] };
            }
            // eq tightens the upper bound if it's lower than the current hi.
            if (nc.v < hi.val || (nc.v === hi.val && !hi.closed)) {
              hi = { val: nc.v, closed: true, contributing: [...hi.contributing, nc.i] };
            } else {
              hi = { ...hi, contributing: [...hi.contributing, nc.i] };
            }
            break;
          }
          case "gt": {
            // gt replaces lo if it's strictly greater, OR same value but lo was closed
            // (an open bound is stricter than a closed bound at the same value).
            if (nc.v > lo.val || (nc.v === lo.val && lo.closed)) {
              lo = { val: nc.v, closed: false, contributing: [...lo.contributing, nc.i] };
            } else {
              lo = { ...lo, contributing: [...lo.contributing, nc.i] };
            }
            break;
          }
          case "gte": {
            if (nc.v > lo.val) {
              lo = { val: nc.v, closed: true, contributing: [...lo.contributing, nc.i] };
            } else {
              lo = { ...lo, contributing: [...lo.contributing, nc.i] };
            }
            break;
          }
          case "lt": {
            if (nc.v < hi.val || (nc.v === hi.val && hi.closed)) {
              hi = { val: nc.v, closed: false, contributing: [...hi.contributing, nc.i] };
            } else {
              hi = { ...hi, contributing: [...hi.contributing, nc.i] };
            }
            break;
          }
          case "lte": {
            if (nc.v < hi.val) {
              hi = { val: nc.v, closed: true, contributing: [...hi.contributing, nc.i] };
            } else {
              hi = { ...hi, contributing: [...hi.contributing, nc.i] };
            }
            break;
          }
        }
      }

      // Intersection is empty when lo > hi, or lo === hi with either bound open.
      const empty =
        lo.val > hi.val ||
        (lo.val === hi.val && (!lo.closed || !hi.closed));

      if (empty) {
        const conflictIndices = [
          ...new Set([...lo.contributing, ...hi.contributing]),
        ];
        report(
          conflictIndices.length > 0 ? conflictIndices : numConstraints.map((nc) => nc.i),
          `${targetLabel} conditions produce an impossible numeric range.`,
        );
      }
    }
  }

  return results;
}
