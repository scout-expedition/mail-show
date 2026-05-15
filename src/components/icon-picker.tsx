"use client";

import { useMemo, useState, useEffect, type ComponentType } from "react";
import * as LucideModule from "lucide-react";
import * as TablerModule from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";
import { ANIMALS } from "@/lib/animals";
import { EMOJIS } from "@/lib/emojis";

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
  { id: "animal", label: "Animals" },
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
  const [perTypeValue, setPerTypeValue] = useState<Partial<Record<IconType, string>>>({
    [initialType]: initialValue ?? "",
  });
  // The last icon the user actually clicked — tab navigation alone doesn't change this.
  const [committed, setCommitted] = useState<{ type: IconType; value: string }>({
    type: initialType,
    value: initialValue ?? "",
  });

  const value = perTypeValue[type] ?? "";

  const setType = (t: IconType) => {
    setTypeState(t);
    // Don't update committed or call onChange — just navigate the tab.
  };
  const setValue = (v: string) => {
    setPerTypeValue((prev) => ({ ...prev, [type]: v }));
    const next = { type, value: v };
    setCommitted(next);
    onChange?.(next);
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
              "-mb-px border-b-2 px-2.5 py-1 font-mono !text-[9px] uppercase tracking-wide transition-colors",
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
        <IconPreview type={committed.type} value={committed.value} />
        <div className="flex-1 text-xs text-muted-foreground">
          {type === "emoji"
            ? "Search and click one emoji."
            : type === "svg"
              ? "Paste raw <svg>…</svg> markup."
              : type === "animal"
                ? "Search and click an animal."
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
      ) : type === "animal" ? (
        <AnimalGrid selected={value} onSelect={setValue} />
      ) : type === "emoji" ? (
        <EmojiGrid selected={value} onSelect={setValue} />
      ) : (
        <SvgInput value={value} onChange={setValue} />
      )}

      {emitHiddenFields ? (
        <>
          <input type="hidden" name={typeField} value={committed.type} />
          <input type="hidden" name={valueField} value={committed.value} />
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
        className="grid h-64 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
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

function EmojiGrid({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return EMOJIS;
    return EMOJIS.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.includes(q))
    );
  }, [debounced]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji…"
        className="max-w-xs"
      />
      <div
        className="grid h-64 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
        role="listbox"
      >
        {filtered.map((e) => (
          <button
            key={e.emoji}
            type="button"
            onClick={() => onSelect(e.emoji)}
            title={e.name}
            aria-selected={selected === e.emoji}
            className={cn(
              "flex h-9 items-center justify-center rounded text-xl hover:bg-accent",
              selected === e.emoji && "bg-accent ring-1 ring-primary"
            )}
          >
            {e.emoji}
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
            No matches.
          </p>
        ) : null}
      </div>
      {selected ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-xl">{selected}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSelect("")}>
            clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SvgInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [raw, setRaw] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (text: string) => {
    setRaw(text);
    if (!text.trim()) {
      setError(null);
      onChange(text);
      return;
    }
    try {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      if (doc.querySelector("parsererror")) {
        setError("Invalid XML — check your markup.");
        return;
      }
      if (doc.documentElement.tagName.toLowerCase() !== "svg") {
        setError("Root element must be <svg>.");
        return;
      }
      setError(null);
      onChange(text);
    } catch {
      setError("Invalid SVG.");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        placeholder="<svg viewBox='0 0 24 24'>…</svg>"
        className={cn("font-mono text-xs", error ? "border-destructive" : "")}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function AnimalGrid({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [browseVariant, setBrowseVariant] = useState<"outline" | "fill">("fill");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const [selectedSlug, selectedVariantRaw] = selected.split(":");
  const variant = selectedSlug
    ? selectedVariantRaw === "fill" ? "fill" : "outline"
    : browseVariant;

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return ANIMALS;
    return ANIMALS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.keywords.some((k) => k.includes(q))
    );
  }, [debounced]);

  const toggleVariant = (next: "outline" | "fill") => {
    if (selectedSlug) {
      onSelect(`${selectedSlug}:${next}`);
    } else {
      setBrowseVariant(next);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-border text-xs">
          {(["outline", "fill"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggleVariant(v)}
              className={cn(
                "px-3 py-1 capitalize transition-colors first:rounded-l-md last:rounded-r-md",
                variant === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search animals…"
          className="max-w-xs"
        />
      </div>
      <div
        className="grid h-64 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
        role="listbox"
      >
        {filtered.map((animal) => {
          const isSelected = selected === `${animal.slug}:${variant}`;
          return (
            <button
              key={animal.slug}
              type="button"
              onClick={() => onSelect(`${animal.slug}:${variant}`)}
              title={animal.name}
              aria-selected={isSelected}
              className={cn(
                "flex h-9 items-center justify-center rounded hover:bg-accent",
                isSelected && "bg-accent ring-1 ring-primary"
              )}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 18,
                  backgroundColor: "currentColor",
                  maskImage: `url(/animals/${variant}/${animal.slug}.svg)`,
                  WebkitMaskImage: `url(/animals/${variant}/${animal.slug}.svg)`,
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                  ...(variant === "outline"
                    ? { filter: "drop-shadow(0 0 0.75px currentColor)" }
                    : {}),
                }}
              />
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
            No matches.
          </p>
        ) : null}
      </div>
      {selectedSlug ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono capitalize">{selectedSlug}</span>
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
  } else if (type === "animal") {
    const [slug, rawVariant] = value.split(":");
    const variant = rawVariant === "fill" ? "fill" : "outline";
    if (slug)
      node = (
        <span
          style={{
            display: "inline-block",
            width: 22,
            height: 22,
            backgroundColor: "currentColor",
            maskImage: `url(/animals/${variant}/${slug}.svg)`,
            WebkitMaskImage: `url(/animals/${variant}/${slug}.svg)`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
            ...(variant === "outline"
              ? { filter: "drop-shadow(0 0 0.75px currentColor)" }
              : {}),
          }}
        />
      );
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
