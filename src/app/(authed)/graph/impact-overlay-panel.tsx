"use client";

import { IconCirclePlusMinus, IconTagsFilled, IconTagsOff } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { IconDisplay } from "@/components/icon-display";
import { PanelHeader } from "@/components/panel";
import type { Nation } from "@/lib/db/types";
import type { IconType } from "@/lib/db/enums";
import {
  DEFAULT_IMPACT_FILTER,
  IMPACT_CLASSES,
  IMPACT_WORLD,
  NATION_IMPACT_KEYS,
  type ImpactFilter,
} from "@/lib/graph-overlay";

export function ImpactOverlayPanel({
  nations,
  filter,
  onFilterChange,
}: {
  nations: Nation[];
  filter: ImpactFilter;
  onFilterChange: (next: ImpactFilter | ((prev: ImpactFilter) => ImpactFilter)) => void;
}) {
  const nationsWithImpact = nations.filter(
    (n) => NATION_IMPACT_KEYS[n.name.toLowerCase()]
  );
  // Treat missing/legacy field as enabled.
  const masterOn = filter.masterEnabled !== false;

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
          <VisibilitySwitch
            checked={masterOn}
            onChange={(v) =>
              onFilterChange((prev) => ({ ...prev, masterEnabled: v }))
            }
          />
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

        <SectionBox
          label="Endings"
          visible={filter.showEndings}
          onVisibilityChange={(v) =>
            onFilterChange((prev) => ({ ...prev, showEndings: v }))
          }
        />

        <div className="flex justify-end pt-1">
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onFilterChange(DEFAULT_IMPACT_FILTER)}
          >
            Reset all
          </button>
        </div>
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
  return (
    <button
      type="button"
      onClick={() => onToggle(!item.checked)}
      className={cn(
        "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        item.checked
          ? "border-current"
          : "border-border text-muted-foreground"
      )}
      style={
        item.checked
          ? { color: item.color, background: `${item.color}18` }
          : undefined
      }
    >
      <IconDisplay type={item.iconType} value={item.iconValue} size={13} />
      {item.label}
    </button>
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
