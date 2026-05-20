"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Copy, Hash, Palette, Trash2, X } from "lucide-react";
import {
  IconCircleMinus,
  IconDiamond,
  IconHammer,
  IconWorldBolt,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  OverflowMenu,
  PanelHeader,
  type OverflowMenuItem,
} from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import { DaySelect } from "@/components/day-select";
import { normalizeHex } from "@/lib/color";
import { cn } from "@/lib/utils";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import type {
  City,
  Day,
  EndingVariable,
  Nation,
  SortingRule,
  SortingRuleCondition,
  Storyline,
} from "@/lib/db/types";
import { IMPACT_CHIP_COLORS } from "@/lib/endings/impact-colors";
import { IconDisplay } from "@/components/icon-display";
import { deleteRule, duplicateRule, patchSortingRule } from "./actions";
import { RulePill } from "./rule-pill";
import { SlotPillSelect } from "./slot-pill";
import { ConditionsEditor } from "./conditions-editor";

const SLOT_REPORTING = "reporting";

export function RulePanel({
  rule,
  conditions,
  days,
  nations,
  cities,
  storylines,
  endingVariables,
  allRules,
  onClose,
  onSelectRule,
  onEditId,
  onConditionsError,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
  days: Day[];
  nations: Nation[];
  cities: City[];
  storylines: Storyline[];
  endingVariables: EndingVariable[];
  allRules: SortingRule[];
  onClose: () => void;
  onSelectRule: (id: string) => void;
  onEditId: () => void;
  /** Surfaced when the conditions editor fails to autosave — the workspace
   *  owns the shared toaster, so we just hand the message up. */
  onConditionsError?: (message: string) => void;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [duplicating, startDuplicate] = useTransition();
  const [, startDelete] = useTransition();

  // Aggregate dirty state across scalar fields + the conditions editor so a
  // single "Unsaved / Saved" indicator renders in the panel header instead of
  // nudging the conditions area on every keystroke.
  const [conditionsDirty, setConditionsDirty] = useState(false);
  const handleConditionsDirty = useCallback((d: boolean) => {
    setConditionsDirty(d);
  }, []);

  function makeFocusKey(field: string): PresenceFocus {
    return { table: "sorting_rules", recordId: rule.id, field };
  }

  // ── Instant-save scalar fields ──────────────────────────────────────────

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

  const notesField = useInstantField<string>({
    value: rule.notes ?? "",
    onCommit: (v) => patchSortingRule(rule.id, { notes: v.trim() || null }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("notes") : null),
    onActivity: pingActivity,
  });

  const colorField = useInstantField<string | null>({
    value: rule.color_hex,
    onCommit: (v) =>
      patchSortingRule(rule.id, {
        color_hex: v ? normalizeHex(v) : null,
      }),
    onFocusChange: (f) => setFocus(f ? makeFocusKey("color_hex") : null),
    onActivity: pingActivity,
  });
  // Native <input type="color"> renders an empty string as black silently, so
  // feed it a neutral fallback when nothing is stored. The committed value
  // stays `null` until the user actually picks.
  const effectiveColor = colorField.value ?? "#888888";

  // ── Aggregate dirty status ───────────────────────────────────────────────
  // True while any scalar field is mid-save (or has an in-flight commit) OR
  // the conditions editor has pending edits queued. Falsy when everything has
  // settled — PanelHeader then flips its badge from "Unsaved" to "Saved".
  const scalarFields = [
    slotField,
    dayImplField,
    dayCancelledField,
    storageField,
    summaryField,
    notesField,
    colorField,
  ];
  // Include `error` so the panel header stays "Unsaved" after a rejected
  // commit instead of flashing "Saved" — `useInstantField` reverts the input
  // on error but the only signal beyond that revert is right here.
  const anyFieldBusy = scalarFields.some(
    (f) =>
      f.status === "dirty" ||
      f.status === "saving" ||
      f.status === "error"
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
      label: "Edit ID",
      icon: <Hash size={12} aria-hidden />,
      onClick: onEditId,
      disabled: allRules.length < 2,
    },
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
        title={
          <span className="flex min-w-0 flex-1 items-center">
            <FieldHighlight peers={peers} focusKey={makeFocusKey("summary")}>
              <input
                type="text"
                value={summaryField.value}
                onChange={(e) => summaryField.set(e.target.value)}
                onFocus={summaryField.onFocus}
                onBlur={summaryField.onBlur}
                placeholder="Summary…"
                aria-label="Rule summary"
                className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold normal-case tracking-normal text-foreground placeholder:text-muted-foreground/40 focus:border-border focus:shadow-sm focus:outline-none"
              />
            </FieldHighlight>
          </span>
        }
        icon={
          <RulePill
            letter={rule.letter}
            color={rule.color_hex}
            className="h-5 w-5"
          />
        }
        dirty={panelDirty}
        showSaved={hasBeenDirty && !panelDirty}
        menu={<OverflowMenu items={kebabItems} />}
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-6 flex flex-col gap-1">
            <Label>Color</Label>
            <div className="group flex h-8 w-fit items-center gap-1.5">
              <FieldHighlight
                peers={peers}
                focusKey={makeFocusKey("color_hex")}
                className="inline-flex"
              >
                <label
                  aria-label="Rule color"
                  className="relative block h-7 w-7 cursor-pointer rounded-sm border border-border/60"
                  style={{
                    backgroundColor: colorField.value ?? "transparent",
                  }}
                >
                  <input
                    type="color"
                    value={effectiveColor}
                    onChange={(e) => colorField.set(e.target.value)}
                    onFocus={colorField.onFocus}
                    onBlur={colorField.onBlur}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              </FieldHighlight>
              <PalettePopover
                nations={nations}
                storylines={storylines}
                endingVariables={endingVariables}
                onPick={(hex) => colorField.set(hex)}
              />
              {colorField.value ? (
                <button
                  type="button"
                  aria-label="Reset color"
                  title="Reset color"
                  onClick={() => colorField.set(null)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-[colors,opacity] hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X size={12} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Delivery slot</Label>
            <div className="flex h-8 items-center">
              <FieldHighlight
                peers={peers}
                focusKey={makeFocusKey("destination_slot")}
                className="inline-flex"
              >
                <SlotPillSelect
                  slot={rule.destination_slot}
                  reporting={rule.routes_to_reporting}
                  size="md"
                  onFocus={slotField.onFocus}
                  onBlur={slotField.onBlur}
                  onChange={({ slot, reporting }) =>
                    slotField.set(
                      reporting
                        ? SLOT_REPORTING
                        : slot != null
                          ? String(slot)
                          : ""
                    )
                  }
                />
              </FieldHighlight>
            </div>
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
                placeholder="e.g. Bin 3"
                className="h-8"
              />
            </FieldHighlight>
          </div>

          <div className="col-span-12 flex flex-col gap-1">
            <Label>Notes</Label>
            <FieldHighlight peers={peers} focusKey={makeFocusKey("notes")}>
              <Textarea
                value={notesField.value}
                onChange={(e) => notesField.set(e.target.value)}
                onFocus={notesField.onFocus}
                onBlur={notesField.onBlur}
                rows={3}
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
          onSaveError={onConditionsError}
        />

        <LastUpdatedFooter at={rule.updated_at} by={rule.updated_by} />
      </div>
      {confirmDialog}
    </div>
  );
}

/**
 * Footer line at the bottom of the rule panel: "Last updated <N ago> by
 * <name>". Mirrors the pattern in `inspection/letters/workspace.tsx` — emails
 * are resolved to display names via presence when the updater is currently
 * online, falling back to the raw email otherwise.
 */
function LastUpdatedFooter({
  at,
  by,
}: {
  at: string | null | undefined;
  by: string | null | undefined;
}) {
  const { peers, selfPeer } = usePresenceContext();
  const date = at ? new Date(at) : null;
  const valid = date != null && !Number.isNaN(date.getTime());

  const everyone = selfPeer ? [selfPeer, ...peers] : peers;
  const name = by
    ? everyone.find((p) => p.email === by)?.profile?.displayName?.trim() || by
    : null;

  return (
    <div className="mt-1 h-[16px]">
      {valid ? (
        <p
          title={date!.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          className="truncate text-center text-[10px] leading-[16px] text-muted-foreground/70"
        >
          Last updated {formatDistanceToNow(date!, { addSuffix: true })}
          {name ? <> by {name}</> : null}
        </p>
      ) : null}
    </div>
  );
}

/** WCAG-lite luminance check shared with the rule pill. */
function readableOn(hex: string): string {
  const full = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/** A palette swatch — square colored chip with an optional knockout icon.
 *  Pass `icon` to render a React node (e.g. a tabler icon) inline, OR
 *  `iconType`+`iconValue` to use the shared `IconDisplay` registry. */
function PaletteSwatch({
  color,
  icon,
  iconType,
  iconValue,
  title,
  onClick,
}: {
  color: string;
  icon?: React.ReactNode;
  iconType?: import("@/lib/db/enums").IconType | null;
  iconValue?: string | null;
  title: string;
  onClick: () => void;
}) {
  const fg = readableOn(color);
  return (
    <button
      type="button"
      title={title}
      aria-label={`Set color to ${title}`}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border/60 transition-transform hover:scale-110"
      style={{ backgroundColor: color, color: fg }}
    >
      {icon ? (
        icon
      ) : iconType && iconValue ? (
        <IconDisplay type={iconType} value={iconValue} size={12} />
      ) : null}
    </button>
  );
}

/** Curated swatches for the impact-chip variables — colors + icons pulled
 *  from the action editor so renames or palette tweaks stay in sync. The
 *  icons render in the contrast color computed from each swatch's hex. */
const PALETTE_VARIABLE_SWATCHES: Array<{
  label: string;
  hex: string;
  icon: React.ReactNode;
}> = [
  {
    label: "World Status",
    hex: IMPACT_CHIP_COLORS.world_status,
    icon: <IconWorldBolt size={12} aria-hidden />,
  },
  {
    label: "Demerits",
    hex: IMPACT_CHIP_COLORS.demerits,
    icon: <IconCircleMinus size={12} aria-hidden />,
  },
  {
    label: "Working Class",
    hex: IMPACT_CHIP_COLORS.proletariat,
    icon: <IconHammer size={12} aria-hidden />,
  },
  {
    label: "Upper Class",
    hex: IMPACT_CHIP_COLORS.gentry,
    icon: <IconDiamond size={12} aria-hidden />,
  },
];

/**
 * Palette button → popover with rows of color swatches sourced from nations,
 * storylines, and curated ending variables. Each swatch carries the source's
 * icon (knockout style — icon color chosen for contrast against the fill).
 * Click any swatch to assign its hex to the rule's color.
 */
function PalettePopover({
  nations,
  storylines,
  endingVariables,
  onPick,
}: {
  nations: Nation[];
  storylines: Storyline[];
  endingVariables: EndingVariable[];
  onPick: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  void endingVariables; // reserved for a future "all variables" surface

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Pick from palette"
        aria-expanded={open}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground"
        )}
      >
        <Palette size={14} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-max max-w-[320px] rounded-md border border-border bg-popover p-2 shadow-md"
        >
          {nations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Nations
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {nations.map((n) => (
                  <PaletteSwatch
                    key={n.id}
                    color={n.color_hex}
                    iconType={n.icon_type}
                    iconValue={n.icon_value}
                    title={`${n.name} (${n.color_hex})`}
                    onClick={() => {
                      onPick(n.color_hex);
                      setOpen(false);
                    }}
                  />
                ))}
              </span>
            </div>
          ) : null}
          {storylines.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Storylines
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {storylines.map((s) => (
                  <PaletteSwatch
                    key={s.id}
                    color={s.color_hex}
                    iconType={s.icon_type}
                    iconValue={s.icon_value}
                    title={`${s.name} (${s.color_hex})`}
                    onClick={() => {
                      onPick(s.color_hex);
                      setOpen(false);
                    }}
                  />
                ))}
              </span>
            </div>
          ) : null}
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Variables
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {PALETTE_VARIABLE_SWATCHES.map((sw) => (
                <PaletteSwatch
                  key={sw.label}
                  color={sw.hex}
                  icon={sw.icon}
                  title={`${sw.label} (${sw.hex})`}
                  onClick={() => {
                    onPick(sw.hex);
                    setOpen(false);
                  }}
                />
              ))}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
