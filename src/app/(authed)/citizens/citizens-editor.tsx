"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CITIZEN_TYPES, type CitizenType } from "@/lib/db/enums";
import {
  formatCitizenIdInput,
  generateRandomCitizenId,
  isValidCitizenId,
} from "@/lib/citizen-id";
import { cn } from "@/lib/utils";
import type { Citizen, City, Nation } from "@/lib/db/types";
import { deleteCitizen, updateAllCitizens } from "./actions";

type RowState = {
  id: string;
  name: string;
  type: CitizenType | "";
  citizen_id: string;
  city_id: string;
  nation_id: string;
};

type RowValidation = {
  missingType: boolean;
  missingName: boolean;
  missingCitizenId: boolean;
  missingCityId: boolean;
  missingNationId: boolean;
  badCitizenIdFormat: boolean;
  duplicateCitizenId: boolean;
  blocksSave: boolean;
};

type SortMode = "name" | "type" | "nation";
type TypeFilter = "all" | "hero" | "npc" | "unset";

function validateRow(r: RowState, duplicateIds: Set<string>): RowValidation {
  const missingType = !r.type;
  const missingName = !r.name.trim();
  const cid = r.citizen_id.trim();
  const missingCitizenId = !cid;
  const missingCityId = !r.city_id;
  const missingNationId = !r.nation_id;
  const badCitizenIdFormat = cid.length > 0 && !isValidCitizenId(cid);
  const duplicateCitizenId = cid.length > 0 && duplicateIds.has(cid);
  const npcIncomplete =
    r.type === "npc" &&
    (missingName || missingCitizenId || missingCityId || missingNationId);
  return {
    missingType,
    missingName,
    missingCitizenId,
    missingCityId,
    missingNationId,
    badCitizenIdFormat,
    duplicateCitizenId,
    blocksSave:
      missingType ||
      npcIncomplete ||
      badCitizenIdFormat ||
      duplicateCitizenId,
  };
}

