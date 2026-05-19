"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
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
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import type { Citizen, City, Nation } from "@/lib/db/types";
import { WorkspacePresenceProvider, usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceProfile, PresencePeer } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { deleteCitizen, patchCitizen } from "./actions";

type SortMode = "name" | "type" | "nation";
type TypeFilter = "all" | "hero" | "npc";

type RowValidation = {
  missingType: boolean;
  missingName: boolean;
  missingCitizenId: boolean;
  missingCityId: boolean;
  missingNationId: boolean;
  badCitizenIdFormat: boolean;
  duplicateCitizenId: boolean;
};

function validateRow(r: Citizen, duplicateIds: Set<string>): RowValidation {
  const missingType = false; // DB always has a type (hero | npc)
  const missingName = !r.name.trim();
  const cid = (r.citizen_id ?? "").trim();
  const missingCitizenId = !cid;
  const missingCityId = !r.city_id;
  const missingNationId = !r.nation_id;
  const badCitizenIdFormat = cid.length > 0 && !isValidCitizenId(cid);
  const duplicateCitizenId = cid.length > 0 && duplicateIds.has(cid);
  return {
    missingType,
    missingName,
    missingCitizenId,
    missingCityId,
    missingNationId,
    badCitizenIdFormat,
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
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="citizens-editor"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={["citizens"]}
    >
      <CitizensEditorInner citizens={citizens} cities={cities} nations={nations} />
    </WorkspacePresenceProvider>
  );
}

function CitizensEditorInner({
  citizens: initialCitizens,
  cities,
  nations,
}: {
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
}) {
  const router = useRouter();
  const { peers, onPostgresChanges, pingActivity } = usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startDeleteTransition] = useTransition();

  // Local mirror of citizens, seeded from server props. useEffect reconciles
  // when the server prop changes (e.g. after a structural revalidate adds a citizen).
  const [rows, setRows] = useState<Citizen[]>(initialCitizens);
  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(initialCitizens.map((c) => c.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: Citizen[] = [];
      for (const c of initialCitizens) {
        if (!prevById.has(c.id)) additions.push(c);
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [initialCitizens]);

  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [nationFilter, setNationFilter] = useState<string>("");

  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const nationById = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );

  const duplicateIds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = (r.citizen_id ?? "").trim();
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
      const k = (r.citizen_id ?? "").trim();
      if (k) s.add(k);
    }
    return s;
  }, [rows]);

  // postgres_changes handler
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "citizens") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as Citizen;
        setRows((prev) =>
          prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string; updated_by?: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        const by = deleted.updated_by ?? "Someone";
        toast({
          message: `${by} deleted a citizen.`,
          intent: "destructive",
        });
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as Citizen;
        setRows((prev) => {
          if (prev.some((r) => r.id === inserted.id)) return prev;
          return [...prev, inserted];
        });
        startTransition(() => router.refresh());
      }
    });
  }, [onPostgresChanges, router, toast]);

  const view = useMemo(() => {
    let list = rows.slice();
    if (typeFilter !== "all") {
      list = list.filter((r) => r.type === typeFilter);
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
        const an = nationById.get(a.nation_id ?? "")?.name ?? "";
        const bn = nationById.get(b.nation_id ?? "")?.name ?? "";
        const byNation = an.localeCompare(bn);
        if (byNation !== 0) return byNation;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, typeFilter, nationFilter, sortMode, nationById]);

  return (
    <>
      {toaster}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Label className="!text-xs">Type</Label>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="h-8 w-auto"
        >
          <option value="all">All</option>
          <option value="hero">Hero</option>
          <option value="npc">NPC</option>
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
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[1fr_90px_130px_180px_180px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <Label>Name</Label>
          <Label>Type</Label>
          <Label>Citizen ID</Label>
          <Label>City</Label>
          <Label>Nation</Label>
          <span />
        </div>
        {view.map((row) => (
          <CitizenRow
            key={row.id}
            row={row}
            cities={cities}
            nations={nations}
            duplicateIds={duplicateIds}
            allCitizenIds={allCitizenIds}
            nationById={nationById}
            cityById={cityById}
            peers={peers}
            onActivity={pingActivity}
            onDelete={() => {
              startDeleteTransition(async () => {
                const fd = new FormData();
                fd.append("id", row.id);
                await deleteCitizen(fd);
                setRows((prev) => prev.filter((x) => x.id !== row.id));
              });
            }}
          />
        ))}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No citizens match the current filter.
          </p>
        ) : null}
      </div>
    </>
  );
}

