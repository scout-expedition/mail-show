"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconPicker } from "@/components/icon-picker";
import { IconDisplay } from "@/components/icon-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IconType } from "@/lib/db/enums";
import type { ActionTemplate } from "@/lib/db/types";
import { deleteActionTemplate, updateAllActionTemplates } from "./actions";

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
  icon_type: IconType;
  icon_value: string | null;
  color_hex: string;
};

export function ActionTemplatesEditor({
  templates,
}: {
  templates: ActionTemplate[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() =>
    templates.map((t) => ({
      id: t.id,
      name: t.name,
      icon_type: t.icon_type,
      icon_value: t.icon_value,
      color_hex: t.color_hex,
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(templates.map((t) => t.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: RowState[] = [];
      for (const t of templates) {
        if (!prevById.has(t.id)) {
          additions.push({
            id: t.id,
            name: t.name,
            icon_type: t.icon_type,
            icon_value: t.icon_value,
            color_hex: t.color_hex,
          });
        }
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [templates]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllActionTemplates(fd);
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

      <form ref={formRef} className="flex flex-col gap-3">
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
              className={dragIndex === i ? "opacity-60" : undefined}
            >
              <div className="rounded-md border border-border bg-card p-3">
                <input type="hidden" name="ids" value={row.id} />
                <input type="hidden" name="icon_types" value={row.icon_type} />
                <input
                  type="hidden"
                  name="icon_values"
                  value={row.icon_value ?? ""}
                />
                <input type="hidden" name="colors" value={row.color_hex} />
                <input type="hidden" name="sort_orders" value={i} />

                <div className="flex items-stretch gap-3">
                  <DragHandle />
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expanded ? null : row.id)
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border"
                    style={{ background: row.color_hex, color: fg }}
                    title="Pick icon and color"
                    aria-label="Pick icon and color"
                  >
                    {row.icon_value ? (
                      <IconDisplay
                        type={row.icon_type}
                        value={row.icon_value}
                        size={18}
                      />
                    ) : (
                      <span className="font-mono text-[9px] opacity-70">
                        icon
                      </span>
                    )}
                  </button>
                  <Input
                    name="names"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    className="h-10 flex-1"
                    required
                  />
                  <DeleteX name={row.name} id={row.id} />
                </div>

                {expanded ? (
                  <div className="mt-3 border-t border-border pt-3">
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
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No action templates yet.
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
      className="flex h-10 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
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

function DeleteX({ name, id }: { name: string; id: string }) {
  return (
    <form action={deleteActionTemplate}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label="Delete action template"
        title="Delete"
        onClick={(e) => {
          if (!confirm(`Delete action template "${name}"? This cannot be undone.`))
            e.preventDefault();
        }}
        className="inline-flex h-10 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
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
    </form>
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
