// Phase 1 of the @[Variable Name] interpolation feature. Pure function,
// no React, no DB. Called from the evaluator's text-block render path so
// every surface that runs evaluation (framework preview, logic preview,
// future playthrough) picks it up automatically.
//
// Storage shape: `@[Variable Name]` is stored verbatim in
// `ending_blocks.text`. No migration. Renaming a variable breaks the
// reference (the substitution falls through to literal). See
// docs/plans/archive/endings-text-substitution-plan.md for trade-offs.

import type { EvalVariable, PreviewSelections } from "./evaluator";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

// Inlined to avoid a circular value import from evaluator.ts (which now
// imports this module). Must stay in sync with `aggregateKey` in
// evaluator.ts.
function aggKey(ref: string, side: "top" | "bottom"): string {
  return `${ref}|${side}`;
}

// Matches `@[NAME]` where NAME is one-or-more chars that aren't a `]`.
// Negative lookbehind blocks `email@[host.com]` and `@@[Name]` from
// triggering substitution — the leading `@` must not follow an
// alphanumeric or another `@`. Whitespace and punctuation are fine, so
// `Hello, @[Name]!` substitutes as expected.
//
// Variable names containing `]` are not supported — the inner class
// `[^\]]+` stops at the first `]`. Authors should pick names without
// brackets; the UNIQUE constraint on `ending_variables.name` doesn't
// prevent `]` per se, but it's an unsupported character for this token
// syntax.
export const TOKEN_RE = /(?<![A-Za-z0-9@])@\[([^\]]+)\]/g;

export interface SubstitutionContext {
  /** Name → variable lookup. Built once per evaluation in buildIndexes. */
  variableByName: Map<string, EvalVariable>;
  /** Preview selections (text choices, numeric inputs, pre-resolved
   *  aggregate winners). */
  selections: PreviewSelections;
  /** ending_variable_values.id → .value (display label). Built once
   *  per evaluation in buildIndexes. */
  valuesById: Map<string, string>;
}

/**
 * A typed slice of substitution output. Used by preview surfaces to
 * color value substitutions vs unresolved literals.
 *
 *  - `literal`: prose that wasn't part of a `@[Name]` token.
 *  - `value`: a token that was successfully resolved; `text` is the
 *     resolved display string and `variableName` is the source name.
 *  - `unresolved`: a token whose variable was unknown, unset, or
 *     produced no aggregate winner. `text` is the literal `@[Name]`
 *     fallback (same string the evaluator would emit), `variableName`
 *     is the captured name.
 */
export type SubstitutionSegment =
  | { kind: "literal"; text: string }
  | { kind: "value"; text: string; variableName: string }
  | { kind: "unresolved"; text: string; variableName: string };

/**
 * Tokenize `text` into resolved-value / unresolved-token / literal
 * segments. Same matching rules as `substituteVariables`; this is the
 * underlying primitive — `substituteVariables` just joins these
 * segments back into a string.
 */
export function substituteVariablesToSegments(
  text: string,
  ctx: SubstitutionContext
): SubstitutionSegment[] {
  const segments: SubstitutionSegment[] = [];
  let cursor = 0;
  // Cloning the regex avoids cross-call `lastIndex` state issues.
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "literal", text: text.slice(cursor, match.index) });
    }
    const name = match[1];
    const variable = ctx.variableByName.get(name);
    const resolved = variable ? resolveVariableValue(variable, ctx) : null;
    if (resolved != null) {
      segments.push({ kind: "value", text: resolved, variableName: name });
    } else {
      segments.push({ kind: "unresolved", text: match[0], variableName: name });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "literal", text: text.slice(cursor) });
  }
  return segments;
}

/**
 * Replace `@[Variable Name]` tokens in `text` with the variable's current
 * value resolved from `ctx`. Unknown variables, unset values, and
 * unresolved aggregates leave the literal token in place so authors can
 * spot typos and missing selections in preview output.
 *
 * Implemented as a string-flatten over `substituteVariablesToSegments`
 * so the two paths can't drift.
 */
export function substituteVariables(
  text: string,
  ctx: SubstitutionContext
): string {
  return substituteVariablesToSegments(text, ctx)
    .map((seg) => seg.text)
    .join("");
}

/**
 * Extract every `@[Name]` token from `text` and return the captured
 * names. Used by `DocumentEditor` to count text-block tags toward the
 * preview's "referenced variables" set so authors can dial in values for
 * variables that aren't otherwise referenced by chips.
 */
export function extractVariableTagNames(text: string): string[] {
  const names: string[] = [];
  // String.prototype.matchAll on a global regex returns each capture
  // group; cloning the regex isn't necessary because matchAll doesn't
  // consult lastIndex.
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function resolveVariableValue(
  variable: EvalVariable,
  ctx: SubstitutionContext
): string | null {
  if (variable.kind === "text") {
    const valueId = ctx.selections.textValueIds[variable.id];
    if (!valueId) return null;
    return ctx.valuesById.get(valueId) ?? null;
  }
  if (variable.kind === "number_ref") {
    const value = ctx.selections.numbers[variable.id];
    return value == null ? null : String(value);
  }
  if (variable.kind === "aggregate_ref") {
    const ref = variable.aggregate_ref;
    if (!ref) return null;
    // Default to "top" — the most common authoring intent for an
    // aggregate variable is "who's winning". A future "@[Var:bottom]"
    // form could opt into the loser, but Phase 1 doesn't ship it.
    const winner = ctx.selections.resolved_aggregates?.get(
      aggKey(ref, "top")
    );
    if (!winner) return null;
    return (VARIABLE_LABELS as Record<string, string>)[winner] ?? winner;
  }
  return null;
}
