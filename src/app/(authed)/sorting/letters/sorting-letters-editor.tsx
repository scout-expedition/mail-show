"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { OverflowMenu, PanelHeader, Spinner } from "@/components/panel";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type {
  Citizen,
  City,
  Day,
  Nation,
  SortingLetterView,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import {
  attachConditions,
  contextFromLetter,
  dayNumbers,
  makeLookups,
  resolveDestination,
  type Destination,
} from "@/lib/rules/destination";
import { BulkBar } from "./bulk-bar";
import { DestinationCell } from "./destination-cell";
import { GenerateDialog } from "./generate-dialog";
import { LetterPanel } from "./letter-panel";
import { StampToggle } from "./stamp-toggle";
import { createSortingLetter, deleteSortingLetter } from "./actions";

const POSTGRES_TABLES = ["sorting_letters"];

/** Columns the table can be sorted by. */
type SortKey =
  | "content_id"
  | "day"
  | "recipient"
  | "sender"
  | "stamp"
  | "destination"
  | "storage";

type SortState = { key: SortKey; dir: "asc" | "desc" };

// ─── Public component: wraps inner in WorkspacePresenceProvider ──────────────

export function SortingLettersEditor({
  letters,
  days,
  rules,
  ruleConditions,
  citizens,
  cities,
  nations,
  initialSelectedId,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  letters: SortingLetterView[];
  days: Day[];
  rules: SortingRule[];
  ruleConditions: SortingRuleCondition[];
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  initialSelectedId: string | null;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="sorting-letters"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={POSTGRES_TABLES}
    >
      <SortingLettersWorkspace
        letters={letters}
        days={days}
        rules={rules}
        ruleConditions={ruleConditions}
        citizens={citizens}
        cities={cities}
        nations={nations}
        initialSelectedId={initialSelectedId}
      />
    </WorkspacePresenceProvider>
  );
}

// ─── Table + panel workspace ─────────────────────────────────────────────────