function missingClass(type: CitizenType | null | undefined, missing: boolean): string {
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
  cityById,
  peers,
  onActivity,
  onDelete,
}: {
  row: Citizen;
  cities: City[];
  nations: Nation[];
  duplicateIds: Set<string>;
  allCitizenIds: Set<string>;
  nationById: Map<string, Nation>;
  cityById: Map<string, City>;
  peers: PresencePeer[];
  onActivity: () => void;
  onDelete: () => void;
}) {
  const { setFocus } = usePresenceContext();
  const [editing, setEditing] = useState(false);

  const v = validateRow(row, duplicateIds);
  const cityName = cities.find((c) => c.id === row.city_id)?.name ?? "";
  const nation = nationById.get(row.nation_id ?? "");

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setEditing(false);
    }
  }

  const focusBase = { table: "citizens", recordId: row.id };

  const nameField = useInstantField({
    value: row.name,
    onCommit: (v) => patchCitizen(row.id, { name: v }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "name" } : null);
    },
    onActivity,
  });

  const typeField = useInstantField({
    value: row.type,
    onCommit: (v) => patchCitizen(row.id, { type: v as CitizenType }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "type" } : null);
    },
    onActivity,
  });

  const citizenIdField = useInstantField({
    value: row.citizen_id ?? "",
    onCommit: (v) => patchCitizen(row.id, { citizen_id: v || null }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "citizen_id" } : null);
    },
    onActivity,
  });

  const cityIdField = useInstantField({
    value: row.city_id ?? "",
    onCommit: (v) => patchCitizen(row.id, { city_id: v || null }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "city_id" } : null);
    },
    onActivity,
  });

  const nationIdField = useInstantField({
    value: row.nation_id ?? "",
    onCommit: (v) => patchCitizen(row.id, { nation_id: v || null }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "nation_id" } : null);
    },
    onActivity,
  });

  // Use the hook's local (in-progress) nation value so the city dropdown
  // filters correctly the moment the user selects a nation — before
  // realtime echoes the change back to row.nation_id.
  const availableCities = useMemo(
    () =>
      nationIdField.value
        ? cities.filter((c) => c.nation_id === nationIdField.value)
        : cities,
    [cities, nationIdField.value]
  );

  const cidRing = v.duplicateCitizenId || v.badCitizenIdFormat
    ? "ring-2 ring-destructive ring-offset-0"
    : missingClass(row.type, v.missingCitizenId);

  // Expand the row to input mode when a peer focuses any field on this row,
  // so the FieldHighlight rings have an element to render against. Without
  // this, peer rings can never appear on rows the local user isn't editing.
  const peerEditingHere = peers.some((p) => p.focus?.recordId === row.id);
  const showInputs = editing || peerEditingHere;

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
      {showInputs ? (
        <>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "name" }}>
            <Input
              value={nameField.value}
              onChange={(e) => nameField.set(e.target.value)}
              onFocus={nameField.onFocus}
              onBlur={nameField.onBlur}
              className={cn("h-8", missingClass(row.type, v.missingName))}
              autoFocus={editing}
              required
            />
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "type" }}>
            <TypePill
              value={typeField.value}
              onChange={(t) => typeField.set(t)}
              onFocus={typeField.onFocus}
              onBlur={typeField.onBlur}
            />
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "citizen_id" }}>
            <CitizenIdInput
              value={citizenIdField.value}
              onChange={(v) => citizenIdField.set(v)}
              onFocus={citizenIdField.onFocus}
              onBlur={citizenIdField.onBlur}
              className={cn("h-8", cidRing)}
              allCitizenIds={allCitizenIds}
            />
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "city_id" }}>
            <div
              onFocus={cityIdField.onFocus}
              onBlur={cityIdField.onBlur}
            >
              <Select
                value={cityIdField.value}
                onChange={(e) => {
                  const newCityId = e.target.value;
                  cityIdField.set(newCityId);
                  // Auto-fill nation from city FK — both fields debounce
                  // independently; realtime echoes confirm the final values.
                  if (newCityId) {
                    const city = cityById.get(newCityId);
                    if (city) {
                      nationIdField.set(city.nation_id);
                    }
                  }
                }}
                className={cn("h-8", missingClass(row.type, v.missingCityId))}
              >
                <option value="">—</option>
                {availableCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "nation_id" }}>
            <div
              onFocus={nationIdField.onFocus}
              onBlur={nationIdField.onBlur}
            >
              <Select
                value={nationIdField.value}
                onChange={(e) => {
                  const newNationId = e.target.value;
                  nationIdField.set(newNationId);
                  // Clear city if it belongs to a different nation — both
                  // fields debounce independently; realtime echoes confirm.
                  const currentCity = cityById.get(cityIdField.value);
                  if (currentCity && currentCity.nation_id !== newNationId) {
                    cityIdField.set("");
                  }
                }}
                className={cn("h-8", missingClass(row.type, v.missingNationId))}
              >
                <option value="">—</option>
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </div>
          </FieldHighlight>
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
            onChange={(t) => typeField.set(t)}
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
  onFocus,
  onBlur,
}: {
  value: CitizenType;
  onChange: (t: CitizenType) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const pillClass =
    value === "hero"
      ? "bg-foreground text-background"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-[74px] items-center justify-center rounded-full font-mono text-xs uppercase tracking-wide",
        pillClass
      )}
    >
      {value.toUpperCase()}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CitizenType)}
        onFocus={onFocus}
        onBlur={onBlur}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="Citizen type"
      >
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
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  return (
    <>
      <button
        type="button"
        aria-label="Delete citizen"
        title="Delete"
        onClick={async () => {
          const ok = await confirmDialog({
            title: "Delete citizen?",
            message: `"${name}" will be permanently removed.`,
            confirmLabel: "Delete",
            intent: "destructive",
          });
          if (!ok) return;
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
      {confirmDialogEl}
    </>
  );
}

function CitizenIdInput({
  value,
  onChange,
  onFocus,
  onBlur,
  className,
  allCitizenIds,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  allCitizenIds: Set<string>;
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
