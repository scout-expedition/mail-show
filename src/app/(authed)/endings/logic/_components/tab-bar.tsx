"use client";

// Flat presentational tab strip for the Logic page's three sub-tabs.
// Mirrors the styling of `components/ui/tabs` but without Link routing —
// the parent owns active state via `?tab=` and re-renders the active
// editor in place. Mirroring the inspection workspace's panel-slide
// would be wrong here: there's no horizontal narrative to preserve.

import { cn } from "@/lib/utils";

export type TabBarItem<TId extends string = string> = {
  id: TId;
  label: string;
};

export function LogicTabBar<TId extends string>({
  tabs,
  activeId,
  onSelect,
  className,
}: {
  tabs: readonly TabBarItem<TId>[];
  activeId: TId;
  onSelect: (id: TId) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-border font-mono text-sm uppercase tracking-wide",
        className
      )}
      role="tablist"
    >
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(t.id)}
            className={cn(
              "-mb-px inline-flex h-9 items-center border-b-2 px-3 transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-white/[0.04] hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
