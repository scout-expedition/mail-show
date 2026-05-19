"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Star, Trash2, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { InspectionLetterPill } from "@/components/pills";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  CITIZEN_HONORIFICS,
  CITIZEN_SUFFIXES,
  NAME_DISPLAY_FORMATS,
  NAME_DISPLAY_FORMAT_LABELS,
  type CitizenType,
} from "@/lib/db/enums";
import type {
  Citizen,
  City,
  InspectionLetterView,
  Nation,
  SortingLetterView,
  Storyline,
} from "@/lib/db/types";
import {
  citizenFullName,
  citizenIssues,
  composeCitizenAddress,
  type AddressLookupLevel,
} from "@/lib/citizen-name";
import {
  formatCitizenIdInput,
  generateRandomCitizenId,
} from "@/lib/citizen-id";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import { deleteCitizen, patchCitizen } from "./actions";

const SPAN: Record<number, string> = {
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
};

const LOOKUP_LEVELS: { level: AddressLookupLevel; label: string }[] = [
  { level: 0, label: "Full" },
  { level: 1, label: "1 Lookup" },
  { level: 2, label: "2 Lookups" },
  { level: 3, label: "3 Lookups" },
];

export function CitizenInspector({
  citizen,
  cities,
  nations,
  storylines,
  inspectionLetters,
  sortingLetters,
  allCitizenIds,
  otherNames,
  otherIds,
  onDeleted,
}: {
  citizen: Citizen;
  cities: City[];
  nations: Nation[];
  storylines: Storyline[];
  inspectionLetters: InspectionLetterView[];
  sortingLetters: SortingLetterView[];
  allCitizenIds: Set<string>;
  /** Normalized full names of every other citizen — for duplicate detection. */
  otherNames: Set<string>;
  /** Citizen IDs of every other citizen — for duplicate detection. */
  otherIds: Set<string>;
  onDeleted: (id: string) => void;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const { confirm, dialog } = useConfirm();

  // Preview-only controls for the formatted address — not persisted.
  const [lookupLevel, setLookupLevel] = useState<AddressLookupLevel>(0);
  const [hideName, setHideName] = useState(false);

  const focusKey = (field: string): PresenceFocus => ({
    table: "citizens",
    recordId: citizen.id,
    field,
  });
  const onFocusChangeFor = (field: string) => (focused: boolean) =>
    setFocus(focused ? focusKey(field) : null);

  // --- Identity fields. Each saves on its own debounce via patchCitizen. ---
  const firstNameField = useInstantField<string>({
    value: citizen.first_name,
    onCommit: (v) => patchCitizen(citizen.id, { first_name: v }),
    onFocusChange: onFocusChangeFor("first_name"),
    onActivity: pingActivity,
  });
  const lastNameField = useInstantField<string>({
    value: citizen.last_name,
    onCommit: (v) => patchCitizen(citizen.id, { last_name: v }),
    onFocusChange: onFocusChangeFor("last_name"),
    onActivity: pingActivity,
  });
  const middleNameField = useInstantField<string>({
    value: citizen.middle_name ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { middle_name: v || null }),
    onFocusChange: onFocusChangeFor("middle_name"),
    onActivity: pingActivity,
  });
  const honorificField = useInstantField<string>({
    value: citizen.honorific ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { honorific: v || null }),
    onFocusChange: onFocusChangeFor("honorific"),
    onActivity: pingActivity,
  });
  const titleField = useInstantField<string>({
    value: citizen.title ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { title: v || null }),
    onFocusChange: onFocusChangeFor("title"),
    onActivity: pingActivity,
  });
  const suffixField = useInstantField<string>({
    value: citizen.suffix ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { suffix: v || null }),
    onFocusChange: onFocusChangeFor("suffix"),
    onActivity: pingActivity,
  });
  const citizenIdField = useInstantField<string>({
    value: citizen.citizen_id ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { citizen_id: v || null }),
    onFocusChange: onFocusChangeFor("citizen_id"),
    onActivity: pingActivity,
  });
  const typeField = useInstantField<string>({
    value: citizen.type,
    onCommit: (v) => patchCitizen(citizen.id, { type: v as CitizenType }),
    onFocusChange: onFocusChangeFor("type"),
    onActivity: pingActivity,
  });
  const nameFormatField = useInstantField<string>({
    value: citizen.name_display_format ?? "",
    onCommit: (v) =>
      patchCitizen(citizen.id, { name_display_format: v || null }),
    onFocusChange: onFocusChangeFor("name_display_format"),
    onActivity: pingActivity,
  });
  const addressLineField = useInstantField<string>({
    value: citizen.address_line ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { address_line: v || null }),
    onFocusChange: onFocusChangeFor("address_line"),
    onActivity: pingActivity,
  });
  const cityIdField = useInstantField<string>({
    value: citizen.city_id ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { city_id: v || null }),
    onFocusChange: onFocusChangeFor("city_id"),
    onActivity: pingActivity,
  });
  const nationIdField = useInstantField<string>({
    value: citizen.nation_id ?? "",
    onCommit: (v) => patchCitizen(citizen.id, { nation_id: v || null }),
    onFocusChange: onFocusChangeFor("nation_id"),
    onActivity: pingActivity,
  });

  // Cities offered are scoped to the selected nation (uses the in-progress
  // field value so the list narrows the instant a nation is picked).
  const availableCities = nationIdField.value
    ? cities.filter((c) => c.nation_id === nationIdField.value)
    : cities;

  const fields = [
    firstNameField,
    lastNameField,
    middleNameField,
    honorificField,
    titleField,
    suffixField,
    citizenIdField,
    typeField,
    nameFormatField,
    addressLineField,
    cityIdField,
    nationIdField,
  ];
  const dirty = fields.some(
    (f) => f.status === "dirty" || f.status === "saving"
  );

  // Live citizen built from the in-progress field values, so the formatted
  // address preview + header title update as the user types — before the
  // realtime echo lands.
  const liveCitizen: Citizen = {
    ...citizen,
    first_name: firstNameField.value,
    last_name: lastNameField.value,
    middle_name: middleNameField.value || null,
    honorific: honorificField.value || null,
    title: titleField.value || null,
    suffix: suffixField.value || null,
    name_display_format: nameFormatField.value || null,
    address_line: addressLineField.value || null,
    citizen_id: citizenIdField.value || null,
    type: typeField.value as CitizenType,
    city_id: cityIdField.value || null,
    nation_id: nationIdField.value || null,
  };
  const liveCity =
    cities.find((c) => c.id === liveCitizen.city_id) ?? null;
  const liveNation =
    nations.find((n) => n.id === liveCitizen.nation_id) ?? null;
  const addressLines = composeCitizenAddress(
    liveCitizen,
    liveCity,
    liveNation,
    { lookupLevel, hideName }
  );

  const headerTitle = citizenFullName(liveCitizen) || "New citizen";

  // Validation, computed from the live (in-progress) field values so errors
  // clear as soon as they're fixed.
  const liveNameKey = citizenFullName(liveCitizen).trim().toLowerCase();
  const liveIdKey = (citizenIdField.value ?? "").trim();
  const issues = citizenIssues(liveCitizen, {
    duplicateName: !!liveNameKey && otherNames.has(liveNameKey),
    duplicateCitizenId: !!liveIdKey && otherIds.has(liveIdKey),
  });
  const errorFields = new Set(issues.flatMap((i) => i.fields));
  const errClass = (field: string) =>
    errorFields.has(field) ? "ring-1 ring-destructive" : "";

  const inspectionPills = inspectionLetters.filter(
    (l) =>
      l.sender_citizen_id === citizen.id ||
      l.receiver_citizen_id === citizen.id
  );
  const sortingPills = sortingLetters.filter(
    (l) =>
      l.sender_citizen_id === citizen.id ||
      l.recipient_citizen_id === citizen.id
  );

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete citizen?",
      message: `"${headerTitle}" will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", citizen.id);
    await deleteCitizen(fd);
    onDeleted(citizen.id);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={headerTitle}
        icon={
          <User size={14} aria-hidden className="text-muted-foreground/70" />
        }
        dirty={dirty}
        showSaved={!dirty}
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete citizen",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: handleDelete,
              },
            ]}
          />
        }
      />

      <div className="p-4">
        {issues.length > 0 ? (
          <ul className="mb-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {issues.map((issue) => (
              <li
                key={issue.message}
                className="flex items-center gap-1.5 text-xs text-destructive"
              >
                <AlertCircle size={12} aria-hidden className="shrink-0" />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Identity */}
        <div className="grid grid-cols-6 gap-3">
          <FieldCell label="Honorific" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("honorific")}>
              <Select
                value={honorificField.value}
                onChange={(e) => honorificField.set(e.target.value)}
                onFocus={honorificField.onFocus}
                onBlur={honorificField.onBlur}
                className={cn("h-8", GHOST_FIELD)}
              >
                <option value="">—</option>
                {CITIZEN_HONORIFICS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Title" span={4}>
            <FieldHighlight peers={peers} focusKey={focusKey("title")}>
              <Input
                value={titleField.value}
                onChange={(e) => titleField.set(e.target.value)}
                onFocus={titleField.onFocus}
                onBlur={titleField.onBlur}
                placeholder="e.g. Chief Inspector"
                className={cn("h-8", GHOST_FIELD)}
              />
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="First name" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("first_name")}>
              <Input
                value={firstNameField.value}
                onChange={(e) => firstNameField.set(e.target.value)}
                onFocus={firstNameField.onFocus}
                onBlur={firstNameField.onBlur}
                className={cn("h-8", GHOST_FIELD, errClass("first_name"))}
              />
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Middle name" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("middle_name")}>
              <Input
                value={middleNameField.value}
                onChange={(e) => middleNameField.set(e.target.value)}
                onFocus={middleNameField.onFocus}
                onBlur={middleNameField.onBlur}
                className={cn("h-8", GHOST_FIELD)}
              />
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Last name" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("last_name")}>
              <Input
                value={lastNameField.value}
                onChange={(e) => lastNameField.set(e.target.value)}
                onFocus={lastNameField.onFocus}
                onBlur={lastNameField.onBlur}
                className={cn("h-8", GHOST_FIELD, errClass("last_name"))}
              />
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="Suffix" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("suffix")}>
              <Select
                value={suffixField.value}
                onChange={(e) => suffixField.set(e.target.value)}
                onFocus={suffixField.onFocus}
                onBlur={suffixField.onBlur}
                className={cn("h-8", GHOST_FIELD)}
              >
                <option value="">—</option>
                {CITIZEN_SUFFIXES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Citizen ID" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("citizen_id")}>
              <CitizenIdInput
                value={citizenIdField.value}
                onChange={(v) => citizenIdField.set(v)}
                onFocus={citizenIdField.onFocus}
                onBlur={citizenIdField.onBlur}
                allCitizenIds={allCitizenIds}
                error={errorFields.has("citizen_id")}
              />
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Hero" span={2}>
            <FieldHighlight
              peers={peers}
              focusKey={focusKey("type")}
              className="w-fit"
            >
              {/* Toggle styled to match the GHOST_FIELD dropdowns/inputs
                  alongside it — same h-8, same hover/focus treatment.
                  Filled star = hero, outline = npc. */}
              <button
                type="button"
                onClick={() =>
                  typeField.set(
                    typeField.value === "hero" ? "npc" : "hero"
                  )
                }
                onFocus={typeField.onFocus}
                onBlur={typeField.onBlur}
                aria-pressed={typeField.value === "hero"}
                aria-label="Hero"
                title={typeField.value === "hero" ? "Hero" : "NPC"}
                className={cn(
                  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  GHOST_FIELD
                )}
              >
                <Star
                  size={14}
                  aria-hidden
                  className={cn(
                    typeField.value === "hero"
                      ? "fill-current text-foreground"
                      : "text-muted-foreground/40"
                  )}
                />
              </button>
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="Name display format" span={6}>
            <FieldHighlight
              peers={peers}
              focusKey={focusKey("name_display_format")}
            >
              <Select
                value={nameFormatField.value}
                onChange={(e) => nameFormatField.set(e.target.value)}
                onFocus={nameFormatField.onFocus}
                onBlur={nameFormatField.onBlur}
                className={cn("h-8", GHOST_FIELD)}
              >
                <option value="">First &amp; Last</option>
                {NAME_DISPLAY_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {NAME_DISPLAY_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="Address line / organization" span={6}>
            <FieldHighlight peers={peers} focusKey={focusKey("address_line")}>
              <Input
                value={addressLineField.value}
                onChange={(e) => addressLineField.set(e.target.value)}
                onFocus={addressLineField.onFocus}
                onBlur={addressLineField.onBlur}
                className={cn("h-8", GHOST_FIELD)}
              />
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="City" span={3}>
            <FieldHighlight peers={peers} focusKey={focusKey("city_id")}>
              <Select
                value={cityIdField.value}
                onChange={(e) => {
                  const newCityId = e.target.value;
                  cityIdField.set(newCityId);
                  // Auto-fill nation from the city's FK.
                  if (newCityId) {
                    const city = cities.find((c) => c.id === newCityId);
                    if (city) nationIdField.set(city.nation_id);
                  }
                }}
                onFocus={cityIdField.onFocus}
                onBlur={cityIdField.onBlur}
                className={cn("h-8", GHOST_FIELD, errClass("city_id"))}
              >
                <option value="">—</option>
                {availableCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FieldHighlight>
          </FieldCell>
          <FieldCell label="Nation" span={3}>
            <FieldHighlight peers={peers} focusKey={focusKey("nation_id")}>
              <Select
                value={nationIdField.value}
                onChange={(e) => {
                  const newNationId = e.target.value;
                  nationIdField.set(newNationId);
                  // Clear the city if it no longer belongs to this nation.
                  const currentCity = cities.find(
                    (c) => c.id === cityIdField.value
                  );
                  if (currentCity && currentCity.nation_id !== newNationId) {
                    cityIdField.set("");
                  }
                }}
                onFocus={nationIdField.onFocus}
                onBlur={nationIdField.onBlur}
                className={cn("h-8", GHOST_FIELD, errClass("nation_id"))}
              >
                <option value="">—</option>
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </FieldHighlight>
          </FieldCell>
        </div>

        {/* Formatted address */}
        <div className="h-2" aria-hidden />
        <SectionHeader>Formatted Address Preview</SectionHeader>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card p-0.5">
            {LOOKUP_LEVELS.map(({ level, label }) => (
              <button
                key={level}
                type="button"
                onClick={() => setLookupLevel(level)}
                className={cn(
                  "inline-flex h-6 items-center rounded px-1.5 font-mono !text-[9px] transition-colors",
                  lookupLevel === level
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex h-7 items-center rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setHideName((h) => !h)}
              aria-pressed={!hideName}
              title={hideName ? "Show name" : "Hide name"}
              className={cn(
                "inline-flex h-6 items-center rounded px-1.5 font-mono !text-[9px] transition-colors",
                !hideName
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/40"
              )}
            >
              Name
            </button>
          </div>
        </div>
        <div className="min-h-[6.5rem] rounded-md border border-border bg-black/20 p-3 font-mono text-xs leading-relaxed">
          {addressLines.length > 0 ? (
            addressLines.map((line, i) => <div key={i}>{line}</div>)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        <div className="h-2" aria-hidden />

        {/* Inspection letters */}
        <SectionHeader>Inspection letters</SectionHeader>
        {inspectionPills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {inspectionPills.map((l) => (
              <Link key={l.id} href={inspectionLetterHref(l)}>
                <InspectionLetterPill
                  storyline={storylines.find(
                    (s) => s.id === l.storyline_id
                  )}
                  contentId={l.content_id}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                />
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">None</p>
        )}

        {/* Sorting letters */}
        <SectionHeader>Sorting letters</SectionHeader>
        {sortingPills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sortingPills.map((l) => (
              <span
                key={l.id}
                className="inline-flex h-6 items-center rounded-md border border-border px-1.5 font-mono text-[11px] text-muted-foreground"
              >
                {l.content_id}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">None</p>
        )}
      </div>
      {dialog}
    </div>
  );
}

/** Deep-link to an inspection letter. A letter with a variant resolves via
 *  `?letter=<abbr><seq>-<variant>`; a variant-less letter (the slug parser
 *  requires a non-empty variant) falls back to opening its group. */
function inspectionLetterHref(l: InspectionLetterView): string {
  const slug = `${l.storyline_abbreviation}${l.group_sequence}`;
  return l.variant
    ? `/inspection/letters?letter=${slug}-${l.variant}`
    : `/inspection/letters?group=${slug}`;
}

function FieldCell({
  label,
  span,
  children,
}: {
  label: string;
  span: 2 | 3 | 4 | 6;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", SPAN[span])}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

function CitizenIdInput({
  value,
  onChange,
  onFocus,
  onBlur,
  allCitizenIds,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  allCitizenIds: Set<string>;
  error?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className="relative flex items-center"
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
          onBlur?.();
        }
      }}
    >
      <Input
        value={value}
        onChange={(e) => onChange(formatCitizenIdInput(e.target.value))}
        placeholder="#0042"
        maxLength={5}
        className={cn(
          "h-8 pr-7",
          GHOST_FIELD,
          error && "ring-1 ring-destructive"
        )}
      />
      {focused ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const taken = new Set(allCitizenIds);
            taken.delete(value);
            onChange(generateRandomCitizenId(taken));
          }}
          aria-label="Generate random citizen ID"
          title="Generate random ID"
          className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8" cy="8" r="1.1" fill="currentColor" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" />
            <circle cx="16" cy="16" r="1.1" fill="currentColor" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
