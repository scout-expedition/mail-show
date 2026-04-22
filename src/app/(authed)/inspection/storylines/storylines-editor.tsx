"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconPicker } from "@/components/icon-picker";
import { IconDisplay } from "@/components/icon-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";
import type { Storyline } from "@/lib/db/types";
import { deleteStoryline, updateAllStorylines } from "./actions";

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

type RowState = {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
};

export function StorylinesEditor({ storylines }: { storylines: Storyline[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() =>
    storylines.map((s) => ({
      id: s.id,
      name: s.name,
      abbreviation: s.abbreviation,
      description: s.description,
      icon_type: s.icon_type,
      icon_value: s.icon_value,
      color_hex: s.color_hex,
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(storylines.map((s) => s.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: RowState[] = [];
      for (const s of storylines) {
        if (!prevById.has(s.id)) {
          additions.push({
            id: s.id,
            name: s.name,
            abbreviation: s.abbreviation,
            description: s.description,
            icon_type: s.icon_type,
            icon_value: s.icon_value,
            color_hex: s.color_hex,
          });
        }
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [storylines]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllStorylines(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function handleDragOver(e: React.DragEvent, overIdx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIdx) return;
    setRows((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIdx, 0, moved);
      return next;
    });
    setDragIndex(overIdx);
    setDirty(true);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          onClick={save}
          variant={dirty ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty}
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
        className="overflow-hidden rounded-md border border-border bg-card"
      >
        <div className="grid grid-cols-[20px_32px_220px_60px_1fr_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <span />
          <Label>Name</Label>
          <Label>Abbr</Label>
          <Label>Description</Label>
          <span />
        </div>
        {rows.map((row, i) => {
          const fg = readableOn(row.color_hex);
          const expanded = expandedId === row.id;
          return (
            <div
              key={row.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                "border-t border-border first:border-t-0",
                dragIndex === i && "opacity-60"
              )}
            >
              <input type="hidden" name="ids" value={row.id} />
              <input type="hidden" name="icon_types" value={row.icon_type} />
              <input
                type="hidden"
                name="icon_values"
                value={row.icon_value ?? ""}
              />
              <input type="hidden" name="colors" value={row.color_hex} />
              <input type="hidden" name="sort_orders" value={i} />

              <div className="grid grid-cols-[20px_32px_220px_60px_1fr_36px] items-center gap-2 px-3 py-1">
                <DragHandle />
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border"
                  style={{ background: row.color_hex, color: fg }}
                  title="Icon and color"
                  aria-label="Edit icon and color"
                >
                  {row.icon_value ? (
                    <IconDisplay
                      type={row.icon_type}
                      value={row.icon_value}
                      size={14}
                    />
                  ) : (
                    <span className="font-mono text-[9px] opacity-70">ic</span>
                  )}
                </button>
                <Input
                  name="names"
                  value={row.name}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  className={cn(
                    "h-8",
                    !row.name.trim() && "ring-2 ring-destructive"
                  )}
                  required
                />
                <Input
                  name="abbreviations"
                  value={row.abbreviation}
                  onChange={(e) =>
                    updateRow(row.id, {
                      abbreviation: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, "")
                        .slice(0, 1),
                    })
                  }
                  maxLength={1}
                  className="h-8 text-center"
                />
                <Input
                  name="descriptions"
                  value={row.description ?? ""}
                  onChange={(e) =>
                    updateRow(row.id, { description: e.target.value || null })
                  }
                  className="h-8"
                />
                <DeleteX id={row.id} name={row.name} />
              </div>

              {expanded ? (
                <div className="border-t border-border bg-accent/10 px-3 py-3">
                  <IconPicker
                    initialType={row.icon_type}
                    initialValue={row.icon_value}
                    emitHiddenFields={false}
                    onChange={(next) =>
                      updateRow(row.id, {
                        icon_type: next.type,
                        icon_value: next.value,
                      })
                    }
                    color={row.color_hex}
                    onColorChange={(c) => updateRow(row.id, { color_hex: c })}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No storylines yet.
          </p>
        ) : null}
      </form>
    </>
  );
}

function DragHandle() {
  return (
    <span
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
        <circle cx="2" cy="3" r="1.2" />
        <circle cx="8" cy="3" r="1.2" />
        <circle cx="2" cy="8" r="1.2" />
        <circle cx="8" cy="8" r="1.2" />
        <circle cx="2" cy="13" r="1.2" />
        <circle cx="8" cy="13" r="1.2" />
      </svg>
    </span>
  );
}

function DeleteX({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Delete storyline"
      title="Delete"
      onClick={() => {
        if (!confirm(`Delete storyline "${name}"? This cannot be undone.`)) return;
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => deleteStoryline(fd));
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
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
      className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
