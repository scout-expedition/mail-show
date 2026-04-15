"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconPicker } from "@/components/icon-picker";
import { IconDisplay } from "@/components/icon-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IconType } from "@/lib/db/enums";
import type { Nation } from "@/lib/db/types";
import { deleteNation, updateAllNations } from "./actions";

/** White text unless the bg is very light, in which case fall back to near-black. */
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
  abbreviation: string | null;
  color_hex: string;
  icon_type: IconType;
  icon_value: string | null;
};

export function NationsEditor({ nations }: { nations: Nation[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() =>
    nations.map((n) => ({
      id: n.id,
      name: n.name,
      abbreviation: n.abbreviation,
      color_hex: n.color_hex,
      icon_type: n.icon_type,
      icon_value: n.icon_value,
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Reconcile server data: add new rows and drop deleted ones, preserving edits.
  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(nations.map((n) => n.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      const additions: RowState[] = [];
      for (const n of nations) {
        if (!prevById.has(n.id)) {
          additions.push({
            id: n.id,
            name: n.name,
            abbreviation: n.abbreviation,
            color_hex: n.color_hex,
            icon_type: n.icon_type,
            icon_value: n.icon_value,
          });
        }
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }, [nations]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllNations(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function handleDragStart(i: number) {
    setDragIndex(i);
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
  function handleDragEnd() {
    setDragIndex(null);
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
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        {rows.map((row, i) => (
          <div
            key={row.id}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={handleDragEnd}
            className={
              dragIndex === i
                ? "opacity-60"
                : undefined
            }
          >
            <NationRow
              row={row}
              expanded={expandedId === row.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === row.id ? null : row.id)
              }
              onChange={(patch) => updateRow(row.id, patch)}
              onDelete={() => {
                const fd = new FormData();
                fd.append("id", row.id);
                startTransition(async () => {
                  await deleteNation(fd);
                  setRows((prev) => prev.filter((r) => r.id !== row.id));
                });
              }}
              sortOrder={i}
            />
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No nations yet.
          </p>
        ) : null}
      </form>
    </>
  );
}

function NationRow({
  row,
  expanded,
  onToggleExpand,
  onChange,
  onDelete,
  sortOrder,
}: {
  row: RowState;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<RowState>) => void;
  onDelete: () => void;
  sortOrder: number;
}) {
  const fg = readableOn(row.color_hex);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <input type="hidden" name="ids" value={row.id} />
      <input type="hidden" name="icon_types" value={row.icon_type} />
      <input type="hidden" name="icon_values" value={row.icon_value ?? ""} />
      <input type="hidden" name="sort_orders" value={sortOrder} />
      <input type="hidden" name="colors" value={row.color_hex} />

      <div className="flex items-stretch gap-3">
        <DragHandle />

        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-md border border-border transition-transform hover:scale-[1.03]"
          title="Pick icon and color"
          style={{ background: row.color_hex, color: fg }}
          aria-label="Pick icon and color"
        >
          {row.icon_value ? (
            <IconDisplay
              type={row.icon_type}
              value={row.icon_value}
              size={24}
            />
          ) : (
            <span className="font-mono text-[10px] opacity-70">icon</span>
          )}
        </button>

        <div
          className="grid flex-1 grid-cols-12 gap-2"
          onDragStart={(e) => e.stopPropagation()}
        >
          <div className="col-span-8 flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              name="names"
              defaultValue={row.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="h-8"
              required
            />
          </div>
          <div className="col-span-3 flex flex-col gap-1">
            <Label>Abbr</Label>
            <Input
              name="abbreviations"
              defaultValue={row.abbreviation ?? ""}
              onChange={(e) => onChange({ abbreviation: e.target.value })}
              maxLength={1}
              className="h-8"
            />
          </div>
          <div className="col-span-1 flex items-end justify-end">
            <DeleteX name={row.name} onDelete={onDelete} />
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          <IconPicker
            initialType={row.icon_type}
            initialValue={row.icon_value}
            emitHiddenFields={false}
            onChange={(next) =>
              onChange({ icon_type: next.type, icon_value: next.value })
            }
            color={row.color_hex}
            onColorChange={(c) => onChange({ color_hex: c })}
          />
        </div>
      ) : null}
    </div>
  );
}

function DragHandle() {
  return (
    <span
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="flex h-[56px] w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
    >
      <svg
        width="10"
        height="16"
        viewBox="0 0 10 16"
        fill="currentColor"
        aria-hidden
      >
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
      aria-label="Delete nation"
      title="Delete"
      onClick={() => {
        if (!confirm(`Delete nation "${name}"? This cannot be undone.`)) return;
        onDelete();
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
    >
      <svg
        width="14"
        height="14"
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
