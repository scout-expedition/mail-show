"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Nation } from "@/lib/db/types";
import {
  DEFAULT_IMPACT_FILTER,
  IMPACT_CLASSES,
  IMPACT_WORLD,
  NATION_IMPACT_KEYS,
  type ImpactCategory,
  type ImpactFilter,
} from "@/lib/graph-overlay";

export function ImpactOverlayControls({
  nations,
  filter,
  onFilterChange,
}: {
  nations: Nation[];
  filter: ImpactFilter;
  onFilterChange: (next: ImpactFilter | ((prev: ImpactFilter) => ImpactFilter)) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const nationsWithImpact = nations.filter(
    (n) => NATION_IMPACT_KEYS[n.name.toLowerCase()]
  );

  const anyActive =
    filter.showEndings ||
    (filter.showImpacts &&
      (Object.values(filter.categories).some(Boolean) ||
        Object.values(filter.classes).some(Boolean) ||
        Object.values(filter.nations).some(Boolean) ||
        Object.values(filter.world).some(Boolean)));

  return (
    <div ref={wrapRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span
          aria-hidden
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: anyActive ? "#22c55e" : "var(--border)",
          }}
        />
        Overlays
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-md border border-border bg-card p-3 shadow-lg">
          <ToggleRow
            label="Show ending assignments"
            checked={filter.showEndings}
            onChange={(v) =>
              onFilterChange((prev) => ({ ...prev, showEndings: v }))
            }
            bold
          />
          <div className="my-3 border-t border-border" />
          <ToggleRow
            label="Show impact variables"
            checked={filter.showImpacts}
            onChange={(v) =>
              onFilterChange((prev) => ({ ...prev, showImpacts: v }))
            }
            bold
          />
          <div
            className={
              filter.showImpacts
                ? "mt-3 flex flex-col gap-3"
                : "mt-3 flex flex-col gap-3 opacity-50 pointer-events-none"
            }
          >
            <CategoryBlock
              label="Class affinity"
              category="class"
              filter={filter}
              onFilterChange={onFilterChange}
            >
              {IMPACT_CLASSES.map((c) => (
                <ToggleRow
                  key={c.id}
                  label={c.label}
                  checked={filter.classes[c.id] ?? false}
                  onChange={(v) =>
                    onFilterChange((prev) => ({
                      ...prev,
                      classes: { ...prev.classes, [c.id]: v },
                    }))
                  }
                />
              ))}
            </CategoryBlock>

            <CategoryBlock
              label="Nation affinity"
              category="nation"
              filter={filter}
              onFilterChange={onFilterChange}
            >
              {nationsWithImpact.map((n) => {
                const id = n.name.toLowerCase();
                return (
                  <ToggleRow
                    key={n.id}
                    label={n.name}
                    swatch={n.color_hex}
                    checked={filter.nations[id] ?? false}
                    onChange={(v) =>
                      onFilterChange((prev) => ({
                        ...prev,
                        nations: { ...prev.nations, [id]: v },
                      }))
                    }
                  />
                );
              })}
            </CategoryBlock>

            <CategoryBlock
              label="World"
              category="world"
              filter={filter}
              onFilterChange={onFilterChange}
            >
              {IMPACT_WORLD.map((w) => (
                <ToggleRow
                  key={w.id}
                  label={w.label}
                  checked={filter.world[w.id] ?? false}
                  onChange={(v) =>
                    onFilterChange((prev) => ({
                      ...prev,
                      world: { ...prev.world, [w.id]: v },
                    }))
                  }
                />
              ))}
            </CategoryBlock>
          </div>

          <div className="mt-3 flex justify-end border-t border-border pt-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onFilterChange(DEFAULT_IMPACT_FILTER)}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CategoryBlock({
  label,
  category,
  filter,
  onFilterChange,
  children,
}: {
  label: string;
  category: ImpactCategory;
  filter: ImpactFilter;
  onFilterChange: (next: ImpactFilter | ((prev: ImpactFilter) => ImpactFilter)) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <ToggleRow
        label={label}
        checked={filter.categories[category]}
        onChange={(v) =>
          onFilterChange((prev) => ({
            ...prev,
            categories: { ...prev.categories, [category]: v },
          }))
        }
        bold
      />
      <div
        className={
          filter.categories[category]
            ? "ml-4 mt-1 flex flex-col"
            : "ml-4 mt-1 flex flex-col opacity-50 pointer-events-none"
        }
      >
        {children}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  bold,
  swatch,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  bold?: boolean;
  swatch?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-3.5 w-3.5 accent-foreground"
      />
      {swatch ? (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full border border-white/20"
          style={{ background: swatch }}
        />
      ) : null}
      <span className={bold ? "font-medium" : undefined}>{label}</span>
    </label>
  );
}