function SortingLettersWorkspace({
  letters: lettersProp,
  days,
  rules,
  ruleConditions,
  citizens,
  cities,
  nations,
  initialSelectedId,
}: {
  letters: SortingLetterView[];
  days: Day[];
  rules: SortingRule[];
  ruleConditions: SortingRuleCondition[];
  citizens: Citizen[];
  cities: City[];
  nations: Nation[];
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { onPostgresChanges } = usePresenceContext();
  const { toast, toaster } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Mirror the server array so postgres_changes can fan out without a reload.
  const [letters, setLetters] = useState(lettersProp);
  const [prevLettersProp, setPrevLettersProp] = useState(lettersProp);
  if (lettersProp !== prevLettersProp) {
    setPrevLettersProp(lettersProp);
    setLetters(lettersProp);
  }

  const [filterDayId, setFilterDayId] = useState<string>("");
  const [sort, setSort] = useState<SortState>({ key: "content_id", dir: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const selected = letters.find((l) => l.id === selectedId) ?? null;

  // Keep ?letter=<id> in sync with the selection. A stale id (deleted letter,
  // old link) simply drops the param rather than 404ing.
  useEffect(() => {
    const target = selected
      ? `${pathname}?letter=${encodeURIComponent(selected.id)}`
      : pathname;
    router.replace(target, { scroll: false });
  }, [selected, pathname, router]);

  // Debounced refresh for what the client can't recompute: `content_id` and
  // `day_number` come from the view, so a day / sort_id move needs the server.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      startTransition(() => router.refresh());
    }, 100);
  }, [router]);

  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      const { table, eventType } = change;
      if (table !== "sorting_letters") return;

      if (eventType === "UPDATE") {
        const newRow = change.new as Record<string, unknown>;
        const oldRow = change.old as Record<string, unknown> | undefined;
        const id = newRow.id as string | undefined;
        if (!id) return;
        setLetters((prev) =>
          prev.map((r) =>
            r.id === id ? ({ ...r, ...newRow } as unknown as SortingLetterView) : r
          )
        );
        // day_id / sort_id feed the view-derived content_id — only the server
        // can recompute those.
        if (
          oldRow &&
          (oldRow.day_id !== newRow.day_id || oldRow.sort_id !== newRow.sort_id)
        ) {
          scheduleRefresh();
        }
        return;
      }

      if (eventType === "DELETE") {
        const oldRow = change.old as Record<string, unknown> | undefined;
        const id = oldRow?.id as string | undefined;
        if (!id) return;
        setLetters((prev) => prev.filter((r) => r.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        const by = (oldRow?.updated_by as string | undefined) ?? "Someone";
        toast({ intent: "destructive", message: `${by} deleted a sorting letter` });
        return;
      }

      if (eventType === "INSERT") scheduleRefresh();
    });
  }, [onPostgresChanges, toast, scheduleRefresh]);

  // ── destinations ─────────────────────────────────────────────────────────
  // One resolver pass over the letters, rebuilt when the rules or the
  // directory change rather than on every render.
  const rulesWithConditions = useMemo(
    () => attachConditions(rules, ruleConditions),
    [rules, ruleConditions]
  );
  const lookups = useMemo(
    () => makeLookups(citizens, cities, nations),
    [citizens, cities, nations]
  );
  const dayNumberById = useMemo(() => dayNumbers(days), [days]);
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const destinations = useMemo(() => {
    const map = new Map<string, Destination>();
    for (const letter of letters) {
      const day = dayById.get(letter.day_id);
      const ctx = contextFromLetter(letter, lookups, day?.day_of_week ?? null);
      map.set(
        letter.id,
        resolveDestination(
          rulesWithConditions,
          ctx,
          dayNumberById,
          day?.number ?? letter.day_number
        )
      );
    }
    return map;
  }, [letters, lookups, rulesWithConditions, dayNumberById, dayById]);

  // ── filter + sort ────────────────────────────────────────────────────────
  const view = useMemo(() => {
    const filtered = filterDayId
      ? letters.filter((l) => l.day_id === filterDayId)
      : letters;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => factor * compareBy(sort.key, a, b, destinations, dayById)
    );
  }, [letters, filterDayId, sort, destinations, dayById]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  // ── bulk selection ───────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // Letters can vanish under a selection (a peer deletes one, the day filter
  // changes) — only ever act on ones still on screen.
  const checkedLetters = view.filter((l) => checkedIds.has(l.id));
  const allChecked = view.length > 0 && checkedLetters.length === view.length;

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setCheckedIds(allChecked ? new Set() : new Set(view.map((l) => l.id)));
  }

  function leaveSelectMode() {
    setSelectMode(false);
    setCheckedIds(new Set());
  }

  // ── create / generate / delete ───────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [creating, startCreate] = useTransition();
  function handleCreate() {
    startCreate(async () => {
      try {
        const { id } = await createSortingLetter({ dayId: filterDayId || null });
        setSelectedId(id);
      } catch (err) {
        toast({
          intent: "destructive",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async function handleDelete(letter: SortingLetterView) {
    const ok = await confirm({
      title: "Delete sorting letter?",
      message: `${letter.content_id} will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    try {
      await deleteSortingLetter(letter.id);
      setSelectedId((cur) => (cur === letter.id ? null : cur));
    } catch (err) {
      toast({
        intent: "destructive",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <>
      {toaster}
      {confirmDialog}
      {generating ? (
        <GenerateDialog
          days={days}
          rules={rulesWithConditions}
          defaultDayId={filterDayId}
          onClose={() => setGenerating(false)}
          onDone={({ created, requested, reason }) => {
            scheduleRefresh();
            if (created === 0) {
              toast({
                intent: "destructive",
                message: reason ?? "No letters could be generated.",
              });
            } else if (created < requested) {
              toast({
                intent: "destructive",
                message: `Generated ${created} of ${requested}. ${reason ?? ""}`.trim(),
              });
            } else {
              toast({ message: `Generated ${created} sorting letters.` });
            }
          }}
        />
      ) : null}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <PanelHeader
              title="Sorting Letters"
              menu={
                <span className="flex items-center gap-2">
                  <Label className="!text-xs">Day</Label>
                  <Select
                    value={filterDayId}
                    onChange={(e) => setFilterDayId(e.target.value)}
                    className="h-7 w-auto"
                    aria-label="Filter by day"
                  >
                    <option value="">All days</option>
                    {days.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.identifier}
                        {d.name ? ` — ${d.name}` : ""}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}
                    aria-pressed={selectMode}
                    className={cn(
                      "inline-flex h-6 items-center rounded-md px-2 font-mono text-[10px] uppercase tracking-widest transition-colors",
                      selectMode
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerating(true)}
                    disabled={days.length === 0}
                    aria-label="Generate sorting letters"
                    title="Generate sorting letters"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || days.length === 0}
                    aria-label="Add sorting letter"
                    title="Add sorting letter"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? <Spinner /> : <Plus size={14} aria-hidden />}
                  </button>
                </span>
              }
            />

            {selectMode && checkedLetters.length > 0 ? (
              <BulkBar
                selected={checkedLetters}
                days={days}
                citizens={citizens}
                rules={rulesWithConditions}
                onDone={() => {
                  setCheckedIds(new Set());
                  scheduleRefresh();
                }}
                onClearSelection={() => setCheckedIds(new Set())}
                onConfirm={confirm}
                onError={(m) => toast({ intent: "destructive", message: m })}
                onMessage={(m) => toast({ message: m })}
              />
            ) : null}

            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  {selectMode ? (
                    <th scope="col" className="w-[36px] px-3">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        aria-label="Select all letters"
                        className="h-3.5 w-3.5"
                      />
                    </th>
                  ) : null}
                  <SortableHeader
                    label="ID"
                    sortKey="content_id"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-[90px]"
                  />
                  <SortableHeader
                    label="Day"
                    sortKey="day"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-[70px]"
                  />
                  <SortableHeader
                    label="Recipient"
                    sortKey="recipient"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Sender"
                    sortKey="sender"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Stamp"
                    sortKey="stamp"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-[80px]"
                  />
                  <SortableHeader
                    label="Sorts to"
                    sortKey="destination"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-[120px]"
                  />
                  <SortableHeader
                    label="Storage"
                    sortKey="storage"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-[120px]"
                  />
                  <th className="w-[36px]" />
                </tr>
              </thead>
              <tbody>
                {view.map((letter) => (
                  <LetterRow
                    key={letter.id}
                    letter={letter}
                    day={dayById.get(letter.day_id) ?? null}
                    destination={destinations.get(letter.id) ?? { status: "none" }}
                    selected={letter.id === selectedId}
                    selectMode={selectMode}
                    checked={checkedIds.has(letter.id)}
                    onCheck={() => toggleChecked(letter.id)}
                    onSelect={() => setSelectedId(letter.id)}
                    onDelete={() => handleDelete(letter)}
                    onError={(m) => toast({ intent: "destructive", message: m })}
                  />
                ))}
              </tbody>
            </table>

            {view.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No sorting letters{filterDayId ? " for that day" : ""} yet.
              </p>
            ) : null}
          </div>
        </div>

        {selected ? (
          <aside className="w-[560px] shrink-0">
            <LetterPanel
              key={selected.id}
              letter={selected}
              days={days}
              citizens={citizens}
              cities={cities}
              nations={nations}
              destination={destinations.get(selected.id) ?? { status: "none" }}
              onDelete={() => handleDelete(selected)}
            />
          </aside>
        ) : null}
      </div>
    </>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function LetterRow({
  letter,
  day,
  destination,
  selected,
  selectMode,
  checked,
  onCheck,
  onSelect,
  onDelete,
  onError,
}: {
  letter: SortingLetterView;
  day: Day | null;
  destination: Destination;
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  onCheck: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  return (
    <tr
      // In select mode the row click ticks the box instead of opening the
      // panel — otherwise every attempt to build a selection swaps the editor.
      onClick={selectMode ? onCheck : onSelect}
      aria-current={selected || undefined}
      className={cn(
        "cursor-pointer border-t border-border/60 hover:bg-muted/30 [&>td]:px-3 [&>td]:py-1.5",
        selected && !selectMode && "bg-accent/40",
        selectMode && checked && "bg-accent/30"
      )}
    >
      {selectMode ? (
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            aria-label={`Select ${letter.content_id}`}
            className="h-3.5 w-3.5"
          />
        </td>
      ) : null}
      <td>
        <Badge variant="secondary" className="font-mono">
          {letter.content_id}
        </Badge>
      </td>
      <td className="font-mono text-xs text-muted-foreground">
        {day?.identifier ?? "—"}
      </td>
      <td className="truncate">
        {letter.recipient_name ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="truncate">
        {letter.sender_name ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <StampToggle
          letterId={letter.id}
          value={letter.stamp_valid}
          onError={onError}
        />
      </td>
      <td>
        <DestinationCell destination={destination} />
      </td>
      <td className="truncate font-mono text-xs text-muted-foreground">
        {letter.storage_location ?? "—"}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <OverflowMenu
          items={[
            {
              label: "Edit letter",
              icon: <Pencil size={12} aria-hidden />,
              onClick: onSelect,
            },
            { divider: true },
            {
              label: "Delete letter",
              intent: "destructive",
              icon: <Trash2 size={12} aria-hidden />,
              onClick: onDelete,
            },
          ]}
        />
      </td>
    </tr>
  );
}

// ─── Sortable column header ──────────────────────────────────────────────────

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-8 px-3 text-left", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp size={11} aria-hidden />
          ) : (
            <ChevronDown size={11} aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** Rank for the destination column: slot number first, then Reporting, then
 *  the unresolved states. Sorts like with like instead of by rendered text. */
function destinationRank(d: Destination): number {
  if (d.status === "resolved") {
    if (d.routesToReporting) return 100;
    return d.slot ?? 99;
  }
  if (d.status === "unassigned") return 200;
  if (d.status === "conflict") return 300;
  return 400;
}

function text(v: string | null | undefined): string {
  return (v ?? "").toLowerCase();
}

function compareBy(
  key: SortKey,
  a: SortingLetterView,
  b: SortingLetterView,
  destinations: Map<string, Destination>,
  dayById: Map<string, Day>
): number {
  switch (key) {
    case "content_id":
      // Day first, then position within the day — the reading order the ID
      // itself encodes.
      return a.day_number - b.day_number || a.sort_id - b.sort_id;
    case "day": {
      const dayA = dayById.get(a.day_id)?.number ?? a.day_number;
      const dayB = dayById.get(b.day_id)?.number ?? b.day_number;
      return dayA - dayB || a.sort_id - b.sort_id;
    }
    case "recipient":
      return text(a.recipient_name).localeCompare(text(b.recipient_name));
    case "sender":
      return text(a.sender_name).localeCompare(text(b.sender_name));
    case "stamp":
      return Number(a.stamp_valid) - Number(b.stamp_valid);
    case "destination": {
      const rankA = destinationRank(destinations.get(a.id) ?? { status: "none" });
      const rankB = destinationRank(destinations.get(b.id) ?? { status: "none" });
      return rankA - rankB;
    }
    case "storage":
      return text(a.storage_location).localeCompare(text(b.storage_location));
  }
}
