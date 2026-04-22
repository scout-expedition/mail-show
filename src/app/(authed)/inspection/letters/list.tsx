"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { IconDisplay } from "@/components/icon-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  Day,
  InspectionLetterView,
  LetterGroup,
  Storyline,
} from "@/lib/db/types";
import { createLetterGroup } from "../storylines/actions";
import { reorderLetterGroups } from "./[groupId]/actions";

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

type GroupBy = "storyline" | "day";

export function InspectionLettersList({
  storylines,
  groups,
  days,
  letters,
}: {
  storylines: Storyline[];
  groups: LetterGroup[];
  days: Day[];
  letters: InspectionLetterView[];
}) {
  const [storylineId, setStorylineId] = useState<string>("");
  const [dayId, setDayId] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("storyline");
  const [creatingFor, setCreatingFor] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [reorderBuckets, setReorderBuckets] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{
    bucketKey: string;
    index: number;
  } | null>(null);
  const [override, setOverride] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    // Clear drag overrides when server data flips.
    setOverride(new Map());
  }, [groups]);

  function toggleBucket(id: string) {
    setOpenBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    const target = storylineId || creatingFor;
    if (!target) return;
    const fd = new FormData();
    fd.append("storyline_id", target);
    startTransition(async () => {
      await createLetterGroup(fd);
    });
  }

  const storylineById = useMemo(
    () => new Map(storylines.map((s) => [s.id, s])),
    [storylines]
  );
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const filteredGroups = useMemo(() => {
    let list = groups.slice();
    if (storylineId) list = list.filter((g) => g.storyline_id === storylineId);
    if (dayId) list = list.filter((g) => g.delivery_day_id === dayId);
    return list;
  }, [groups, storylineId, dayId]);

  // Build buckets: either by storyline or by day.
  const buckets = useMemo(() => {
    if (groupBy === "storyline") {
      const byId = new Map<string, LetterGroup[]>();
      for (const g of filteredGroups) {
        const arr = byId.get(g.storyline_id) ?? [];
        arr.push(g);
        byId.set(g.storyline_id, arr);
      }
      for (const [, arr] of byId) arr.sort((a, b) => a.sequence - b.sequence);
      return storylines
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .filter((s) => byId.has(s.id))
        .map((s) => ({
          key: s.id,
          label: s.name,
          color: s.color_hex,
          iconType: s.icon_type,
          iconValue: s.icon_value,
          abbreviation: s.abbreviation,
          groups: byId.get(s.id) ?? [],
        }));
    }
    // Group by delivery day (fallback bucket for groups without a day).
    const byId = new Map<string | null, LetterGroup[]>();
    for (const g of filteredGroups) {
      const k = g.delivery_day_id ?? null;
      const arr = byId.get(k) ?? [];
      arr.push(g);
      byId.set(k, arr);
    }
    for (const [, arr] of byId) {
      arr.sort((a, b) => {
        const sa = storylineById.get(a.storyline_id)?.sort_order ?? 0;
        const sb = storylineById.get(b.storyline_id)?.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return a.sequence - b.sequence;
      });
    }
    const sortedDayKeys = [...byId.keys()].sort((a, b) => {
      const da = a ? dayById.get(a)?.number ?? 9999 : 9999;
      const db = b ? dayById.get(b)?.number ?? 9999 : 9999;
      return da - db;
    });
    return sortedDayKeys.map((k) => {
      const d = k ? dayById.get(k) : null;
      return {
        key: k ?? "no-day",
        label: d ? `${d.identifier}${d.name ? ` — ${d.name}` : ""}` : "No day",
        color: "#2a2f3a",
        iconType: null as null,
        iconValue: null,
        abbreviation: d?.identifier ?? "?",
        groups: byId.get(k) ?? [],
      };
    });
  }, [groupBy, filteredGroups, storylines, dayById, storylineById]);

  const lettersByGroup = useMemo(() => {
    const m = new Map<string, InspectionLetterView[]>();
    for (const l of letters) {
      const arr = m.get(l.letter_group_id) ?? [];
      arr.push(l);
      m.set(l.letter_group_id, arr);
    }
    return m;
  }, [letters]);

  function displayedGroupsFor(
    bucketKey: string,
    bucketGroups: LetterGroup[]
  ): LetterGroup[] {
    const o = override.get(bucketKey);
    if (!o) return bucketGroups;
    const byId = new Map(bucketGroups.map((g) => [g.id, g]));
    return o.map((id) => byId.get(id)).filter(Boolean) as LetterGroup[];
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Label className="!text-xs">Group by</Label>
        <Select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          className="h-8 w-auto"
        >
          <option value="storyline">Storyline</option>
          <option value="day">Day</option>
        </Select>
        <Label className="ml-3 !text-xs">Storyline</Label>
        <Select
          value={storylineId}
          onChange={(e) => setStorylineId(e.target.value)}
          className="h-8 w-auto"
        >
          <option value="">All storylines</option>
          {storylines.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Label className="ml-3 !text-xs">Day</Label>
        <Select
          value={dayId}
          onChange={(e) => setDayId(e.target.value)}
          className="h-8 w-auto"
        >
          <option value="">All days</option>
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.identifier}
              {d.name ? ` — ${d.name}` : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        {buckets.map((b) => {
          const bucketGroups = displayedGroupsFor(b.key, b.groups);
          const open = openBuckets.has(b.key);
          // Reorder only makes sense when bucket is a storyline.
          const canReorder = groupBy === "storyline";
          const draggableBucket = canReorder && reorderBuckets.has(b.key);
          return (
            <div
              key={b.key}
              className="overflow-hidden rounded-md border border-border bg-accent/40"
            >
              <button
                type="button"
                onClick={() => toggleBucket(b.key)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/60"
                aria-expanded={open}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded"
                    style={{
                      background: b.color,
                      color: readableOn(b.color),
                    }}
                    title={b.abbreviation}
                  >
                    {b.iconValue && b.iconType ? (
                      <IconDisplay
                        type={b.iconType}
                        value={b.iconValue}
                        size={14}
                      />
                    ) : (
                      <span className="font-mono text-[10px]">
                        {b.abbreviation}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-sm">{b.label}</span>
                  <span className="text-xs text-muted-foreground">
                    ({bucketGroups.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {canReorder ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setReorderBuckets((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.key)) next.delete(b.key);
                          else next.add(b.key);
                          return next;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          setReorderBuckets((prev) => {
                            const next = new Set(prev);
                            if (next.has(b.key)) next.delete(b.key);
                            else next.add(b.key);
                            return next;
                          });
                        }
                      }}
                      title={
                        reorderBuckets.has(b.key)
                          ? "Done reordering"
                          : "Reorder groups"
                      }
                      aria-label="Reorder groups"
                      aria-pressed={reorderBuckets.has(b.key)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ReorderIcon active={reorderBuckets.has(b.key)} />
                    </span>
                  ) : null}
                  <span aria-hidden className={open ? "rotate-90" : ""}>
                    ›
                  </span>
                </div>
              </button>

              {open ? (
                <div className="flex flex-col bg-card">
                  {bucketGroups.map((g, i) => {
                    const groupOpen = openGroups.has(g.id);
                    const s = storylineById.get(g.storyline_id);
                    const d = g.delivery_day_id
                      ? dayById.get(g.delivery_day_id)
                      : null;
                    const ls = lettersByGroup.get(g.id) ?? [];
                    return (
                      <div
                        key={g.id}
                        draggable={draggableBucket}
                        onDragStart={() =>
                          setDragging({ bucketKey: b.key, index: i })
                        }
                        onDragOver={(e) => {
                          if (
                            !draggableBucket ||
                            !dragging ||
                            dragging.bucketKey !== b.key ||
                            dragging.index === i
                          )
                            return;
                          e.preventDefault();
                          const current =
                            override.get(b.key) ?? b.groups.map((x) => x.id);
                          const next = current.slice();
                          const [moved] = next.splice(dragging.index, 1);
                          next.splice(i, 0, moved);
                          setOverride(
                            new Map(override).set(b.key, next)
                          );
                          setDragging({ bucketKey: b.key, index: i });
                        }}
                        onDragEnd={() => {
                          const finalOrder = override.get(b.key);
                          setDragging(null);
                          if (!finalOrder) return;
                          startTransition(async () => {
                            await reorderLetterGroups(b.key, finalOrder);
                          });
                        }}
                        className={cn(
                          "border-t border-border first:border-t-0",
                          draggableBucket &&
                            "cursor-grab active:cursor-grabbing"
                        )}
                      >
                        <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30">
                          {draggableBucket ? (
                            <span
                              aria-hidden
                              className="text-muted-foreground"
                              title="Drag to reorder"
                            >
                              ⋮⋮
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleGroup(g.id)}
                            disabled={draggableBucket}
                            className="flex flex-1 items-center gap-2 text-left disabled:cursor-grab"
                            aria-expanded={groupOpen}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "text-xs text-muted-foreground",
                                groupOpen && "rotate-90"
                              )}
                            >
                              ›
                            </span>
                            <Badge variant="secondary" className="font-mono">
                              {(s?.abbreviation ?? "?") + g.sequence}
                            </Badge>
                            <span className="truncate text-sm">{g.name}</span>
                            <span className="ml-auto mr-2 font-mono text-xs text-muted-foreground">
                              {d?.identifier ?? "—"}
                            </span>
                          </button>
                          {!draggableBucket ? (
                            <Link
                              href={`/inspection/letters/${g.id}?letter=none`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label="Open letter group"
                              title="Open letter group"
                            >
                              <ArrowIcon />
                            </Link>
                          ) : null}
                        </div>
                        {groupOpen && !draggableBucket ? (
                          <div className="flex flex-col bg-background">
                            {ls.map((l) => (
                              <Link
                                key={l.id}
                                href={`/inspection/letters/${g.id}`}
                                className="flex items-center gap-2 border-t border-border px-3 py-1.5 pl-10 text-sm hover:bg-accent/40"
                              >
                                <Badge
                                  variant="secondary"
                                  className="font-mono"
                                >
                                  {l.content_id}
                                </Badge>
                                <span className="truncate">
                                  {l.summary || (
                                    <span className="italic text-muted-foreground">
                                      (no summary)
                                    </span>
                                  )}
                                </span>
                              </Link>
                            ))}
                            {ls.length === 0 ? (
                              <p className="border-t border-border px-3 py-2 pl-10 text-xs text-muted-foreground">
                                No letters in this group yet.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {bucketGroups.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      No letter groups here.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {buckets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No letter groups match the current filter.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        {storylineId ? null : (
          <Select
            value={creatingFor}
            onChange={(e) => setCreatingFor(e.target.value)}
            className="h-8 w-auto"
          >
            <option value="">Pick a storyline…</option>
            {storylines.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreate}
          disabled={pending || (!storylineId && !creatingFor)}
        >
          {pending ? (
            <>
              <Spinner />
              Creating…
            </>
          ) : (
            "+ Letter Group"
          )}
        </Button>
      </div>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function ReorderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={active ? "text-foreground" : undefined}
    >
      <path d="M7 4v16" />
      <path d="M4 7l3-3 3 3" />
      <path d="M17 4v16" />
      <path d="M14 17l3 3 3-3" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
