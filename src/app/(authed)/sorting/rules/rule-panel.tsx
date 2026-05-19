"use client";

import { useCallback, useState, useTransition } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  OverflowMenu,
  PanelHeader,
  type OverflowMenuItem,
} from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import { DaySelect } from "@/components/day-select";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import type { City, Day, Nation, SortingRule, SortingRuleCondition } from "@/lib/db/types";
import { deleteRule, duplicateRule, patchSortingRule } from "./actions";
import { RulePill } from "./rule-pill";
import { ConditionsEditor } from "./conditions-editor";

const SLOT_REPORTING = "reporting";

export function RulePanel({
  rule,
  conditions,
  days,
  nations,
  cities,
  allRules,
  onClose,
  onSelectRule,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
  days: Day[];
  nations: Nation[];
  cities: City[];
  allRules: SortingRule[];
  onClose: () => void;
  onSelectRule: (id: string) => void;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [duplicating, startDuplicate] = useTransition();
  const [, startDelete] = useTransition();

  // Attempted-but-rejected Rule ID (taken letter) — shown struck-through.
  const [rejectedLetter, setRejectedLetter] = useState<string | null>(null);

  // Aggregate dirty state across scalar fields + the conditions editor so a
  // single "Unsaved / Saved" indicator renders in the panel header instead of
  // nudging the conditions area on every keystroke.
  const [conditionsDirty, setConditionsDirty] = useState(false);
  const handleConditionsDirty = useCallback((d: boolean) => {
    setConditionsDirty(d);
  }, []);
  // Clear the indicator when the rule's letter actually changes (realtime
  // peer edit, or our own successful commit echoing back).
  const [seenLetter, setSeenLetter] = useState(rule.letter);
  if (seenLetter !== rule.letter) {
    setSeenLetter(rule.letter);
    setRejectedLetter(null);
  }

  function makeFocusKey(field: string): PresenceFocus {
    return { table: "sorting_rules", recordId: rule.id, field };
  }

  // ── Instant-save scalar fields ──────────────────────────────────────────

  const letterField = useInstantField<string>({
    value: rule.letter,
    onCommit: async (v) => {
      const next = v.trim().toUpperCase();
      if (next === "" || next === rule.letter) {
        // Empty is invalid (letter is NOT NULL); revert silently.
        if (next === "") throw new Error("Rule ID can't be empty.");
        return;
      }
      if (allRules.some((r) => r.id !== rule.id && r.letter === next)) {
        setRejectedLetter(next);
        throw new Error("That Rule ID is already in use.");
      }
      await patchSortingRule(rule.id, { letter: next });
    },
    onFocusChange: (f) => setFocus(f ? makeFocusKey("letter") : null),
    onActivity: pingActivity,
  });

  const slotValue = rule.routes_to_reporting
    ? SLOT_REPORTING
    : rule.destination_slot != null
      ? String(rule.destination_slot)
      : "";
  const slotField = useInstantField<string>({
    value: slotValue,
    onCommit: (v) => {
      if (v === SLOT_REPORTING) {
        return patchSortingRule(rule.id, {
          destination_slot: null,
          routes_to_reporting: true,
        });
      }
      const n = v.trim() === "" ? null : Number(v);
      return patchSortingRule(rule.id, {
        destination_slot: Number.isFinite(n) ? (n as number) : null,
        routes_to_reporting: false,
      });
    },
    onFocusChange: (f) => setFocus(f ? makeFocusKey("destination_slot") : null),
    onActivity: pingActivity,
  });

  const dayImplField = useInstantField<string>({
    value: rule.day_implemented_id ?? "",
    onCommit: (v) =>
      patchSortingRule(rule.id, { day_implemented_id: v.trim() || null }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("day_implemented_id") : null),
    onActivity: pingActivity,
  });

  const dayCancelledField = useInstantField<string>({
    value: rule.day_cancelled_id ?? "",
    onCommit: (v) =>
      patchSortingRule(rule.id, { day_cancelled_id: v.trim() || null }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("day_cancelled_id") : null),
    onActivity: pingActivity,
  });

  const storageField = useInstantField<string>({
    value: rule.storage_location ?? "",
    onCommit: (v) =>
      patchSortingRule(rule.id, { storage_location: v.trim() || null }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("storage_location") : null),
    onActivity: pingActivity,
  });

  const summaryField = useInstantField<string>({
    value: rule.summary ?? "",
    onCommit: (v) => patchSortingRule(rule.id, { summary: v.trim() || null }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("summary") : null),
    onActivity: pingActivity,
  });

  // ── Aggregate dirty status ───────────────────────────────────────────────
  // True while any scalar field is mid-save (or has an in-flight commit) OR
  // the conditions editor has pending edits queued. Falsy when everything has
  // settled — PanelHeader then flips its badge from "Unsaved" to "Saved".
  const scalarFields = [
    letterField,
    slotField,
    dayImplField,
    dayCancelledField,
    storageField,
    summaryField,
  ];
  const anyFieldBusy = scalarFields.some(
    (f) => f.status === "dirty" || f.status === "saving"
  );
  const panelDirty = conditionsDirty || anyFieldBusy;
  // Once we've ever shown the "Unsaved" badge, render "Saved" for a moment
  // when it clears — feels less abrupt than silently disappearing.
  const [hasBeenDirty, setHasBeenDirty] = useState(false);
  if (panelDirty && !hasBeenDirty) setHasBeenDirty(true);

  // ── Kebab actions ───────────────────────────────────────────────────────

  function handleDuplicate() {
    const fd = new FormData();
    fd.append("id", rule.id);
    startDuplicate(async () => {
      const res = await duplicateRule(fd);
      if (res) onSelectRule(res.id);
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete rule?",
      message: `RR-${rule.letter} will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", rule.id);
    startDelete(async () => {
      await deleteRule(fd);
      onClose();
    });
  }

  const kebabItems: OverflowMenuItem[] = [
    {
      label: "Duplicate rule",
      icon: <Copy size={12} aria-hidden />,
      onClick: handleDuplicate,
      disabled: duplicating || allRules.length >= 26,
    },
    { divider: true },
    {
      label: "Delete rule",
      intent: "destructive",
      icon: <Trash2 size={12} aria-hidden />,
      onClick: handleDelete,
    },
  ];

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={`RR-${rule.letter}`}
        icon={<RulePill letter={rule.letter} className="h-5 w-5" />}
        dirty={panelDirty}
        showSaved={hasBeenDirty && !panelDirty}
        menu={<OverflowMenu items={kebabItems} />}
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-3 flex flex-col gap-1">
            <Label>Rule ID</Label>
            <div className="flex items-center gap-2">
              <FieldHighlight peers={peers} focusKey={makeFocusKey("letter")}>
                <Input
                  value={letterField.value}
                  onChange={(e) => {
                    setRejectedLetter(null);
                    letterField.set(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, "")
                        .slice(0, 1)
                    );
                  }}
                  onFocus={letterField.onFocus}
                  onBlur={letterField.onBlur}
                  maxLength={1}
                  className="h-8 w-12 text-center uppercase"
                />
              </FieldHighlight>
              {rejectedLetter ? (
                <span
                  className="text-xs text-destructive"
                  title="That Rule ID is already in use"
                >
                  <s>{rejectedLetter}</s>
                </span>
              ) : null}
            </div>
          </div>

          <div className="col-span-3 flex flex-col gap-1">
            <Label>Delivery slot</Label>
            <FieldHighlight
              peers={peers}
              focusKey={makeFocusKey("destination_slot")}
            >
              <Select
                value={slotField.value}
                onChange={(e) => slotField.set(e.target.value)}
                onFocus={slotField.onFocus}
                onBlur={slotField.onBlur}
                className="h-8"
              >
                <option value="">–</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
                <option value={SLOT_REPORTING}>Reporting</option>
              </Select>
            </FieldHighlight>
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Day implemented</Label>
            <FieldHighlight
              peers={peers}
              focusKey={makeFocusKey("day_implemented_id")}
            >
              <div onFocus={dayImplField.onFocus} onBlur={dayImplField.onBlur}>
                <DaySelect
                  value={dayImplField.value}
                  days={days}
                  onChange={(v) => dayImplField.set(v)}
                  className="h-8"
                />
              </div>
            </FieldHighlight>
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Day cancelled</Label>
            <FieldHighlight
              peers={peers}
              focusKey={makeFocusKey("day_cancelled_id")}
            >
              <div
                onFocus={dayCancelledField.onFocus}
                onBlur={dayCancelledField.onBlur}
              >
                <DaySelect
                  value={dayCancelledField.value}
                  days={days}
                  onChange={(v) => dayCancelledField.set(v)}
                  className="h-8"
                />
              </div>
            </FieldHighlight>
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Storage location</Label>
            <FieldHighlight
              peers={peers}
              focusKey={makeFocusKey("storage_location")}
            >
              <Input
                value={storageField.value}
                onChange={(e) => storageField.set(e.target.value)}
                onFocus={storageField.onFocus}
                onBlur={storageField.onBlur}
                placeholder="e.g. Yellow Bin"
                className="h-8"
              />
            </FieldHighlight>
          </div>

          <div className="col-span-12 flex flex-col gap-1">
            <Label>Summary</Label>
            <FieldHighlight peers={peers} focusKey={makeFocusKey("summary")}>
              <Textarea
                value={summaryField.value}
                onChange={(e) => summaryField.set(e.target.value)}
                onFocus={summaryField.onFocus}
                onBlur={summaryField.onBlur}
                rows={2}
              />
            </FieldHighlight>
          </div>
        </div>

        <ConditionsEditor
          ruleId={rule.id}
          conditions={conditions}
          matchMode={rule.match_mode}
          nations={nations}
          cities={cities}
          onDirtyChange={handleConditionsDirty}
        />
      </div>
      {confirmDialog}
    </div>
  );
}
