"use client";

import { useMemo, useState, useEffect, type ComponentType } from "react";
import * as LucideModule from "lucide-react";
import * as TablerModule from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";

const LUCIDE_NAMES = Object.keys(LucideModule).filter(
  (k) =>
    /^[A-Z]/.test(k) &&
    !k.endsWith("Icon") &&
    typeof (LucideModule as Record<string, unknown>)[k] === "object" ||
    typeof (LucideModule as Record<string, unknown>)[k] === "function"
);

const TABLER_NAMES = Object.keys(TablerModule).filter(
  (k) => k.startsWith("Icon") && k !== "IconProps"
);

const MAX_RESULTS = 240;
const TYPES: { id: IconType; label: string }[] = [
  { id: "lucide", label: "Lucide" },
  { id: "tabler", label: "Tabler" },
  { id: "emoji", label: "Emoji" },
  { id: "svg", label: "SVG" },
];

/**
 * Icon picker with tabs for Lucide, Tabler, emoji text, and custom SVG.
 * Emits changes via hidden inputs (icon_type + icon_value) so it plugs into
 * existing server actions.
 */
export function IconPicker({
  initialType,
  initialValue,
  namePrefix = "",
  emitHiddenFields = true,
  onChange,
  color,
  onColorChange,
}: {
  initialType: IconType;
  initialValue: string | null;
  /** Prefix for the hidden field names, e.g. "icon_" gives icon_type/icon_value. */
  namePrefix?: string;
  /** When false the component does not emit its own hidden inputs. */
  emitHiddenFields?: boolean;
  /** Fires on every change; useful when the caller needs to write state elsewhere. */
  onChange?: (next: { type: IconType; value: string }) => void;
  /** Optional color to render alongside the picker (used by entities that pair icon + color). */
  color?: string;
  onColorChange?: (next: string) => void;
}) {
  const [type, setTypeState] = useState<IconType>(initialType);
  const [value, setValueState] = useState<string>(initialValue ?? "");

  const setType = (t: IconType) => {
    setTypeState(t);
    onChange?.({ type: t, value });
  };
  const setValue = (v: string) => {
    setValueState(v);
    onChange?.({ type, value: v });
  };

  const typeField = `${namePrefix}icon_type`;
  const valueField = `${namePrefix}icon_value`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 border-b border-border">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setType(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors",
              type === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <IconPreview type={type} value={value} />
        <div className="flex-1 text-xs text-muted-foreground">
          {type === "emoji"
            ? "Paste or type any emoji."
            : type === "svg"
              ? "Paste raw <svg>…</svg> markup."
              : "Search and click an icon."}
        </div>
        {onColorChange ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Color
            <input
              type="color"
              value={color ?? "#888888"}
              onChange={(e) => onColorChange(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
            />
          </label>
        ) : null}
      </div>

      {type === "lucide" ? (
        <IconGrid
          names={LUCIDE_NAMES}
          module={LucideModule as unknown as Record<string, ComponentType<{ size?: number }>>}
          selected={value}
          onSelect={setValue}
        />
      ) : type === "tabler" ? (
        <IconGrid
          names={TABLER_NAMES}
          module={TablerModule as unknown as Record<string, ComponentType<{ size?: number }>>}
          selected={value}
          onSelect={setValue}
        />
      ) : type === "emoji" ? (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="🚩"
          className="max-w-xs"
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder="<svg viewBox='0 0 24 24'>…</svg>"
          className="font-mono text-xs"
        />
      )}

      {emitHiddenFields ? (
        <>
          <input type="hidden" name={typeField} value={type} />
          <input type="hidden" name={valueField} value={value} />
        </>
      ) : null}
    </div>
  );
}

function IconGrid({
  names,
  module,
  selected,
  onSelect,
}: {
  names: string[];
  module: Record<string, ComponentType<{ size?: number }>>;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const list = q
      ? names.filter((n) => n.toLowerCase().includes(q))
      : names;
    return list.slice(0, MAX_RESULTS);
  }, [debounced, names]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons…"
        className="max-w-xs"
      />
      <div
        className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
        role="listbox"
      >
        {filtered.map((name) => {
          const Icon = module[name];
          if (!Icon) return null;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              title={name}
              aria-selected={selected === name}
              className={cn(
                "flex h-9 items-center justify-center rounded hover:bg-accent",
                selected === name && "bg-accent ring-1 ring-primary"
              )}
            >
              <Icon size={18} />
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
            No matches.
          </p>
        ) : null}
      </div>
      {selected ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{selected}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onSelect("")}
          >
            clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function IconPreview({ type, value }: { type: IconType; value: string }) {
  let node: React.ReactNode = (
    <span className="text-muted-foreground">?</span>
  );
  if (!value) {
    node = <span className="text-muted-foreground">—</span>;
  } else if (type === "lucide") {
    const Icon = (LucideModule as unknown as Record<string, ComponentType<{ size?: number }>>)[
      value
    ];
    if (Icon) node = <Icon size={22} />;
  } else if (type === "tabler") {
    const Icon = (TablerModule as unknown as Record<string, ComponentType<{ size?: number }>>)[
      value
    ];
    if (Icon) node = <Icon size={22} />;
  } else if (type === "emoji") {
    node = <span className="text-xl">{value}</span>;
  } else if (type === "svg") {
    node = (
      <span
        className="inline-block [&_svg]:h-6 [&_svg]:w-6"
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card">
      {node}
    </div>
  );
}
