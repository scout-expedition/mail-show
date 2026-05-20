"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAYS_OF_WEEK,
  RULE_MATCH_MODE_DESCRIPTIONS,
  RULE_OPERATOR_LABELS,
  targetKind,
  type DayOfWeek,
  type RuleMatchMode,
  type RuleOperator,
  type RuleReferenceType,
  type RuleTargetSlice,
} from "@/lib/db/enums";
import type { City, Nation, SortingRuleCondition } from "@/lib/db/types";
import {
  comparatorLabel,
  isNumericValue,
  normalizeCharSet,
  normalizeCondition,
  operatorsFor,
  referenceTypesFor,
  slicesFor,
  type EditableCondition,
} from "@/lib/rules/normalize";
import {
  decodeTarget,
  encodeTarget,
  FIELD_OPTIONS,
  SUBJECT_OPTIONS,
  type CompositeTarget,
  type TargetField,
  type TargetSubject,
} from "@/lib/rules/condition-target";
import {
  detectContradictions,
  type ConditionContradiction,
} from "@/lib/rules/contradictions";
import { saveConditions } from "./actions";

// ── helpers ──────────────────────────────────────────────────────────────────

function toEditable(c: SortingRuleCondition): EditableCondition {
  return {
    target: c.target,
    target_slice: c.target_slice,
    operator: c.operator,
    reference_type: c.reference_type,
    reference_value: c.reference_value,
  };
}

function defaultCondition(): EditableCondition {
  // Recipient nation is a `is`/`is_not` matrix per `operatorsFor` — `equals`
  // would briefly render as a stray select value before `commit()` normalizes
  // it 600ms later. Start in a valid (operator, reference_type) shape so the
  // OperatorPill picks the right option from frame one.
  return {
    target: "recipient_nation",
    target_slice: "whole",
    operator: "is",
    reference_type: "string",
    reference_value: null,
  };
}

/** A condition the autosave must NOT write: a numeric-value comparator with
 *  an empty / non-numeric value. String / letter_set / digit_set values may
 *  be empty (set-membership of nothing is a defined "no match"). */
function hasNumericError(c: EditableCondition): boolean {
  if (c.reference_type === "number" || c.reference_type === "digit") {
    return !isNumericValue(c.reference_value ?? "");
  }
  return false;
}

/** Glyph rendered as the leftmost segment of the comparator pill, indicating
 *  what kind of input the value field accepts. Returns null when the picker /
 *  value form already makes the kind obvious (typecheck-only ref-types, the
 *  bool/nation/day/city pickers handled elsewhere). */
function comparatorGlyph(c: EditableCondition): string | null {
  const k = targetKind(c.target);
  const rt = c.reference_type;
  if (rt === "number" || rt === "digit" || rt === "digit_set") return "123";
  if (rt === "string") {
    if (k === "citizen_id" && c.target_slice === "whole") return "#";
    if (c.operator === "contains" || c.operator === "not_contains") {
      return "abc123";
    }
    return "abc";
  }
  if (rt === "letter_set") return "abc";
  return null;
}

// ── colors ───────────────────────────────────────────────────────────────────

const SUBJECT_PILL: Record<TargetSubject, { pill: string; divider: string }> = {
  sender: {
    pill: "border-emerald-500/45 bg-emerald-500/15 text-emerald-50",
    divider: "border-emerald-500/45",
  },
  recipient: {
    pill: "border-blue-500/45 bg-blue-500/15 text-blue-50",
    divider: "border-blue-500/45",
  },
  counterfeit: {
    pill: "border-pink-500/45 bg-pink-500/15 text-pink-50",
    divider: "border-pink-500/45",
  },
  day: {
    pill: "border-cyan-500/45 bg-cyan-500/15 text-cyan-50",
    divider: "border-cyan-500/45",
  },
};

const COMPARATOR_PILL = {
  value: {
    pill: "border-purple-500/45 bg-purple-500/15 text-purple-50",
    divider: "border-purple-500/45",
  },
  bool: {
    pill: "border-yellow-500/45 bg-yellow-500/15 text-yellow-50",
    divider: "border-yellow-500/45",
  },
  typecheck: {
    pill: "border-orange-500/45 bg-orange-500/15 text-orange-50",
    divider: "border-orange-500/45",
  },
  city: {
    pill: "border-teal-500/45 bg-teal-500/15 text-teal-50",
    divider: "border-teal-500/45",
  },
  day: {
    pill: "border-cyan-500/45 bg-cyan-500/15 text-cyan-50",
    divider: "border-cyan-500/45",
  },
};

