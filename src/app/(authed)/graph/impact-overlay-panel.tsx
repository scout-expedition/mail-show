"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconCirclePlusMinus,
  IconRestore,
  IconTagsFilled,
  IconTagsOff,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { IconDisplay } from "@/components/icon-display";
import { PanelHeader } from "@/components/panel";
import type { EndingVariable, Nation } from "@/lib/db/types";
import type { IconType } from "@/lib/db/enums";
import { paletteColor } from "@/lib/endings/color-palette";
import { filterVariables } from "@/components/variable-picker/variable-filter";
import { VariableOptionList } from "@/components/variable-picker/variable-option-list";
import {
  DEFAULT_IMPACT_FILTER,
  IMPACT_CLASSES,
  IMPACT_WORLD,
  NATION_IMPACT_KEYS,
  type FrameworkOption,
  type ImpactFilter,
} from "@/lib/graph-overlay";

export function ImpactOverlayPanel({
  nations,
  endingVariables,
  frameworkOptions,
  filter,
  onFilterChange,
}: {
  nations: Nation[];
  endingVariables: EndingVariable[];
  frameworkOptions: FrameworkOption[];
  filter: ImpactFilter;
  onFilterChange: (next: ImpactFilter | ((prev: ImpactFilter) => ImpactFilter)) => void;
}) {
  const nationsWithImpact = nations.filter(
    (n) => NATION_IMPACT_KEYS[n.name.toLowerCase()]
  );
  // Treat missing/legacy field as enabled.
  const masterOn = filter.masterEnabled !== false;
  // Persisted filters from before per-variable toggles have no `variables`
  // map; a missing map (and missing keys) means all-visible.
  const variableFilter = filter.variables ?? {};
  const orderedVariables = [...endingVariables].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  // Currently-shown variable ids, in sort order.
  const selectedVariableIds = orderedVariables
    .filter((ev) => variableFilter[ev.id] === true)
    .map((ev) => ev.id);

  // Apply an ending framework as a preset: turn the Variables section on and
  // show exactly the variables that framework's logic references. The empty
  // selection just drops the preset link — the shown variables are kept so
  // the user can keep hand-editing them.
  function applyFramework(frameworkId: string | null) {
    onFilterChange((prev) => {
      if (!frameworkId) {
        return { ...prev, endingFrameworkId: null };
      }
      const framework = frameworkOptions.find((f) => f.id === frameworkId);
      const refs = framework?.variableIds ?? [];
      return {
        ...prev,
        endingFrameworkId: frameworkId,
        showVariables: true,
        variables: Object.fromEntries(refs.map((id) => [id, true])),
      };
    });
  }

  // Manual add/remove of a variable. Clears `endingFrameworkId` — once the
  // shown set is hand-edited it no longer matches a framework preset, so the
  // dropdown reverts to its placeholder.
  function addVariable(id: string) {
    onFilterChange((prev) => ({
      ...prev,
      endingFrameworkId: null,
      variables: { ...(prev.variables ?? {}), [id]: true },
    }));
  }
  function removeVariable(id: string) {
    onFilterChange((prev) => {
      const next = { ...(prev.variables ?? {}) };
      delete next[id];
      return { ...prev, endingFrameworkId: null, variables: next };
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title="Impact Overlays"
        icon={
          <IconCirclePlusMinus
            size={14}
            aria-hidden
            className="text-muted-foreground/70"
          />
        }
        menu={
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Reset overlays"
              title="Reset overlays"
              onClick={() =>
                // Reset every overlay to its default, but leave the
                // Variables section's own on/off state where the user
                // had it — reset clears the shown variables, it doesn't
                // collapse the section.
                onFilterChange((prev) => ({
                  ...DEFAULT_IMPACT_FILTER,
                  showVariables: prev.showVariables,
                }))
              }
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <IconRestore size={13} aria-hidden />
            </button>
            <VisibilitySwitch
              checked={masterOn}
              onChange={(v) =>
                onFilterChange((prev) => ({ ...prev, masterEnabled: v }))
              }
            />
          </div>
        }
      />
      <div
        className={cn(
          "flex flex-col gap-2 p-3 transition-opacity",
          !masterOn && "pointer-events-none opacity-40"
        )}
      >
        <SectionBox
          label="Player"
          visible={filter.categories.world}
          onVisibilityChange={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              categories: { ...prev.categories, world: v },
            }))
          }
          onAll={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              world: Object.fromEntries(IMPACT_WORLD.map((w) => [w.id, v])),
            }))
          }
          allOn={IMPACT_WORLD.every((w) => filter.world[w.id])}
          allOff={IMPACT_WORLD.every((w) => !filter.world[w.id])}
        >
          <VariableGroup
            items={IMPACT_WORLD.map((w) => ({
              id: w.id,
              label: w.label,
              color: w.color,
              iconType: "tabler" as const,
              iconValue: w.iconValue,
              checked: filter.world[w.id] ?? false,
            }))}
            onToggle={(id, v) =>
              onFilterChange((prev) => ({
                ...prev,
                world: { ...prev.world, [id]: v },
              }))
            }
          />
        </SectionBox>

        <SectionBox
          label="Class Affinity"
          visible={filter.categories.class}
          onVisibilityChange={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              categories: { ...prev.categories, class: v },
            }))
          }
          onAll={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              classes: Object.fromEntries(IMPACT_CLASSES.map((c) => [c.id, v])),
            }))
          }
          allOn={IMPACT_CLASSES.every((c) => filter.classes[c.id])}
          allOff={IMPACT_CLASSES.every((c) => !filter.classes[c.id])}
        >
          <VariableGroup
            items={IMPACT_CLASSES.map((c) => ({
              id: c.id,
              label: c.label,
              color: c.color,
              iconType: "tabler" as const,
              iconValue: c.iconValue,
              checked: filter.classes[c.id] ?? false,
            }))}
            onToggle={(id, v) =>
              onFilterChange((prev) => ({
                ...prev,
                classes: { ...prev.classes, [id]: v },
              }))
            }
          />
        </SectionBox>

        <SectionBox
          label="Nation Affinity"
          visible={filter.categories.nation}
          onVisibilityChange={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              categories: { ...prev.categories, nation: v },
            }))
          }
          onAll={(v) =>
            onFilterChange((prev) => ({
              ...prev,
              nations: Object.fromEntries(
                nationsWithImpact.map((n) => [n.name.toLowerCase(), v])
              ),
            }))
          }
          allOn={nationsWithImpact.every((n) => filter.nations[n.name.toLowerCase()])}
          allOff={nationsWithImpact.every((n) => !filter.nations[n.name.toLowerCase()])}
        >
          <VariableGroup
            items={nationsWithImpact.map((n) => ({
              id: n.name.toLowerCase(),
              label: n.name,
              color: n.color_hex,
              iconType: n.icon_type,
              iconValue: n.icon_value,
              checked: filter.nations[n.name.toLowerCase()] ?? false,
            }))}
            onToggle={(id, v) =>
              onFilterChange((prev) => ({
                ...prev,
                nations: { ...prev.nations, [id]: v },
              }))
            }
          />
        </SectionBox>

        <div className="rounded-md border border-border bg-card">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Endings
            </span>
            <select
              aria-label="Show variables for an ending framework"
              value={filter.endingFrameworkId ?? ""}
              onChange={(e) => applyFramework(e.target.value || null)}
              className="h-6 max-w-[170px] rounded border border-border bg-black/30 px-1.5 text-[10px] text-foreground outline-none focus-visible:border-ring"
            >
              <option value="">No framework</option>
              {frameworkOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SectionBox
          label="Variables"
          visible={filter.showVariables}
          onVisibilityChange={(v) =>
            onFilterChange((prev) => ({ ...prev, showVariables: v }))
          }
          onAll={
            orderedVariables.length > 0
              ? (v) =>
                  onFilterChange((prev) => ({
                    ...prev,
                    endingFrameworkId: null,
                    variables: v
                      ? Object.fromEntries(
                          orderedVariables.map((ev) => [ev.id, true])
                        )
                      : {},
                  }))
              : undefined
          }
          allOn={
            orderedVariables.length > 0 &&
            orderedVariables.every((ev) => variableFilter[ev.id] === true)
          }
          allOff={selectedVariableIds.length === 0}
        >
          {orderedVariables.length > 0 ? (
            <VariableSearchAdd
              variables={orderedVariables}
              selectedIds={selectedVariableIds}
              onAdd={addVariable}
              onRemove={removeVariable}
            />
          ) : (
            <p className="text-[10px] text-muted-foreground">
              No ending variables yet.
            </p>
          )}
        </SectionBox>
      </div>
    </div>
  );
}

