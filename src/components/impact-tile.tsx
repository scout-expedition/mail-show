"use client";

// Shared impact-tile inputs used by the inspection actions page and the
// endings preview pane. Mirrors the existing actions-page UI:
//   - `CounterInput` is the inner stepper (text input + ± buttons that
//     reveal on hover).
//   - `ImpactTile` is the labelled tile around it for class affinity,
//     world status, demerits — anything that uses an icon + label.
//   - `NationImpactTile` is the per-nation variant that styles the icon
//     with the nation's brand color.
//
// The actions workspace (`inspection/letters/workspace.tsx`) ships its
// own local copies of these for now to avoid a large mechanical edit.
// Folding both consumers onto this shared module is a low-risk
// followup.

import type { ReactNode } from "react";
import {
  IconCircleMinus,
  IconDiamond,
  IconHammer,
  IconWorldBolt,
} from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { IconDisplay } from "@/components/icon-display";
import type { Nation } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export function CounterInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="group flex flex-col items-center gap-0.5">
      <Input
        type="text"
        inputMode="numeric"
        value={value === 0 ? "" : String(value)}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          if (raw === "" || raw === "-") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        // Borderless / transparent in every state so the impact tile
        // reads as one unit — the only focus/presence indicator is the
        // ring drawn by the outer HighlightableImpactTile wrapper. The
        // base Input's focus ring is explicitly cancelled here.
        className={cn(
          "h-6 w-9 border-transparent bg-transparent px-1 text-center shadow-none",
          "placeholder:text-muted-foreground/70",
          "hover:bg-black/30",
          "focus-visible:border-transparent focus-visible:bg-transparent focus-visible:shadow-none focus-visible:ring-0"
        )}
      />
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          tabIndex={-1}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Decrease"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          tabIndex={-1}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ImpactTile({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onChange(0)}
        aria-label={`Reset ${label} to 0`}
        title={`${label} — click to reset`}
        className="flex h-6 items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {icon ?? <span className="text-[10px]">{label}</span>}
      </button>
      <CounterInput value={value} onChange={onChange} />
    </div>
  );
}

export function NationImpactTile({
  nation,
  value,
  onChange,
}: {
  nation: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1" title={nation.name}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onChange(0)}
        aria-label={`Reset ${nation.name} to 0`}
        title={`${nation.name} — click to reset`}
        className="flex h-6 w-6 items-center justify-center rounded-sm transition-opacity hover:opacity-80"
        style={{ color: nation.color_hex }}
      >
        {nation.icon_value ? (
          <IconDisplay
            type={nation.icon_type}
            value={nation.icon_value}
            size={14}
          />
        ) : (
          <span className="text-[10px] font-mono">
            {nation.abbreviation ?? nation.name.slice(0, 1)}
          </span>
        )}
      </button>
      <CounterInput value={value} onChange={onChange} />
    </div>
  );
}

/** Icon presets for the non-nation impact columns. */
export const IMPACT_TILE_PRESETS: Record<
  string,
  { label: string; icon: ReactNode } | undefined
> = {
  proletariat: {
    label: "Working",
    icon: <IconHammer size={14} aria-hidden className="text-amber-500" />,
  },
  gentry: {
    label: "Gentry",
    icon: <IconDiamond size={14} aria-hidden className="text-fuchsia-500" />,
  },
  demerits: {
    label: "Demerits",
    icon: <IconCircleMinus size={14} aria-hidden className="text-red-500" />,
  },
  world_status: {
    label: "World Status",
    icon: <IconWorldBolt size={14} aria-hidden className="text-cyan-400" />,
  },
};
