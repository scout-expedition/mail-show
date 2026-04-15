"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { IconDisplay } from "@/components/icon-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Day, LetterGroup, Storyline } from "@/lib/db/types";
import { createLetterGroup } from "../storylines/actions";

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

export function InspectionLettersList({
  storylines,
  groups,
  days,
}: {
  storylines: Storyline[];
  groups: LetterGroup[];
  days: Day[];
}) {
  const [storylineId, setStorylineId] = useState<string>("");
  const [dayId, setDayId] = useState<string>("");
  const [creatingFor, setCreatingFor] = useState<string>("");
  const [pending, startTransition] = useTransition();

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

  const view = useMemo(() => {
    let list = groups.slice();
    if (storylineId) list = list.filter((g) => g.storyline_id === storylineId);
    if (dayId) list = list.filter((g) => g.delivery_day_id === dayId);
    list.sort((a, b) => {
      const sa = storylineById.get(a.storyline_id);
      const sb = storylineById.get(b.storyline_id);
      const byStory = (sa?.sort_order ?? 0) - (sb?.sort_order ?? 0);
      if (byStory !== 0) return byStory;
      return a.sequence - b.sequence;
    });
    return list;
  }, [groups, storylineId, dayId, storylineById]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Label className="!text-xs">Storyline</Label>
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

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[44px_80px_1fr_110px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <Label>Group</Label>
          <Label>Name</Label>
          <Label>Day</Label>
        </div>
        {view.map((g) => {
          const s = storylineById.get(g.storyline_id);
          const d = g.delivery_day_id ? dayById.get(g.delivery_day_id) : null;
          return (
            <Link
              key={g.id}
              href={`/inspection/letters/${g.id}`}
              className="grid grid-cols-[44px_80px_1fr_110px] items-center gap-2 border-t border-border px-3 py-2 text-sm hover:bg-accent/40 first:border-t-0"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded"
                style={{
                  background: s?.color_hex ?? "var(--muted)",
                  color: s ? readableOn(s.color_hex) : undefined,
                }}
                title={s?.name}
              >
                {s?.icon_value ? (
                  <IconDisplay
                    type={s.icon_type}
                    value={s.icon_value}
                    size={14}
                  />
                ) : null}
              </span>
              <Badge variant="secondary" className="font-mono">
                {s?.abbreviation ?? "?"}
                {g.sequence}
              </Badge>
              <span className="truncate">{g.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {d?.identifier ?? "—"}
              </span>
            </Link>
          );
        })}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
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

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
