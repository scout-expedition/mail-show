"use client";

import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { citizenDisplayName } from "@/lib/citizen-name";
import { displayCitizenId } from "@/lib/citizen-id";
import { ADDRESS_TYPES, ADDRESS_TYPE_LABELS, type AddressType } from "@/lib/db/enums";
import type {
  Citizen,
  City,
  Day,
  Nation,
  SortingLetterView,
} from "@/lib/db/types";
import type { Destination } from "@/lib/rules/destination";
import { DestinationCell } from "./destination-cell";
import { StampToggle } from "./stamp-toggle";
import { patchSortingLetter } from "./actions";

/** The address half of a letter — the two sides are identical bar the prefix. */
type Side = "sender" | "recipient";

function focusKeyFor(letterId: string, field: string) {
  return { table: "sorting_letters", recordId: letterId, field };
}

/**
 * One instant-save field on a sorting letter: patches the single column,
 * publishes presence focus under the column's own name, and leaves the
 * realtime echo to the shared reducer.
 */
function useLetterField<T>(
  letterId: string,
  column: string,
  value: T,
  toPatch: (v: T) => Record<string, unknown>
) {
  const { setFocus, pingActivity } = usePresenceContext();
  return useInstantField<T>({
    value,
    onCommit: (v) => patchSortingLetter(letterId, toPatch(v)),
    onFocusChange: (focused) =>
      setFocus(focused ? focusKeyFor(letterId, column) : null),
    onActivity: pingActivity,
  });
}

export function LetterPanel({
  letter,
  days,
  citizens,
  cities,
  nations,
  destination,
  onDelete,
}: {
  letter: SortingLetterView;
  days: Day[];
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  destination: Destination;
  onDelete: () => void;
}) {
  const { peers, setFocus } = usePresenceContext();
  const focusKey = (field: string) => focusKeyFor(letter.id, field);

  const dayField = useLetterField(letter.id, "day_id", letter.day_id, (v) => ({
    day_id: v,
  }));
  const sortIdField = useLetterField(
    letter.id,
    "sort_id",
    String(letter.sort_id),
    (v) => ({ sort_id: Number(v) || 0 })
  );
  const storageField = useLetterField(
    letter.id,
    "storage_location",
    letter.storage_location ?? "",
    (v) => ({ storage_location: v.trim() || null })
  );
  const notesField = useLetterField(letter.id, "notes", letter.notes ?? "", (v) => ({
    notes: v.trim() || null,
  }));

  const sortedCitizens = useMemo(
    () =>
      [...citizens].sort((a, b) =>
        citizenDisplayName(a).localeCompare(citizenDisplayName(b))
      ),
    [citizens]
  );

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {letter.content_id}
            </Badge>
            <span>Sorting Letter</span>
          </span>
        }
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete letter",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: onDelete,
              },
            ]}
          />
        }
      />

      <div className="grid grid-cols-6 gap-3 p-3">
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Day</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("day_id")}>
            <Select
              value={dayField.value}
              onChange={(e) => dayField.set(e.target.value)}
              onFocus={dayField.onFocus}
              onBlur={dayField.onBlur}
              className={`h-8 ${GHOST_FIELD}`}
            >
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.identifier}
                  {d.name ? ` — ${d.name}` : ""}
                </option>
              ))}
            </Select>
          </FieldHighlight>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Sort ID</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("sort_id")}>
            <Input
              type="number"
              min={0}
              max={99}
              value={sortIdField.value}
              onChange={(e) => sortIdField.set(e.target.value)}
              onFocus={sortIdField.onFocus}
              onBlur={sortIdField.onBlur}
              className={`h-8 font-mono ${GHOST_FIELD}`}
            />
          </FieldHighlight>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Stamp</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("stamp_valid")}>
            <StampToggle
              letterId={letter.id}
              value={letter.stamp_valid}
              onFocus={() => setFocus(focusKey("stamp_valid"))}
              onBlur={() => setFocus(null)}
            />
          </FieldHighlight>
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <Label>Storage location</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("storage_location")}>
            <Input
              value={storageField.value}
              onChange={(e) => storageField.set(e.target.value)}
              onFocus={storageField.onFocus}
              onBlur={storageField.onBlur}
              placeholder="Bin 4 / Blue Bin"
              className={`h-8 font-mono ${GHOST_FIELD}`}
            />
          </FieldHighlight>
        </div>

        <div className="col-span-6 flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
          <Label className="!text-xs">Sorts to</Label>
          <DestinationCell destination={destination} />
          <span className="text-[11px] text-muted-foreground">
            computed from the rules active on this day
          </span>
        </div>

        <div className="col-span-6 grid grid-cols-2 gap-3">
          <AddressFields
            side="recipient"
            letter={letter}
            citizens={sortedCitizens}
            cities={cities}
            nations={nations}
          />
          <AddressFields
            side="sender"
            letter={letter}
            citizens={sortedCitizens}
            cities={cities}
            nations={nations}
          />
        </div>

        <div className="col-span-6 flex flex-col gap-1">
          <Label>Notes</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("notes")}>
            <Textarea
              value={notesField.value}
              onChange={(e) => notesField.set(e.target.value)}
              onFocus={notesField.onFocus}
              onBlur={notesField.onBlur}
              rows={2}
              className={GHOST_FIELD}
            />
          </FieldHighlight>
        </div>
      </div>
    </div>
  );
}

