"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, Plus, Star, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PanelHeader } from "@/components/panel";
import { readableOnHex } from "@/components/pills";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import type {
  Citizen,
  City,
  InspectionLetterView,
  Nation,
  SortingLetterView,
  Storyline,
} from "@/lib/db/types";
import {
  citizenDisplayName,
  citizenFullName,
  citizenIssues,
  citizenSortKey,
} from "@/lib/citizen-name";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import type { PresencePeer, PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { createCitizen } from "./actions";
import { CitizenInspector } from "./citizen-inspector";

type SortMode = "name" | "type" | "nation";
type TypeFilter = "all" | "hero" | "npc";

/** Which columns are visible at the panel's current width. Columns drop, as
 *  the panel narrows, in the order Nation → Citizen ID → City → Hero; Name
 *  always survives. When Nation is dropped, City takes on its nation color. */
type ColLayout = {
  hero: boolean;
  citizenId: boolean;
  city: boolean;
  nation: boolean;
  cityAsPill: boolean;
};

function columnsForWidth(width: number): ColLayout {
  // width 0 = not yet measured — show everything to avoid a drop-in flash.
  const measured = width > 0;
  const nation = !measured || width >= 620;
  const citizenId = !measured || width >= 500;
  const city = !measured || width >= 380;
  const hero = !measured || width >= 280;
  return { hero, citizenId, city, nation, cityAsPill: !nation && city };
}

export function CitizensEditor({
  citizens,
  cities,
  nations,
  storylines,
  inspectionLetters,
  sortingLetters,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  storylines: Storyline[];
  inspectionLetters: InspectionLetterView[];
  sortingLetters: SortingLetterView[];
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
      <CitizensEditorInner
        citizens={citizens}
        cities={cities}
        nations={nations}
        storylines={storylines}
        inspectionLetters={inspectionLetters}
        sortingLetters={sortingLetters}
      />
    </WorkspacePresenceProvider>
  );
}

/** Resolve the citizen a peer currently has open — the inspector selection
 *  (carried in selection.payload.citizenId) takes precedence over a bare
 *  field focus. */
function peerCitizenId(peer: PresencePeer): string | null {
  const fromSelection = peer.selection?.payload?.citizenId;
  if (fromSelection) return fromSelection;
  if (peer.focus?.table === "citizens") return peer.focus.recordId;
  return null;
}

function citizenNameKey(c: Citizen): string {
  return citizenFullName(c).trim().toLowerCase();
}

function CitizensEditorInner({
  citizens: initialCitizens,
  cities,
  nations,
  storylines,
  inspectionLetters,
  sortingLetters,
}: {
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  storylines: Storyline[];
  inspectionLetters: InspectionLetterView[];
  sortingLetters: SortingLetterView[];
}) {
  const { peers, selfPeer, setSelection, onPostgresChanges } =
    usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startMutation] = useTransition();

  // Local mirror of citizens, seeded from server props. The useEffect
  // reconciles when the server prop changes (e.g. after a bulk-paste
  // revalidate adds rows).
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

  // The inspector's open citizen + the row pinned to the top of the list
  // (a freshly created citizen stays on top while it remains selected).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // Responsive column layout, driven by the list panel's measured width.
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
  const cols = useMemo(() => columnsForWidth(panelWidth), [panelWidth]);

  const nationById = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );
  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const citizenById = useMemo(
    () => new Map(rows.map((r) => [r.id, r])),
    [rows]
  );

  const allCitizenIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const k = (r.citizen_id ?? "").trim();
      if (k) s.add(k);
    }
    return s;
  }, [rows]);

  // Names / citizen IDs that appear on more than one citizen — used to flag
  // duplicates in the list.
  const { dupNames, dupIds } = useMemo(() => {
    const nameCount = new Map<string, number>();
    const idCount = new Map<string, number>();
    for (const r of rows) {
      const n = citizenNameKey(r);
      if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      const i = (r.citizen_id ?? "").trim();
      if (i) idCount.set(i, (idCount.get(i) ?? 0) + 1);
    }
    const dn = new Set<string>();
    for (const [k, v] of nameCount) if (v > 1) dn.add(k);
    const di = new Set<string>();
    for (const [k, v] of idCount) if (v > 1) di.add(k);
    return { dupNames: dn, dupIds: di };
  }, [rows]);

  // Names / IDs of every citizen *except* the selected one — lets the
  // inspector duplicate-check its live (in-progress) values.
  const { otherNames, otherIds } = useMemo(() => {
    const n = new Set<string>();
    const i = new Set<string>();
    for (const r of rows) {
      if (r.id === selectedId) continue;
      const nn = citizenNameKey(r);
      if (nn) n.add(nn);
      const ii = (r.citizen_id ?? "").trim();
      if (ii) i.add(ii);
    }
    return { otherNames: n, otherIds: i };
  }, [rows, selectedId]);

  // Broadcast which citizen the inspector has open so peers can ring the row
  // and jump to it. Cleared when the inspector closes.
  useEffect(() => {
    if (selectedId) {
      setSelection({
        storylineId: null,
        groupId: null,
        letterId: null,
        segmentId: null,
        view: "citizen",
        payload: { citizenId: selectedId },
      });
    } else {
      setSelection(null);
    }
  }, [selectedId, setSelection]);

  // The pin holds the freshly created citizen at the top of the list while it
  // stays selected — selecting another row (or closing the inspector / a
  // reload) drops it and the row re-sorts into place.
  const activePinnedId = pinnedId && pinnedId === selectedId ? pinnedId : null;

  // postgres_changes handler — keep the local mirror in sync with peers.
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "citizens") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as Citizen;
        setRows((prev) =>
          prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        setSelectedId((cur) => (cur === deleted.id ? null : cur));
        toast({
          message: "A citizen was deleted by another user.",
          intent: "destructive",
        });
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as Citizen;
        setRows((prev) => {
          if (prev.some((r) => r.id === inserted.id)) return prev;
          return [...prev, inserted];
        });
      }
    });
  }, [onPostgresChanges, toast]);

  // Peer presence indexed by the citizen each peer has open.
  const peerRingsByCitizen = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of peers) {
      const cid = peerCitizenId(p);
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
      const cid = peerCitizenId(p);
      if (!cid) continue;
      const c = citizenById.get(cid);
      m.set(p.userId, c ? citizenFullName(c) || "New citizen" : "A citizen");
    }
    return m;
  }, [peers, citizenById]);

  function handleAvatarClick(peer: PresencePeer) {
    const cid = peerCitizenId(peer);
    if (cid && rows.some((r) => r.id === cid)) setSelectedId(cid);
  }

  function handleCreate() {
    startMutation(async () => {
      const created = await createCitizen();
      setRows((prev) =>
        prev.some((r) => r.id === created.id) ? prev : [created, ...prev]
      );
      setPinnedId(created.id);
      setSelectedId(created.id);
    });
  }

  // The inspector has already run deleteCitizen — just reconcile local state.
  function handleDeleted(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

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
        const order: Record<string, number> = { hero: 0, npc: 1 };
        const ta = order[a.type] ?? 2;
        const tb = order[b.type] ?? 2;
        if (ta !== tb) return ta - tb;
      }
      if (sortMode === "nation") {
        const an = nationById.get(a.nation_id ?? "")?.name ?? "";
        const bn = nationById.get(b.nation_id ?? "")?.name ?? "";
        const byNation = an.localeCompare(bn);
        if (byNation !== 0) return byNation;
      }
      return citizenSortKey(a).localeCompare(citizenSortKey(b));
    });
    // A freshly created citizen stays at the top, bypassing filters + sort,
    // until it is deselected.
    if (activePinnedId) {
      const idx = list.findIndex((r) => r.id === activePinnedId);
      if (idx > 0) {
        const [p] = list.splice(idx, 1);
        list.unshift(p);
      } else if (idx < 0) {
        const pinned = rows.find((r) => r.id === activePinnedId);
        if (pinned) list.unshift(pinned);
      }
    }
    return list;
  }, [rows, typeFilter, nationFilter, sortMode, nationById, activePinnedId]);

  const selected = selectedId ? citizenById.get(selectedId) ?? null : null;

  return (
    <>
      {toaster}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCreate}
          aria-label="Add citizen"
          title="Add citizen"
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
      </div>

      <div className="flex items-start gap-4">
        <div
          ref={panelRef}
          className="sticky top-4 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        >
          <PanelHeader
            title="Citizens"
            icon={
              <Users
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
            }
          />
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            {cols.hero ? <span className="w-6 shrink-0" /> : null}
            <Label className="flex-[2]">Name</Label>
            {cols.citizenId ? (
              <Label className="w-[68px] shrink-0 text-center">
                Citizen ID
              </Label>
            ) : null}
            {cols.city ? (
              <Label className="flex-1 text-center">City</Label>
            ) : null}
            {cols.nation ? (
              <Label className="flex-1 text-center">Nation</Label>
            ) : null}
          </div>
          {view.map((row) => {
            const issues = citizenIssues(row, {
              duplicateName: dupNames.has(citizenNameKey(row)),
              duplicateCitizenId: dupIds.has((row.citizen_id ?? "").trim()),
            });
            return (
              <CitizenRow
                key={row.id}
                row={row}
                cols={cols}
                cityName={cityById.get(row.city_id ?? "")?.name ?? ""}
                nation={nationById.get(row.nation_id ?? "") ?? null}
                selected={row.id === selectedId}
                hasError={issues.length > 0}
                peerColors={peerRingsByCitizen.get(row.id) ?? null}
                onSelect={() =>
                  setSelectedId((cur) => (cur === row.id ? null : row.id))
                }
              />
            );
          })}
          {view.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No citizens match the current filter.
            </p>
          ) : null}
        </div>

        {selected ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <CitizenInspector
              key={selected.id}
              citizen={selected}
              cities={cities}
              nations={nations}
              storylines={storylines}
              inspectionLetters={inspectionLetters}
              sortingLetters={sortingLetters}
              allCitizenIds={allCitizenIds}
              otherNames={otherNames}
              otherIds={otherIds}
              onDeleted={handleDeleted}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function CitizenRow({
  row,
  cols,
  cityName,
  nation,
  selected,
  hasError,
  peerColors,
  onSelect,
}: {
  row: Citizen;
  cols: ColLayout;
  cityName: string;
  nation: Nation | null;
  selected: boolean;
  hasError: boolean;
  peerColors: string[] | null;
  onSelect: () => void;
}) {
  const name = citizenDisplayName(row);
  // Peer rings drawn inset so the panel's clip + rounded corners don't crop
  // them.
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
        selected
          ? "bg-accent/30"
          : hasError
            ? "bg-destructive/10"
            : undefined
      )}
    >
      {cols.hero ? (
        <span
          className="flex w-6 shrink-0 items-center justify-center"
          title={row.type === "hero" ? "Hero" : undefined}
        >
          {row.type === "hero" ? (
            <Star size={14} aria-label="Hero" className="text-foreground" />
          ) : null}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-[2] items-center gap-1.5">
        {hasError ? (
          <AlertCircle
            size={13}
            aria-hidden
            className="shrink-0 text-destructive"
          />
        ) : null}
        <span className="truncate">
          {name || (
            <span className="text-muted-foreground">Unnamed citizen</span>
          )}
        </span>
      </span>
      {cols.citizenId ? (
        <span className="w-[68px] shrink-0 truncate text-center font-mono text-xs">
          {row.citizen_id || <span className="text-muted-foreground">—</span>}
        </span>
      ) : null}
      {cols.city ? (
        cols.cityAsPill ? (
          <span className="flex min-w-0 flex-1 justify-center">
            <CityPill cityName={cityName} nation={nation} />
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-center">
            {cityName || <span className="text-muted-foreground">—</span>}
          </span>
        )
      ) : null}
      {cols.nation ? (
        <span className="flex min-w-0 flex-1 justify-center">
          {nation ? (
            <NationPill nation={nation} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ) : null}
    </div>
  );
}

function NationPill({ nation }: { nation: Nation }) {
  return (
    <span
      className="inline-flex h-6 max-w-full items-center truncate rounded-md px-1.5 font-mono text-[11px]"
      style={{
        background: nation.color_hex,
        color: readableOnHex(nation.color_hex),
      }}
    >
      {nation.name}
    </span>
  );
}

/** City rendered as a nation-colored pill — used once the standalone Nation
 *  column is dropped. Falls back to plain text when the citizen has no
 *  nation. */
function CityPill({
  cityName,
  nation,
}: {
  cityName: string;
  nation: Nation | null;
}) {
  if (!cityName) return <span className="text-muted-foreground">—</span>;
  if (!nation) return <span className="max-w-full truncate">{cityName}</span>;
  return (
    <span
      className="inline-flex h-6 max-w-full items-center truncate rounded-md px-1.5 font-mono text-[11px]"
      style={{
        background: nation.color_hex,
        color: readableOnHex(nation.color_hex),
      }}
    >
      {cityName}
    </span>
  );
}