function SectionBox({
  label,
  visible,
  onVisibilityChange,
  onAll,
  allOn,
  allOff,
  children,
}: {
  label: string;
  visible: boolean;
  onVisibilityChange: (v: boolean) => void;
  onAll?: (v: boolean) => void;
  allOn?: boolean;
  allOff?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-md border border-border transition-colors", visible ? "bg-card" : "bg-black/30")}>
      <div className="flex items-center gap-1.5 px-3 py-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {onAll ? (
          <div
            className={cn(
              "flex items-center gap-1 transition-opacity",
              !visible && "pointer-events-none opacity-20"
            )}
          >
            <button
              type="button"
              title="All off"
              disabled={allOff}
              className={cn(
                "transition-opacity",
                allOff
                  ? "pointer-events-none opacity-20"
                  : "opacity-65 hover:opacity-100"
              )}
              onClick={() => onAll(false)}
            >
              <IconTagsOff size={13} />
            </button>
            <button
              type="button"
              title="All on"
              disabled={allOn}
              className={cn(
                "transition-opacity",
                allOn
                  ? "pointer-events-none opacity-20"
                  : "opacity-65 hover:opacity-100"
              )}
              onClick={() => onAll(true)}
            >
              <IconTagsFilled size={13} />
            </button>
          </div>
        ) : null}
        <VisibilitySwitch checked={visible} onChange={onVisibilityChange} />
      </div>
      {children ? (
        <div
          className={cn(
            "border-t border-border px-3 pb-3 pt-2 transition-opacity",
            !visible && "pointer-events-none opacity-40"
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

type VariableItem = {
  id: string;
  label: string;
  color: string;
  iconType: IconType;
  iconValue: string | null;
  checked: boolean;
};

function VariableGroup({
  items,
  onToggle,
}: {
  items: VariableItem[];
  onToggle: (id: string, v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <VariableToggle
          key={item.id}
          item={item}
          onToggle={(v) => onToggle(item.id, v)}
        />
      ))}
    </div>
  );
}

function VariableToggle({
  item,
  onToggle,
}: {
  item: VariableItem;
  onToggle: (v: boolean) => void;
}) {
  // Pill toggle — matches the endings logic preview toggles (rounded-full,
  // bordered, the variable color only tinting the border + icon when on).
  return (
    <button
      type="button"
      onClick={() => onToggle(!item.checked)}
      aria-pressed={item.checked}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
        item.checked
          ? "border-foreground/40 bg-foreground/10 text-foreground"
          : "border-border/40 bg-transparent text-muted-foreground/70 hover:text-foreground"
      )}
      style={item.checked ? { borderColor: item.color } : undefined}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center transition-opacity",
          item.checked ? "opacity-100" : "opacity-40"
        )}
        style={{ color: item.color }}
      >
        {item.iconValue ? (
          <IconDisplay type={item.iconType} value={item.iconValue} size={12} />
        ) : (
          // Ending variables carry no icon — show a color dot instead.
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
        )}
      </span>
      {item.label}
    </button>
  );
}