function readableOn(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

export function CitizensEditor({
  citizens,
  cities,
  nations,
}: {
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() =>
    citizens.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      citizen_id: c.citizen_id ?? "",
      city_id: c.city_id ?? "",
      nation_id: c.nation_id ?? "",
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [nationFilter, setNationFilter] = useState<string>("");

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(citizens.map((c) => c.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      const additions: RowState[] = [];
      for (const c of citizens) {
        if (!prevById.has(c.id)) {
          additions.push({
            id: c.id,
            name: c.name,
            type: c.type,
            citizen_id: c.citizen_id ?? "",
            city_id: c.city_id ?? "",
            nation_id: c.nation_id ?? "",
          });
        }
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }, [citizens]);

  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const nationById = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );

  const duplicateIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = r.citizen_id.trim();
      if (!k) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [k, n] of seen) if (n > 1) dupes.add(k);
    return dupes;
  }, [rows]);

  const allCitizenIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const k = r.citizen_id.trim();
      if (k) s.add(k);
    }
    return s;
  }, [rows]);

  const anyBlocked = rows.some((r) => validateRow(r, duplicateIds).blocksSave);

  const view = useMemo(() => {
    let list = rows.slice();
    if (typeFilter !== "all") {
      list = list.filter((r) => {
        if (typeFilter === "unset") return r.type === "";
        return r.type === typeFilter;
      });
    }
    if (nationFilter) {
      list = list.filter((r) => r.nation_id === nationFilter);
    }
    list.sort((a, b) => {
      if (sortMode === "type") {
        const order: Record<string, number> = { hero: 0, npc: 1, "": 2 };
        const ta = order[a.type] ?? 3;
        const tb = order[b.type] ?? 3;
        if (ta !== tb) return ta - tb;
      }
      if (sortMode === "nation") {
        const an = nationById.get(a.nation_id)?.name ?? "";
        const bn = nationById.get(b.nation_id)?.name ?? "";
        const byNation = an.localeCompare(bn);
        if (byNation !== 0) return byNation;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, typeFilter, nationFilter, sortMode, nationById]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllCitizens(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if ("nation_id" in patch) {
          const currentCity = cityById.get(next.city_id);
          if (currentCity && currentCity.nation_id !== next.nation_id) {
            next.city_id = "";
          }
        }
        if ("city_id" in patch && patch.city_id) {
          const city = cityById.get(patch.city_id);
          if (city) next.nation_id = city.nation_id;
        }
        return next;
      })
    );
    setDirty(true);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {anyBlocked ? (
          <span className="text-xs text-destructive">
            Fix errors to save.
          </span>
        ) : null}
        <Label className="!text-xs">Type</Label>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="h-8 w-auto"
        >
          <option value="all">All</option>
          <option value="hero">Hero</option>
          <option value="npc">NPC</option>
          <option value="unset">Unset</option>
        </Select>
        <Label className="ml-3 !text-xs">Nation</Label>
        <Select
          value={nationFilter}
          onChange={(e) => setNationFilter(e.target.value)}
          className="h-8 w-auto"
        >
          <option value="">All</option>
          {nations.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </Select>
        <Label className="ml-3 !text-xs">Sort</Label>
        <Select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="h-8 w-auto"
        >
          <option value="name">Name</option>
          <option value="type">Type, then name</option>
          <option value="nation">Nation, then name</option>
        </Select>
        <Button
          type="button"
          onClick={save}
          variant={dirty && !anyBlocked ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty || anyBlocked}
          className="ml-3"
        >
          {pending ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="overflow-hidden rounded-md border border-border bg-card"
      >
        <div className="grid grid-cols-[1fr_90px_130px_180px_180px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <Label>Name</Label>
          <Label>Type</Label>
          <Label>Citizen ID</Label>
          <Label>City</Label>
          <Label>Nation</Label>
          <span />
        </div>
        {view.map((r) => (
          <CitizenRow
            key={r.id}
            row={r}
            cities={cities}
            nations={nations}
            duplicateIds={duplicateIds}
            allCitizenIds={allCitizenIds}
            nationById={nationById}
            onChange={(patch) => updateRow(r.id, patch)}
            onDelete={() => {
              const fd = new FormData();
              fd.append("id", r.id);
              startTransition(async () => {
                await deleteCitizen(fd);
                setRows((prev) => prev.filter((x) => x.id !== r.id));
              });
            }}
          />
        ))}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No citizens match the current filter.
          </p>
        ) : null}
      </form>
    </>
  );
}

function missingClass(type: RowState["type"], missing: boolean): string {
  if (!missing) return "";
  if (type === "npc") return "ring-2 ring-destructive ring-offset-0";
  if (type === "hero") return "ring-2 ring-warning ring-offset-0";
  return "";
}