function comparatorColor(t: RuleReferenceType) {
  if (t === "true" || t === "false") return COMPARATOR_PILL.bool;
  // Every value-bearing ref-type renders with the purple "value-input" palette;
  // type-check-only ref-types (letter / any_number / even / odd) get orange.
  // `digit` / `digit_set` are user-typed values just like `number` /
  // `letter_set`, so they share the value palette — without this branch the
  // pill rendered orange and broke the documented color invariant.
  if (
    t === "string" ||
    t === "number" ||
    t === "letter_set" ||
    t === "digit" ||
    t === "digit_set"
  ) {
    return COMPARATOR_PILL.value;
  }
  return COMPARATOR_PILL.typecheck;
}

const SLICE_OPTIONS: { value: RuleTargetSlice; label: string }[] = [
  { value: "whole", label: "whole" },
  { value: "first_char", label: "first char" },
  { value: "last_char", label: "last char" },
];

const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// ── pill primitives ──────────────────────────────────────────────────────────

/** A clickable pill segment backed by an invisible native <select>. */
function SelectSegment({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  display,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;
  /** Overrides the rendered label (defaults to the matching option's label). */
  display?: React.ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <span
      className={cn(
        "relative inline-flex cursor-pointer items-center whitespace-nowrap px-2",
        className
      )}
    >
      <span aria-hidden>{display ?? current?.label ?? value}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

// ── target pill ──────────────────────────────────────────────────────────────

function TargetPill({
  target,
  slice,
  onChange,
}: {
  target: EditableCondition["target"];
  slice: RuleTargetSlice;
  onChange: (next: { composite: CompositeTarget; slice: RuleTargetSlice }) => void;
}) {
  const composite = decodeTarget(target);
  const showField =
    composite.subject === "sender" || composite.subject === "recipient";
  const slices = slicesFor(target);
  const showSlice =
    showField && slices.length > 1 && composite.field !== "nation";

  function setSubject(v: string) {
    const subject = v as TargetSubject;
    if (subject === "day" || subject === "counterfeit") {
      onChange({ composite: { subject, field: null }, slice: "whole" });
    } else {
      onChange({
        composite: { subject, field: composite.field ?? "first_name" },
        slice,
      });
    }
  }

  function setField(v: string) {
    const field = v as TargetField;
    onChange({
      composite: { subject: composite.subject, field },
      slice: field === "nation" ? "whole" : slice,
    });
  }

  // Day-of-week / counterfeit live only on the subject pill — keeping them
  // off the field pill avoids a second entry point that read as redundant.
  const fieldOptions = FIELD_OPTIONS;

  const color = SUBJECT_PILL[composite.subject];
  return (
    <span
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-md border font-mono text-xs",
        color.pill
      )}
    >
      <SelectSegment
        value={composite.subject}
        options={SUBJECT_OPTIONS}
        onChange={setSubject}
        ariaLabel="Condition subject"
      />
      {showField ? (
        <SelectSegment
          value={composite.field ?? "first_name"}
          options={fieldOptions}
          onChange={setField}
          ariaLabel="Condition field"
          className={cn("border-l", color.divider)}
        />
      ) : null}
      {showSlice ? (
        <SelectSegment
          value={slice}
          options={SLICE_OPTIONS}
          onChange={(v) =>
            onChange({ composite, slice: v as RuleTargetSlice })
          }
          ariaLabel="Slice"
          className={cn("border-l", color.divider)}
          display={
            slice === "whole" ? (
              <span aria-hidden className="opacity-50">
                ⌄
              </span>
            ) : undefined
          }
        />
      ) : null}
    </span>
  );
}

// ── operator pill ────────────────────────────────────────────────────────────

function OperatorPill({
  target,
  slice,
  operator,
  onChange,
}: {
  target: EditableCondition["target"];
  slice: RuleTargetSlice;
  operator: RuleOperator;
  onChange: (op: RuleOperator) => void;
}) {
  const options = operatorsFor(target, slice);
  if (options.length <= 1) {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-border px-2 font-mono text-xs text-muted-foreground">
        {RULE_OPERATOR_LABELS[operator]}
      </span>
    );
  }
  return (
    <span className="inline-flex h-7 items-stretch rounded-md border border-border font-mono text-xs text-foreground">
      <SelectSegment
        value={operator}
        options={options.map((o) => ({
          value: o,
          label: RULE_OPERATOR_LABELS[o],
        }))}
        onChange={(v) => onChange(v as RuleOperator)}
        ariaLabel="Operator"
      />
    </span>
  );
}