/**
 * Search-to-add variable picker for the Variables overlay section. Replaces
 * a flat pill grid (hard to parse with many variables): the user types to
 * find a variable and picks it; shown variables render as removable chips
 * above the input.
 */
function VariableSearchAdd({
  variables,
  selectedIds,
  onAdd,
  onRemove,
}: {
  variables: EndingVariable[];
  selectedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const byId = new Map(variables.map((v) => [v.id, v]));
  const selectedSet = new Set(selectedIds);
  const addable = variables.filter((v) => !selectedSet.has(v.id));
  const filtered = filterVariables(addable, query);
  const selectedVars = selectedIds
    .map((id) => byId.get(id))
    .filter((v): v is EndingVariable => !!v);

  // Outside-click closes the results list.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function commit(id: string) {
    onAdd(id);
    setQuery("");
    setActiveIndex(0);
    // Stay open so several variables can be added in a row.
  }

  return (
    <div className="flex flex-col gap-2">
      {selectedVars.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectedVars.map((v) => {
            const color = v.color_hex ?? paletteColor(v.color_index);
            return (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-foreground"
                style={{ borderColor: color }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="max-w-[120px] truncate">{v.name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(v.id)}
                  aria-label={`Hide ${v.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          No variables shown — search to add.
        </p>
      )}
      <div ref={wrapRef} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const v = filtered[activeIndex];
              if (v) commit(v.id);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search variables to add…"
          aria-label="Search variables to add"
          className="w-full rounded border border-border bg-black/30 px-2 py-1 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring"
        />
        {open && addable.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-auto rounded-md border border-border bg-popover shadow-lg">
            {filtered.length > 0 ? (
              <VariableOptionList
                filtered={filtered}
                activeIndex={activeIndex}
                onChangeActiveIndex={setActiveIndex}
                onCommit={(v) => commit(v.id)}
                ariaLabel="Add variable"
                className="w-full"
              />
            ) : (
              <p className="px-2 py-2 text-[10px] text-muted-foreground">
                No matching variables.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VisibilitySwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-foreground" : "bg-muted-foreground/40"
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-3.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