function CitizenRow({
  row,
  cities,
  nations,
  duplicateIds,
  allCitizenIds,
  nationById,
  onChange,
  onDelete,
}: {
  row: RowState;
  cities: City[];
  nations: Nation[];
  duplicateIds: Set<string>;
  allCitizenIds: Set<string>;
  nationById: Map<string, Nation>;
  onChange: (patch: Partial<RowState>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const availableCities = useMemo(
    () =>
      row.nation_id
        ? cities.filter((c) => c.nation_id === row.nation_id)
        : cities,
    [cities, row.nation_id]
  );
  const v = validateRow(row, duplicateIds);
  const cityName = cities.find((c) => c.id === row.city_id)?.name ?? "";
  const nation = nationById.get(row.nation_id);

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setEditing(false);
    }
  }

  const cidRing = v.duplicateCitizenId || v.badCitizenIdFormat
    ? "ring-2 ring-destructive ring-offset-0"
    : missingClass(row.type, v.missingCitizenId);

  return (
    <div
      tabIndex={-1}
      onFocus={() => setEditing(true)}
      onClick={() => setEditing(true)}
      onBlur={handleBlur}
      className={cn(
        "grid cursor-text grid-cols-[1fr_90px_130px_180px_180px_36px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0",
        editing && "bg-accent/20"
      )}
    >
      <input type="hidden" name="ids" value={row.id} />
      <input type="hidden" name="names" value={row.name} />
      <input type="hidden" name="types" value={row.type} />
      <input type="hidden" name="citizen_ids" value={row.citizen_id} />
      <input type="hidden" name="city_ids" value={row.city_id} />
      <input type="hidden" name="nation_ids" value={row.nation_id} />

      {editing ? (
        <>
          <Input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn("h-8", missingClass(row.type, v.missingName))}
            autoFocus
            required
          />
          <TypePill
            value={row.type}
            onChange={(t) => onChange({ type: t })}
            invalid={row.type === ""}
          />
          <CitizenIdInput
            value={row.citizen_id}
            onChange={(v) => onChange({ citizen_id: v })}
            className={cn("h-8", cidRing)}
            allCitizenIds={allCitizenIds}
          />
          <Select
            value={row.city_id}
            onChange={(e) => onChange({ city_id: e.target.value })}
            className={cn("h-8", missingClass(row.type, v.missingCityId))}
          >
            <option value="">—</option>
            {availableCities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={row.nation_id}
            onChange={(e) => onChange({ nation_id: e.target.value })}
            className={cn("h-8", missingClass(row.type, v.missingNationId))}
          >
            <option value="">—</option>
            {nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center justify-end">
            <DeleteX name={row.name} onDelete={onDelete} />
          </div>
        </>
      ) : (
        <>
          <ReadCell className={missingClass(row.type, v.missingName)}>
            {row.name || <span className="text-muted-foreground">—</span>}
          </ReadCell>
          <TypePill
            value={row.type}
            onChange={(t) => onChange({ type: t })}
            invalid={row.type === ""}
          />
          <ReadCell className={cidRing}>
            {row.citizen_id || <span className="text-muted-foreground">—</span>}
          </ReadCell>
          <ReadCell className={missingClass(row.type, v.missingCityId)}>
            {cityName || <span className="text-muted-foreground">—</span>}
          </ReadCell>
          <div
            className={cn(
              "flex h-8 items-center",
              missingClass(row.type, v.missingNationId)
            )}
          >
            {nation ? (
              <NationPill nation={nation} />
            ) : (
              <span className="px-2 text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex items-center justify-end">
            <DeleteX name={row.name} onDelete={onDelete} />
          </div>
        </>
      )}
    </div>
  );
}

function ReadCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-8 items-center truncate rounded-md px-2 text-sm",
        className
      )}
    >
      {children}
    </span>
  );
}

function TypePill({
  value,
  onChange,
  invalid,
}: {
  value: RowState["type"];
  onChange: (t: RowState["type"]) => void;
  invalid: boolean;
}) {
  // NPC = grey, HERO = white-on-dark, unset = muted + destructive ring.
  const pillClass = invalid
    ? "bg-muted text-muted-foreground ring-2 ring-destructive"
    : value === "hero"
      ? "bg-foreground text-background"
      : "bg-muted text-muted-foreground";
  const label = value === "" ? "—" : value.toUpperCase();
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-[74px] items-center justify-center rounded-full font-mono text-xs uppercase tracking-wide",
        pillClass
      )}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as RowState["type"])}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="Citizen type"
      >
        <option value="">—</option>
        {CITIZEN_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </span>
  );
}

function NationPill({ nation }: { nation: Nation }) {
  const fg = readableOn(nation.color_hex);
  return (
    <span
      className="inline-flex h-7 items-center rounded-full px-3 font-mono text-xs uppercase tracking-wide"
      style={{ background: nation.color_hex, color: fg }}
    >
      {nation.name}
    </span>
  );
}

function DeleteX({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Delete citizen"
      title="Delete"
      onClick={() => {
        if (!confirm(`Delete citizen "${name}"? This cannot be undone.`)) return;
        onDelete();
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

function CitizenIdInput({
  value,
  onChange,
  className,
  allCitizenIds,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  allCitizenIds: Set<string>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className="relative flex items-center"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <Input
        value={value}
        onChange={(e) => onChange(formatCitizenIdInput(e.target.value))}
        placeholder="#0042"
        maxLength={5}
        className={cn(className, "pr-7")}
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