// ── value-picker pills ───────────────────────────────────────────────────────

function NationPill({
  value,
  nations,
  onChange,
}: {
  value: string | null;
  nations: Nation[];
  onChange: (nationName: string) => void;
}) {
  const match = nations.find((n) => n.name === value);
  const missing = value != null && value !== "" && !match;
  const tint = match
    ? {
        borderColor: `${match.color_hex}99`,
        backgroundColor: `${match.color_hex}26`,
      }
    : undefined;
  return (
    <span
      className={cn(
        "relative inline-flex h-7 cursor-pointer items-center rounded-md border px-2 font-mono text-xs",
        missing
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : match
            ? "text-white"
            : "border-border text-muted-foreground"
      )}
      style={missing ? undefined : tint}
    >
      <span aria-hidden className="whitespace-nowrap">
        {match ? match.name : value ? value : "pick nation"}
      </span>
      <select
        value={match ? match.name : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Nation"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          pick nation
        </option>
        {nations.map((n) => (
          <option key={n.id} value={n.name}>
            {n.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function CityPill({
  value,
  cities,
  onChange,
}: {
  value: string | null;
  cities: City[];
  onChange: (cityName: string) => void;
}) {
  const sorted = useMemo(
    () => [...cities].sort((a, b) => a.name.localeCompare(b.name)),
    [cities]
  );
  const match = cities.find((c) => c.name === value);
  const missing = value != null && value !== "" && !match;
  const color = COMPARATOR_PILL.city;
  return (
    <span
      className={cn(
        "relative inline-flex h-7 cursor-pointer items-center rounded-md border px-2 font-mono text-xs",
        missing
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : color.pill
      )}
    >
      <span aria-hidden className="whitespace-nowrap">
        {match ? match.name : value ? value : "pick city"}
      </span>
      <select
        value={match ? match.name : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="City"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          pick city
        </option>
        {sorted.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function WeekdayPill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (day: string) => void;
}) {
  const known = DAYS_OF_WEEK.includes(value as DayOfWeek);
  const color = COMPARATOR_PILL.day;
  return (
    <span
      className={cn(
        "relative inline-flex h-7 cursor-pointer items-center rounded-md border px-2 font-mono text-xs",
        !known && value
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : color.pill
      )}
    >
      <span aria-hidden className="whitespace-nowrap">
        {known
          ? DAY_OF_WEEK_LABELS[value as DayOfWeek]
          : value
            ? value
            : "pick weekday"}
      </span>
      <select
        value={known ? (value as string) : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Day of week"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          pick weekday
        </option>
        {DAYS_OF_WEEK.map((d) => (
          <option key={d} value={d}>
            {DAY_OF_WEEK_LABELS[d]}
          </option>
        ))}
      </select>
    </span>
  );
}

// ── comparator pill ──────────────────────────────────────────────────────────

function ComparatorPill({
  condition,
  nations,
  cities,
  onChange,
  onBlurCommit,
}: {
  condition: EditableCondition;
  nations: Nation[];
  cities: City[];
  onChange: (patch: Partial<EditableCondition>) => void;
  /** Called on blur for fields that normalize their value (letter_set). */
  onBlurCommit: () => void;
}) {
  const k = targetKind(condition.target);

  // Counterfeit — fixed {true, false} dropdown.
  if (k === "counterfeit") {
    const color = COMPARATOR_PILL.bool;
    return (
      <span
        className={cn(
          "inline-flex h-7 items-stretch rounded-md border font-mono text-xs",
          color.pill
        )}
      >
        <SelectSegment
          value={condition.reference_type}
          options={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          onChange={(v) =>
            onChange({ reference_type: v as RuleReferenceType })
          }
          ariaLabel="Counterfeit"
        />
      </span>
    );
  }

  // Nation / Day / City-whole-`is` → dedicated value pickers.
  if (k === "nation") {
    return (
      <NationPill
        value={condition.reference_value}
        nations={nations}
        onChange={(name) => onChange({ reference_value: name })}
      />
    );
  }
  if (k === "day") {
    return (
      <WeekdayPill
        value={condition.reference_value}
        onChange={(day) => onChange({ reference_value: day })}
      />
    );
  }
  if (
    k === "city_name" &&
    condition.target_slice === "whole" &&
    (condition.operator === "is" || condition.operator === "is_not")
  ) {
    return (
      <CityPill
        value={condition.reference_value}
        cities={cities}
        onChange={(name) => onChange({ reference_value: name })}
      />
    );
  }

  // Generic comparator: ref-type picker (when 2+ options) + value widget.
  const types = referenceTypesFor(
    condition.target,
    condition.target_slice,
    condition.operator
  );
  const hasPicker = types.length > 1;
  const refType = condition.reference_type;
  const usesValue =
    refType === "string" ||
    refType === "number" ||
    refType === "letter_set" ||
    refType === "digit" ||
    refType === "digit_set";
  const numericError = hasNumericError(condition);
  const color = comparatorColor(refType);
  const glyph = comparatorGlyph(condition);

  // Input mask + width per ref-type.
  //   string + first/last char → 1 char ("this letter")
  //   digit → 1 digit ("this number")
  //   number → free-form numeric (gt/gte/lt/lte/equals on first/last char)
  //   letter_set / digit_set → free-form, canonicalized on blur
  const isSingleCharString =
    refType === "string" &&
    (condition.target_slice === "first_char" ||
      condition.target_slice === "last_char");
  const valueMaxLength =
    refType === "digit" ? 1 : isSingleCharString ? 1 : undefined;
  const valueInputMode: "numeric" | "text" =
    refType === "number" ||
    refType === "digit" ||
    refType === "digit_set"
      ? "numeric"
      : "text";
  const valueWidth = valueMaxLength === 1 ? "w-10" : "w-28";
  const placeholder =
    refType === "number"
      ? "0"
      : refType === "digit"
        ? "5"
        : refType === "digit_set"
          ? "0, 5, 9"
          : refType === "letter_set"
            ? "A, B, C"
            : isSingleCharString
              ? "A"
              : "value";

  function handleValueChange(raw: string) {
    let next = raw;
    // Digit-only masks: strip everything but digits (and commas/spaces for
    // the set form). Cheap to apply on each keystroke — keeps the field
    // tidy even when paste smuggles letters in.
    if (refType === "digit") {
      next = raw.replace(/\D/g, "").slice(0, 1);
    } else if (refType === "digit_set") {
      next = raw.replace(/[^0-9,\s]/g, "");
    } else if (isSingleCharString) {
      // "this letter" single-char input. The render has `text-center
      // uppercase` for visual polish, but CSS text-transform doesn't change
      // the value on `e.target.value` — so without an explicit `toUpperCase`
      // here the stored value would stay lowercase and the strict
      // `str === ref` check in `evalIs` would silently never match an
      // uppercase character (e.g. user types "a", value compared against
      // "Amsterdam".charAt(0) = "A" → false). Cap at one char too.
      next = raw.toUpperCase().slice(0, 1);
    }
    onChange({ reference_value: next });
  }

  return (
    <span
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-md border font-mono text-xs",
        numericError
          ? "border-destructive/60 bg-destructive/10 text-destructive"
          : color.pill
      )}
    >
      {hasPicker ? (
        <SelectSegment
          value={refType}
          options={types.map((t) => ({
            value: t,
            label: comparatorLabel(t, condition.target, condition.target_slice),
          }))}
          onChange={(v) =>
            // Clear the value field — switching between letter / digit /
            // letter_set / digit_set masks would otherwise leak old input
            // through a different mask.
            onChange({
              reference_type: v as RuleReferenceType,
              reference_value: null,
            })
          }
          ariaLabel="Comparator type"
        />
      ) : null}
      {usesValue && glyph ? (
        <span
          aria-hidden
          className={cn(
            "inline-flex items-center px-2 opacity-60",
            hasPicker && "border-l",
            hasPicker
              ? numericError
                ? "border-destructive/60"
                : color.divider
              : ""
          )}
        >
          {glyph}
        </span>
      ) : null}
      {usesValue ? (
        <span
          className={cn(
            "relative inline-flex items-center",
            (hasPicker || glyph) && "border-l",
            (hasPicker || glyph)
              ? numericError
                ? "border-destructive/60"
                : color.divider
              : ""
          )}
        >
          <input
            value={condition.reference_value ?? ""}
            onChange={(e) => handleValueChange(e.target.value)}
            onBlur={onBlurCommit}
            maxLength={valueMaxLength}
            inputMode={valueInputMode}
            placeholder={placeholder}
            aria-label="Comparator value"
            className={cn(
              "h-full bg-transparent px-2 outline-none placeholder:opacity-40",
              valueWidth,
              valueMaxLength === 1 && "text-center uppercase"
            )}
          />
        </span>
      ) : null}
    </span>
  );
}

// ── condition row ────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  nations,
  cities,
  contradiction,
  onChange,
  onLetterSetBlur,
  onRemove,
}: {
  condition: EditableCondition;
  nations: Nation[];
  cities: City[];
  contradiction: string | null;
  onChange: (next: EditableCondition) => void;
  onLetterSetBlur: () => void;
  onRemove: () => void;
}) {
  function patch(p: Partial<EditableCondition>) {
    onChange(normalizeCondition({ ...condition, ...p }));
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-1 rounded-md p-1",
        contradiction && "bg-destructive/5 ring-1 ring-destructive/40"
      )}
    >
      {contradiction ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
          title={contradiction}
        >
          <AlertTriangle size={10} aria-hidden />
          <span>{contradiction}</span>
        </span>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <TargetPill
          target={condition.target}
          slice={condition.target_slice}
          onChange={({ composite: next, slice }) => {
            const nextTarget = encodeTarget(next);
            // Clear the value when the subject or field changes — a stale
            // name like "Alice" would otherwise persist into a nation /
            // weekday / counterfeit condition where it's meaningless (the
            // dedicated pickers mark it as "missing" but it'd still write
            // to the DB on save). Mirrors the same clear we already do
            // when the comparator-type picker changes.
            const targetChanged = nextTarget !== condition.target;
            patch({
              target: nextTarget,
              target_slice: slice,
              ...(targetChanged ? { reference_value: null } : {}),
            });
          }}
        />
        <OperatorPill
          target={condition.target}
          slice={condition.target_slice}
          operator={condition.operator}
          onChange={(op) => patch({ operator: op })}
        />
        <ComparatorPill
          condition={condition}
          nations={nations}
          cities={cities}
          onChange={patch}
          onBlurCommit={onLetterSetBlur}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[colors,opacity] hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────

export function ConditionsEditor({
  ruleId,
  conditions,
  matchMode,
  nations,
  cities,
  onDirtyChange,
  onSaveError,
}: {
  ruleId: string;
  conditions: SortingRuleCondition[];
  matchMode: RuleMatchMode;
  nations: Nation[];
  cities: City[];
  /** Reports the editor's dirty status to the parent panel so a unified
   *  "Unsaved / Saved" indicator can be rendered next to the kebab menu —
   *  this keeps the conditions area itself from reflowing as a save badge
   *  toggles on each keystroke. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Bubble up a failed autosave so the workspace can surface a toast. The
   *  editor itself doesn't render its own toaster — the rules-list provider
   *  owns the one shared portal. */
  onSaveError?: (message: string) => void;
}) {
  const [conds, setConds] = useState<EditableCondition[]>(() =>
    conditions.map(toEditable)
  );
  const [mode, setMode] = useState<RuleMatchMode>(matchMode);
  const [dirty, setDirty] = useState(false);

  // Resync from the server when the user has no pending edits.
  const serverKey = useMemo(
    () =>
      JSON.stringify([
        conditions.map((c) => [
          c.target,
          c.target_slice,
          c.operator,
          c.reference_type,
          c.reference_value,
        ]),
        matchMode,
      ]),
    [conditions, matchMode]
  );
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  if (!dirty && lastServerKey !== serverKey) {
    setConds(conditions.map(toEditable));
    setMode(matchMode);
    setLastServerKey(serverKey);
  }

  // ── autosave (debounced; held while any row has a numeric error) ──────────
  const condsRef = useRef(conds);
  const modeRef = useRef(mode);
  const dirtyRef = useRef(dirty);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    condsRef.current = conds;
    modeRef.current = mode;
    dirtyRef.current = dirty;
  });

  // Notify the parent panel whenever the dirty status flips so it can render
  // an "Unsaved / Saved" indicator next to the kebab menu.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const onSaveErrorRef = useRef(onSaveError);
  useEffect(() => {
    onSaveErrorRef.current = onSaveError;
  }, [onSaveError]);

  // Re-entrancy guard: prevents two saves from being in flight at the same
  // time. When a save is awaiting on the server and the user keeps editing,
  // `schedule()` re-arms the debounce — the next timer fire is held by this
  // flag until the current save resolves, then commits the latest state.
  const savingRef = useRef(false);

  const commit = useCallback(async () => {
    if (!dirtyRef.current) return;
    if (savingRef.current) return;
    const current = condsRef.current.map(normalizeCondition);
    if (current.some(hasNumericError)) return; // hold — never drop a row
    const payload = current.map((c, i) => ({ ...c, position: i + 1 }));

    // Optimistic clear: the panel flips to "Saved" while the server round-
    // trip is in flight. Restored on failure below — see the catch.
    savingRef.current = true;
    setDirty(false);
    dirtyRef.current = false;

    try {
      await saveConditions(ruleId, payload, modeRef.current);
    } catch (err) {
      // The user's edits are still in local `conds` — re-mark dirty so the
      // header keeps showing "Unsaved", and bubble a toast up to the
      // workspace. The next debounce or unmount-flush will retry.
      console.error("[sorting-rules] saveConditions failed:", err);
      setDirty(true);
      dirtyRef.current = true;
      onSaveErrorRef.current?.(
        "Couldn't save the rule's conditions. Edits are still here — try again."
      );
    } finally {
      savingRef.current = false;
    }
  }, [ruleId]);

  const schedule = useCallback(() => {
    setDirty(true);
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      commit();
    }, 600);
  }, [commit]);

  // Flush a pending edit if the panel unmounts mid-debounce.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        commit();
      }
    };
  }, [commit]);

  function mutate(next: EditableCondition[]) {
    setConds(next);
    schedule();
  }
  function updateAt(i: number, next: EditableCondition) {
    mutate(conds.map((c, idx) => (idx === i ? next : c)));
  }
  function removeAt(i: number) {
    mutate(conds.filter((_, idx) => idx !== i));
  }
  function add() {
    mutate([...conds, defaultCondition()]);
  }
  function changeMode(next: RuleMatchMode) {
    setMode(next);
    schedule();
  }

  /** Canonicalize a letter-set / digit-set value on blur (dedupe + sort). */
  function commitCharSetAt(i: number) {
    const c = conds[i];
    if (c.reference_type !== "letter_set" && c.reference_type !== "digit_set") {
      return;
    }
    const canon = normalizeCharSet(c.reference_value ?? "", c.reference_type);
    if (canon !== (c.reference_value ?? "")) {
      updateAt(i, { ...c, reference_value: canon });
    }
  }

  // ── contradictions ────────────────────────────────────────────────────────
  const contradictions: ConditionContradiction[] = useMemo(
    () => detectContradictions(conds.map(normalizeCondition), mode),
    [conds, mode]
  );
  const messageByIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of contradictions) {
      for (const i of c.indices) {
        if (!map.has(i)) map.set(i, c.message);
      }
    }
    return map;
  }, [contradictions]);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Conditions ({conds.length})
      </h3>

      {conds.map((c, i) => (
        <div key={i} className="flex flex-col gap-1">
          <ConditionRow
            condition={c}
            nations={nations}
            cities={cities}
            contradiction={messageByIndex.get(i) ?? null}
            onChange={(next) => updateAt(i, next)}
            onLetterSetBlur={() => commitCharSetAt(i)}
            onRemove={() => removeAt(i)}
          />
          {/* Match-mode pill between every pair of conditions. There's a
              single mode per rule, so all pills share the same value —
              flipping one re-syncs the rest via state. The native `title`
              tooltip on hover spells the semantics out in plain English. */}
          {i < conds.length - 1 ? (
            <span
              className="ml-6 inline-flex h-6 w-fit items-stretch rounded-md border border-border font-mono text-xs text-muted-foreground"
              title={RULE_MATCH_MODE_DESCRIPTIONS[mode]}
            >
              <SelectSegment
                value={mode}
                options={[
                  { value: "all", label: "and" },
                  { value: "any", label: "and/or" },
                  { value: "exclusive", label: "or" },
                ]}
                onChange={(v) => changeMode(v as RuleMatchMode)}
                ariaLabel="Match mode"
              />
            </span>
          ) : null}
        </div>
      ))}

      {/* Mirrors the endings framework page's InsertionZone button — a
          dashed h-5 w-10 plus tile, but always visible since there's a
          single zone (vs. one between every pair of blocks). */}
      <button
        type="button"
        onClick={add}
        aria-label="Add condition"
        className="ml-6 inline-flex h-5 w-10 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors duration-300 ease-out hover:border-solid hover:bg-white/10 hover:text-foreground"
      >
        <Plus size={12} aria-hidden />
      </button>
    </div>
  );
}
