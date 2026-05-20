"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PanelHeader } from "@/components/panel";
import { NationPill } from "@/components/pills";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import type { Citizen, City, Nation } from "@/lib/db/types";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import type { PresencePeer, PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { createCity } from "./actions";
import { CityInspector } from "./city-inspector";

type SortMode = "city" | "nation";

export function CitiesEditor({
  cities,
  nations,
  citizens,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  cities: City[];
  nations: Nation[];
  citizens: Citizen[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="cities-editor"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={["cities"]}
    >
      <CitiesEditorInner cities={cities} nations={nations} citizens={citizens} />
    </WorkspacePresenceProvider>
  );
}

/** Resolve the city a peer currently has open. */
function peerCityId(peer: PresencePeer): string | null {
  const fromSelection = peer.selection?.payload?.cityId;
  if (fromSelection) return fromSelection as string;
  if (peer.focus?.table === "cities") return peer.focus.recordId;
  return null;
}

function CitiesEditorInner({
  cities: initialCities,
  nations,
  citizens,
}: {
  cities: City[];
  nations: Nation[];
  citizens: Citizen[];
}) {
  const { peers, selfPeer, setSelection, onPostgresChanges } =
    usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startMutation] = useTransition();

  // Local mirror of cities, seeded from server props.
  const [rows, setRows] = useState<City[]>(initialCities);
  const [prevInitialCities, setPrevInitialCities] = useState(initialCities);
  if (initialCities !== prevInitialCities) {
    setPrevInitialCities(initialCities);
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(initialCities.map((c) => c.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: City[] = [];
      for (const c of initialCities) {
        if (!prevById.has(c.id)) additions.push(c);
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }

  const [sortMode, setSortMode] = useState<SortMode>("city");
  const [filterNationId, setFilterNationId] = useState<string>("");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Two-way sync between `selectedId` and `?city=<name>` URL param. Matches
  // by name first, falls back to id for backwards-compat / unnamed rows.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const appliedParamRef = useRef<string | null>(null);

  // URL → state (honor external navigation).
  // The URL search params are an external system; reading them and calling
  // setState to reflect the current URL value is the correct use of an effect.
  useEffect(() => {
    const param = searchParams.get("city");
    if (param === appliedParamRef.current) return;
    appliedParamRef.current = param;
    if (param) {
      const match =
        rows.find((r) => r.name === param) ??
        rows.find((r) => r.id === param) ??
        null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(match?.id ?? null);
    } else {
      setSelectedId(null);
    }
  }, [searchParams, rows]);

  // state → URL (reflect user clicks).
  useEffect(() => {
    const row = selectedId ? rows.find((r) => r.id === selectedId) : null;
    const desired = row ? row.name?.trim() || row.id : null;
    if (desired === appliedParamRef.current) return;
    appliedParamRef.current = desired;
    const params = new URLSearchParams(searchParams);
    if (desired) params.set("city", desired);
    else params.delete("city");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [selectedId, rows, searchParams, pathname, router]);

  // Responsive panel width measurement.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setPanelWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nationById = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );
  const cityById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Citizen count per city for list rows.
  const citizenCountByCity = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of citizens) {
      if (c.city_id) m.set(c.city_id, (m.get(c.city_id) ?? 0) + 1);
    }
    return m;
  }, [citizens]);

  // Names of every city except the selected one — for duplicate detection.
  const otherNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.id === selectedId) continue;
      const k = r.name.trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [rows, selectedId]);

  // Broadcast which city the inspector has open.
  useEffect(() => {
    if (selectedId) {
      setSelection({
        storylineId: null,
        groupId: null,
        letterId: null,
        segmentId: null,
        view: "city",
        payload: { cityId: selectedId },
      });
    } else {
      setSelection(null);
    }
  }, [selectedId, setSelection]);

  // postgres_changes handler — keep local mirror in sync.
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "cities") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as City;
        setRows((prev) =>
          prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string; updated_by?: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        setSelectedId((cur) => (cur === deleted.id ? null : cur));
        const by = deleted.updated_by ?? "Someone";
        toast({ message: `${by} deleted a city.`, intent: "destructive" });
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as City;
        setRows((prev) => {
          if (prev.some((r) => r.id === inserted.id)) return prev;
          return [...prev, inserted];
        });
      }
    });
  }, [onPostgresChanges, toast]);

  // Peer presence rings indexed by city.
  const peerRingsByCity = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of peers) {
      const cid = peerCityId(p);
      if (!cid) continue;
      const color = p.profile?.avatarColorHex ?? p.color;
      const arr = m.get(cid) ?? [];
      arr.push(color);
      m.set(cid, arr);
    }
    return m;
  }, [peers]);

  const peerLocations = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of peers) {
      const cid = peerCityId(p);
      if (!cid) continue;
      const c = cityById.get(cid);
      m.set(p.userId, c ? c.name || "New city" : "A city");
    }
    return m;
  }, [peers, cityById]);

  function handleAvatarClick(peer: PresencePeer) {
    const cid = peerCityId(peer);
    if (cid && rows.some((r) => r.id === cid)) setSelectedId(cid);
  }

  function handleCreate() {
    startMutation(async () => {
      await createCity();
      // createCity triggers revalidatePath which updates the server props.
      // The INSERT postgres_changes will add the new row to the local mirror.
    });
  }

  // The inspector has already run deleteCity — just reconcile local state.
  function handleDeleted(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  const view = useMemo(() => {
    let list = rows.slice();
    if (filterNationId) list = list.filter((r) => r.nation_id === filterNationId);
    list.sort((a, b) => {
      if (sortMode === "nation") {
        const an = nationById.get(a.nation_id)?.name ?? "";
        const bn = nationById.get(b.nation_id)?.name ?? "";
        const byNation = an.localeCompare(bn);
        if (byNation !== 0) return byNation;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, sortMode, filterNationId, nationById]);

  const selected = selectedId ? cityById.get(selectedId) ?? null : null;

  // Whether to show the count column (hide when panel is too narrow).
  const showCount = panelWidth === 0 || panelWidth >= 380;

  return (
    <>
      {toaster}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCreate}
          aria-label="Add city"
          title="Add city"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus size={16} aria-hidden />
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {peers.length > 0 ? (
            <AvatarStack
              peers={peers}
              self={selfPeer}
              peerLocations={peerLocations}
              onAvatarClick={handleAvatarClick}
              popupAlign="right"
            />
          ) : null}
          <Label className="!text-xs">Filter</Label>
          <Select
            value={filterNationId}
            onChange={(e) => setFilterNationId(e.target.value)}
            className="h-8 w-auto"
          >
            <option value="">All nations</option>
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
            <option value="city">City name</option>
            <option value="nation">Nation, then city</option>
          </Select>
        </div>
      </div>

      <div className="flex items-start gap-4">
        <div
          ref={panelRef}
          className="sticky top-4 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        >
          <PanelHeader
            title="Cities"
            icon={
              <Building2
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
            }
          />
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <span className="w-8 shrink-0" />
            <Label className="flex-1">Name</Label>
            <Label className="w-[110px] shrink-0 font-mono">Code</Label>
            {showCount ? (
              <Label className="w-20 shrink-0 text-right">Citizens</Label>
            ) : null}
          </div>
          {view.map((row) => {
            const nation = nationById.get(row.nation_id) ?? null;
            const count = citizenCountByCity.get(row.id) ?? 0;
            const peerColors = peerRingsByCity.get(row.id) ?? null;
            return (
              <CityRow
                key={row.id}
                row={row}
                nation={nation}
                citizenCount={count}
                selected={row.id === selectedId}
                showCount={showCount}
                peerColors={peerColors}
                onSelect={() =>
                  setSelectedId((cur) => (cur === row.id ? null : row.id))
                }
              />
            );
          })}
          {view.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No cities{filterNationId ? " in that nation" : ""} yet.
            </p>
          ) : null}
        </div>

        {selected ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <CityInspector
              key={selected.id}
              city={selected}
              nations={nations}
              citizens={citizens}
              otherNames={otherNames}
              onDeleted={handleDeleted}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function CityRow({
  row,
  nation,
  citizenCount,
  selected,
  showCount,
  peerColors,
  onSelect,
}: {
  row: City;
  nation: Nation | null;
  citizenCount: number;
  selected: boolean;
  showCount: boolean;
  peerColors: string[] | null;
  onSelect: () => void;
}) {
  const boxShadow = peerColors?.length
    ? peerColors
        .map((c, i) => `inset 0 0 0 ${(i + 1) * 2}px ${c}`)
        .join(", ")
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={boxShadow ? { boxShadow } : undefined}
      className={cn(
        "flex cursor-pointer items-center gap-2 border-t border-border px-3 py-1.5 text-sm transition-colors first:border-t-0 hover:bg-accent/20 focus:outline-none focus-visible:bg-accent/20",
        selected ? "bg-accent/30" : undefined
      )}
    >
      {/* Nation chip — passive square showing the nation's icon. */}
      {nation ? (
        <NationPill nation={nation} iconOnly className="shrink-0" />
      ) : (
        <span
          className="h-6 w-6 shrink-0 rounded-md bg-muted"
          aria-hidden
        />
      )}

      {/* City name */}
      <span className="min-w-0 flex-1 truncate">
        {row.name || <span className="text-muted-foreground">Unnamed city</span>}
      </span>

      {/* Code */}
      <span className="w-[110px] shrink-0 truncate font-mono text-xs text-muted-foreground">
        {row.code || <span className="opacity-50">—</span>}
      </span>

      {/* Citizen count */}
      {showCount ? (
        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
          {citizenCount > 0 ? `${citizenCount} citizen${citizenCount === 1 ? "" : "s"}` : null}
        </span>
      ) : null}
    </div>
  );
}