// ─── One address side ────────────────────────────────────────────────────────

function AddressFields({
  side,
  letter,
  citizens,
  cities,
  nations,
}: {
  side: Side;
  letter: SortingLetterView;
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
}) {
  const { peers } = usePresenceContext();
  const focusKey = (field: string) => focusKeyFor(letter.id, field);

  const typeKey = `${side}_type` as const;
  const nameKey = `${side}_name` as const;
  const numberKey = `${side}_citizen_number` as const;
  const cityKey = `${side}_city_id` as const;
  const nationKey = `${side}_nation_id` as const;
  const citizenKey = `${side}_citizen_id` as const;

  const typeField = useLetterField(letter.id, typeKey, letter[typeKey], (v) => ({
    [typeKey]: v,
  }));
  const nameField = useLetterField(letter.id, nameKey, letter[nameKey] ?? "", (v) => ({
    [nameKey]: v.trim() || null,
  }));
  const numberField = useLetterField(
    letter.id,
    numberKey,
    letter[numberKey] ?? "",
    (v) => ({ [numberKey]: v.trim() || null })
  );
  // The city writes all three columns at once. A letter may name a city that
  // isn't in the directory, so the rule evaluator falls back to the
  // denormalized name/code — leaving those behind when the city is cleared
  // would let a city rule keep matching a letter with no city.
  const cityField = useLetterField(letter.id, cityKey, letter[cityKey] ?? "", (v) => {
    const city = cities.find((c) => c.id === v);
    return {
      [cityKey]: v || null,
      [`${side}_city_name`]: city?.name ?? null,
      [`${side}_city_code`]: city?.code ?? null,
    };
  });
  const nationField = useLetterField(
    letter.id,
    nationKey,
    letter[nationKey] ?? "",
    (v) => ({ [nationKey]: v || null })
  );

  const type = typeField.value as AddressType;
  const showCity = type === "full" || type === "lookup_1";
  const showNation = type === "full";
  const showCitizenNumber = type !== "lookup_3";

  /**
   * Picking a citizen fills the whole side in one write: the FK plus the
   * denormalized name / citizen number / city / nation the letter carries, so
   * the rule evaluator sees a complete address without a second lookup.
   */
  function chooseCitizen(citizenId: string) {
    const citizen = citizens.find((c) => c.id === citizenId);
    if (!citizen) {
      void patchSortingLetter(letter.id, { [citizenKey]: null });
      return;
    }
    const city = cities.find((c) => c.id === citizen.city_id);
    void patchSortingLetter(letter.id, {
      [citizenKey]: citizen.id,
      [nameKey]: citizenDisplayName(citizen) || null,
      [numberKey]: displayCitizenId(citizen.citizen_id) || null,
      [cityKey]: citizen.city_id,
      [`${side}_city_name`]: city?.name ?? null,
      [`${side}_city_code`]: city?.code ?? null,
      [nationKey]: citizen.nation_id,
    });
  }

  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {side}
        </h4>
        <FieldHighlight peers={peers} focusKey={focusKey(typeKey)}>
          <Select
            value={typeField.value}
            onChange={(e) => typeField.set(e.target.value as AddressType)}
            onFocus={typeField.onFocus}
            onBlur={typeField.onBlur}
            className={`h-7 w-52 ${GHOST_FIELD}`}
          >
            {ADDRESS_TYPES.map((a) => (
              <option key={a} value={a}>
                {ADDRESS_TYPE_LABELS[a]}
              </option>
            ))}
          </Select>
        </FieldHighlight>
      </div>

      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-6 flex flex-col gap-1">
          <Label>From directory</Label>
          {/* ponytail: a plain select over the citizen directory. Swap for the
              searchable combobox in inspection/letters if the cast outgrows a
              dropdown. */}
          <Select
            value={letter[citizenKey] ?? ""}
            onChange={(e) => chooseCitizen(e.target.value)}
            className={`h-8 ${GHOST_FIELD}`}
            aria-label={`${side} citizen`}
          >
            <option value="">— not from the directory —</option>
            {citizens.map((c) => (
              <option key={c.id} value={c.id}>
                {citizenDisplayName(c) || "(unnamed)"}
                {c.citizen_id ? ` ${displayCitizenId(c.citizen_id)}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="col-span-4 flex flex-col gap-1">
          <Label>Name</Label>
          <FieldHighlight peers={peers} focusKey={focusKey(nameKey)}>
            <Input
              value={nameField.value}
              onChange={(e) => nameField.set(e.target.value)}
              onFocus={nameField.onFocus}
              onBlur={nameField.onBlur}
              placeholder="—"
              className={`h-8 ${GHOST_FIELD}`}
            />
          </FieldHighlight>
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <Label>Citizen #</Label>
          <FieldHighlight peers={peers} focusKey={focusKey(numberKey)}>
            <Input
              value={numberField.value}
              onChange={(e) => numberField.set(e.target.value)}
              onFocus={numberField.onFocus}
              onBlur={numberField.onBlur}
              disabled={!showCitizenNumber}
              placeholder={showCitizenNumber ? "#0042" : "(hidden)"}
              className={`h-8 font-mono ${GHOST_FIELD}`}
            />
          </FieldHighlight>
        </div>

        <div className="col-span-3 flex flex-col gap-1">
          <Label>City</Label>
          <FieldHighlight peers={peers} focusKey={focusKey(cityKey)}>
            <Select
              value={cityField.value}
              onChange={(e) => cityField.set(e.target.value)}
              onFocus={cityField.onFocus}
              onBlur={cityField.onBlur}
              disabled={!showCity}
              className={`h-8 ${GHOST_FIELD}`}
            >
              <option value="">—</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </FieldHighlight>
        </div>

        <div className="col-span-3 flex flex-col gap-1">
          <Label>Nation</Label>
          <FieldHighlight peers={peers} focusKey={focusKey(nationKey)}>
            <Select
              value={nationField.value}
              onChange={(e) => nationField.set(e.target.value)}
              onFocus={nationField.onFocus}
              onBlur={nationField.onBlur}
              disabled={!showNation}
              className={`h-8 ${GHOST_FIELD}`}
            >
              <option value="">—</option>
              {nations.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </FieldHighlight>
        </div>
      </div>
    </div>
  );
}
