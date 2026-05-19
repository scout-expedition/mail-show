"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Building2, Globe, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { NationPill } from "@/components/pills";
import { IconDisplay } from "@/components/icon-display";
import { IconPickerDialog } from "@/components/icon-picker-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";
import type { City, Nation } from "@/lib/db/types";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import { normalizeHex } from "@/lib/color";
import { deleteNation, patchNation } from "./actions";

// normalizeHex is in src/lib/color.ts — readableOnHex is in pills.tsx but we
// need it here for the live swatch preview. Re-export from color is cleaner,
// but that file only has normalizeHex. Inline it so we avoid reaching into
// pills internals.
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

const SPAN: Record<number, string> = {
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
};

export function NationInspector({
  nation,
  cities,
  otherNames,
  onDeleted,
}: {
  nation: Nation;
  cities: City[];
  /** Normalized names of every *other* nation — for duplicate detection. */
  otherNames: Set<string>;
  onDeleted: (id: string) => void;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const { confirm, dialog } = useConfirm();
  const [iconDialogOpen, setIconDialogOpen] = useState(false);

  const focusKey = (field: string): PresenceFocus => ({
    table: "nations",
    recordId: nation.id,
    field,
  });
  const onFocusChangeFor = (field: string) => (focused: boolean) =>
    setFocus(focused ? focusKey(field) : null);

  // --- Identity fields ---
  const nameField = useInstantField<string>({
    value: nation.name,
    onCommit: (v) => patchNation(nation.id, { name: v }),
    onFocusChange: onFocusChangeFor("name"),
    onActivity: pingActivity,
  });

  const abbreviationField = useInstantField<string>({
    value: nation.abbreviation ?? "",
    onCommit: (v) => patchNation(nation.id, { abbreviation: v.toUpperCase() || null }),
    onFocusChange: onFocusChangeFor("abbreviation"),
    onActivity: pingActivity,
  });

  const colorField = useInstantField<string>({
    value: nation.color_hex,
    onCommit: (v) => patchNation(nation.id, { color_hex: normalizeHex(v) }),
    onFocusChange: onFocusChangeFor("color_hex"),
    onActivity: pingActivity,
  });

  const iconTypeField = useInstantField<string>({
    value: nation.icon_type,
    onCommit: (v) => patchNation(nation.id, { icon_type: v as IconType }),
    onFocusChange: onFocusChangeFor("icon_type"),
    onActivity: pingActivity,
  });

  const iconValueField = useInstantField<string>({
    value: nation.icon_value ?? "",
    onCommit: (v) => patchNation(nation.id, { icon_value: v || null }),
    onFocusChange: onFocusChangeFor("icon_value"),
    onActivity: pingActivity,
  });

  const fields = [nameField, abbreviationField, colorField, iconTypeField, iconValueField];
  const dirty = fields.some((f) => f.status === "dirty" || f.status === "saving");

  // Validation — duplicate name check against other nations
  const liveNameKey = nameField.value.trim().toLowerCase();
  const isDuplicateName = !!liveNameKey && otherNames.has(liveNameKey);
  const isNameEmpty = !nameField.value.trim();

  const issues: string[] = [];
  if (isNameEmpty) issues.push("Name is required.");
  if (isDuplicateName) issues.push("Another nation already uses this name.");

  const errClass = (hasError: boolean) =>
    hasError ? "ring-1 ring-destructive" : "";

  // Cities belonging to this nation, sorted alphabetically by name.
  const nationCities = cities
    .filter((c) => c.nation_id === nation.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Live foreground for the color swatch — reads from in-progress value
  const liveFg = readableOn(colorField.value);

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete nation?",
      message: `"${nameField.value || "This nation"}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", nation.id);
    await deleteNation(fd);
    onDeleted(nation.id);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={nameField.value || "New nation"}
        icon={
          <Globe size={14} aria-hidden className="text-muted-foreground/70" />
        }
        dirty={dirty}
        showSaved={!dirty}
        menu={
          <OverflowMenu
            items={[
              {
                // FK from cities.nation_id blocks the delete; surface that
                // up front instead of failing the server action with a
                // database error toast.
                label: nationCities.length
                  ? `Delete nation (move ${nationCities.length} ${nationCities.length === 1 ? "city" : "cities"} first)`
                  : "Delete nation",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: handleDelete,
                disabled: nationCities.length > 0,
              },
            ]}
          />
        }
      />

      <div className="p-4">
        {issues.length > 0 ? (
          <ul className="mb-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {issues.map((msg) => (
              <li
                key={msg}
                className="flex items-center gap-1.5 text-xs text-destructive"
              >
                <AlertCircle size={12} aria-hidden className="shrink-0" />
                {msg}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Identity */}
        <div className="grid grid-cols-6 gap-3">
          {/* Name (col-span-4) */}
          <FieldCell label="Name" span={4}>
            <FieldHighlight peers={peers} focusKey={focusKey("name")}>
              <Input
                value={nameField.value}
                onChange={(e) => nameField.set(e.target.value)}
                onFocus={nameField.onFocus}
                onBlur={nameField.onBlur}
                className={cn(
                  "h-8",
                  GHOST_FIELD,
                  errClass(isNameEmpty || isDuplicateName)
                )}
              />
            </FieldHighlight>
          </FieldCell>

          {/* Abbreviation (col-span-2) */}
          <FieldCell label="Abbr" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("abbreviation")}>
              <Input
                value={abbreviationField.value}
                onChange={(e) =>
                  abbreviationField.set(e.target.value.toUpperCase().slice(0, 1))
                }
                onFocus={abbreviationField.onFocus}
                onBlur={abbreviationField.onBlur}
                maxLength={1}
                className={cn("h-8 text-center", GHOST_FIELD)}
              />
            </FieldHighlight>
          </FieldCell>

          {/* Color (col-span-3) */}
          <FieldCell label="Color" span={3}>
            <FieldHighlight peers={peers} focusKey={focusKey("color_hex")}>
              <div className="flex h-8 items-center gap-1.5">
                {/* Live swatch — foreground from in-progress value */}
                <span
                  className="h-6 w-6 shrink-0 rounded-md border border-border"
                  style={{
                    background: colorField.value,
                    color: liveFg,
                  }}
                  aria-hidden
                />
                <Input
                  value={colorField.value}
                  onChange={(e) => colorField.set(e.target.value)}
                  onFocus={colorField.onFocus}
                  onBlur={colorField.onBlur}
                  placeholder="#888888"
                  className={cn("h-8 font-mono", GHOST_FIELD)}
                />
              </div>
            </FieldHighlight>
          </FieldCell>

          {/* Icon (col-span-3) */}
          <FieldCell label="Icon" span={3}>
            <FieldHighlight peers={peers} focusKey={focusKey("icon_value")}>
              <div
                onFocus={iconValueField.onFocus}
                onBlur={iconValueField.onBlur}
              >
                <button
                  type="button"
                  onClick={() => setIconDialogOpen(true)}
                  className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-2 text-sm transition-colors hover:bg-accent/20"
                  aria-label="Edit icon"
                  title="Click to change icon"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: colorField.value,
                      color: liveFg,
                    }}
                  >
                    {iconValueField.value ? (
                      <IconDisplay
                        type={iconTypeField.value as IconType}
                        value={iconValueField.value}
                        size={14}
                      />
                    ) : (
                      <span className="font-mono text-[9px] opacity-70">ic</span>
                    )}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {iconValueField.value || "none"}
                  </span>
                </button>
              </div>
            </FieldHighlight>
          </FieldCell>
        </div>

        {/* Cities — section panel with full-width Link rows, matching the
            inspection-letter rows on a letter-group page. */}
        <div className="mt-6 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex h-10 items-center gap-2 border-b border-border bg-white/[0.04] px-3">
            <Building2
              size={14}
              aria-hidden
              className="text-muted-foreground/70"
            />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Cities
            </span>
          </div>
          {nationCities.length > 0 ? (
            nationCities.map((city) => (
              <Link
                key={city.id}
                href={`/cities?city=${encodeURIComponent(city.name?.trim() || city.id)}`}
                className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs transition-colors first:border-t-0 hover:bg-accent/15"
              >
                {/* Icon-only chip — nation color + icon, no city name inside. */}
                <NationPill nation={nation} iconOnly className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {city.name || (
                    <span className="italic text-muted-foreground">
                      Unnamed
                    </span>
                  )}
                </span>
                <span className="w-[80px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {city.code || <span className="opacity-50">—</span>}
                </span>
              </Link>
            ))
          ) : (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              None
            </p>
          )}
        </div>
      </div>

      {iconDialogOpen ? (
        <IconPickerDialog
          title="Edit icon"
          initialType={iconTypeField.value as IconType}
          initialValue={iconValueField.value || null}
          initialColor={colorField.value}
          onSave={(p) => {
            iconTypeField.set(p.type);
            iconValueField.set(p.value);
            colorField.set(p.color);
          }}
          onClose={() => setIconDialogOpen(false)}
        />
      ) : null}

      {dialog}
    </div>
  );
}

function FieldCell({
  label,
  span,
  children,
}: {
  label: string;
  span: 2 | 3 | 4 | 6;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", SPAN[span])}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}
