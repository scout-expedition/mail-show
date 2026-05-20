"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Building2, Trash2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { NationPill } from "@/components/pills";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Citizen, City, Nation } from "@/lib/db/types";
import { citizenDisplayName, citizenSortKey } from "@/lib/citizen-name";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import { deleteCity, patchCity } from "./actions";

const SPAN: Record<number, string> = {
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  6: "col-span-6",
};

/** "ABC DEF" — 3 alnum + single space + 3 alnum, all uppercase. */
function formatCityCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}

const CITY_CODE_RE = /^[A-Z0-9]{3} [A-Z0-9]{3}$/;

export function CityInspector({
  city,
  nations,
  citizens,
  otherNames,
  onDeleted,
}: {
  city: City;
  nations: Nation[];
  citizens: Citizen[];
  /** Normalized city names of every other city — for duplicate detection. */
  otherNames: Set<string>;
  onDeleted: (id: string) => void;
}) {
  const { peers, setFocus, pingActivity } = usePresenceContext();
  const { confirm, dialog } = useConfirm();

  const focusKey = (field: string): PresenceFocus => ({
    table: "cities",
    recordId: city.id,
    field,
  });
  const onFocusChangeFor = (field: string) => (focused: boolean) =>
    setFocus(focused ? focusKey(field) : null);

  // --- Identity fields, each autosaves via patchCity. ---
  const nameField = useInstantField<string>({
    value: city.name,
    onCommit: (v) => patchCity(city.id, { name: v }),
    onFocusChange: onFocusChangeFor("name"),
    onActivity: pingActivity,
  });
  const codeField = useInstantField<string>({
    value: city.code,
    onCommit: (v) => patchCity(city.id, { code: v }),
    onFocusChange: onFocusChangeFor("code"),
    onActivity: pingActivity,
  });
  const nationIdField = useInstantField<string>({
    value: city.nation_id ?? "",
    onCommit: (v) => patchCity(city.id, { nation_id: v }),
    onFocusChange: onFocusChangeFor("nation_id"),
    onActivity: pingActivity,
  });

  const fields = [nameField, codeField, nationIdField];
  const dirty = fields.some(
    (f) => f.status === "dirty" || f.status === "saving"
  );

  const headerTitle = nameField.value.trim() || "New city";

  // Validation — duplicate name check is advisory (not a hard block).
  const liveNameKey = nameField.value.trim().toLowerCase();
  const hasDuplicateName = !!liveNameKey && otherNames.has(liveNameKey);

  // Code error: non-empty value that fails the format.
  const liveCode = codeField.value;
  const hasCodeError = !!liveCode.trim() && !CITY_CODE_RE.test(liveCode);

  const errClass = (field: "name" | "code") => {
    if (field === "name" && hasDuplicateName) return "ring-1 ring-destructive";
    if (field === "code" && hasCodeError) return "ring-1 ring-destructive";
    return "";
  };

  // Citizens belonging to this city, sorted by last name then first name.
  const cityCitizens = citizens
    .filter((c) => c.city_id === city.id)
    .sort((a, b) => citizenSortKey(a).localeCompare(citizenSortKey(b)));

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete city?",
      message: `"${headerTitle}" will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", city.id);
    await deleteCity(fd);
    onDeleted(city.id);
  }

  const issues: { message: string }[] = [];
  if (hasDuplicateName) {
    issues.push({ message: "Another city has this name" });
  }
  if (hasCodeError) {
    issues.push({
      message: "Code must be ABC DEF format (3 alphanumeric + space + 3 alphanumeric)",
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={headerTitle}
        icon={
          <Building2 size={14} aria-hidden className="text-muted-foreground/70" />
        }
        dirty={dirty}
        showSaved={!dirty}
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete city",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: handleDelete,
              },
            ]}
          />
        }
      />

      <div className="p-4">
        {issues.length > 0 ? (
          <ul className="mb-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {issues.map((issue) => (
              <li
                key={issue.message}
                className="flex items-center gap-1.5 text-xs text-destructive"
              >
                <AlertCircle size={12} aria-hidden className="shrink-0" />
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Identity */}
        <div className="grid grid-cols-6 gap-3">
          <FieldCell label="Name" span={4}>
            <FieldHighlight peers={peers} focusKey={focusKey("name")}>
              <Input
                value={nameField.value}
                onChange={(e) => nameField.set(e.target.value)}
                onFocus={nameField.onFocus}
                onBlur={nameField.onBlur}
                className={cn("h-8", GHOST_FIELD, errClass("name"))}
              />
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="Code" span={2}>
            <FieldHighlight peers={peers} focusKey={focusKey("code")}>
              <Input
                value={codeField.value}
                onChange={(e) => codeField.set(formatCityCode(e.target.value))}
                onFocus={codeField.onFocus}
                onBlur={codeField.onBlur}
                placeholder="ABC DEF"
                maxLength={7}
                className={cn(
                  "h-8 uppercase tracking-wider",
                  GHOST_FIELD,
                  errClass("code")
                )}
                aria-invalid={hasCodeError}
              />
            </FieldHighlight>
          </FieldCell>

          <FieldCell label="Nation" span={6}>
            <div className="flex items-center gap-2">
              {/* Visual chip-picker — same set + same value as the native
                  dropdown beside it. Two parallel controls so visual users
                  can click the colored chip and keyboard users keep the
                  native <select>. */}
              <NationChipPicker
                nations={nations}
                selectedId={nationIdField.value}
                onChange={(id) => nationIdField.set(id)}
              />
              <FieldHighlight
                peers={peers}
                focusKey={focusKey("nation_id")}
                className="min-w-0 flex-1"
              >
                <div
                  onFocus={nationIdField.onFocus}
                  onBlur={nationIdField.onBlur}
                >
                  <Select
                    value={nationIdField.value}
                    onChange={(e) => nationIdField.set(e.target.value)}
                    className={cn("h-8", GHOST_FIELD)}
                  >
                    <option value="">—</option>
                    {nations.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </FieldHighlight>
            </div>
          </FieldCell>
        </div>

        {/* Citizens — section panel with full-width Link rows, matching the
            inspection-letter rows on a letter-group page. */}
        <div className="mt-6 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex h-10 items-center gap-2 border-b border-border bg-white/[0.04] px-3">
            <Users
              size={14}
              aria-hidden
              className="text-muted-foreground/70"
            />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Citizens
            </span>
          </div>
          {cityCitizens.length > 0 ? (
            cityCitizens.map((c) => (
              <Link
                key={c.id}
                href={`/citizens?citizen=${encodeURIComponent(c.citizen_id?.replace(/^#/, "").trim() || c.id)}`}
                className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs transition-colors first:border-t-0 hover:bg-accent/15"
              >
                <span className="min-w-0 flex-1 truncate">
                  {citizenDisplayName(c) || (
                    <span className="text-muted-foreground italic">
                      Unnamed
                    </span>
                  )}
                </span>
                {c.citizen_id ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {c.citizen_id}
                  </span>
                ) : null}
              </Link>
            ))
          ) : (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              None
            </p>
          )}
        </div>
      </div>
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

/**
 * Chip-shaped nation picker. The trigger renders the current nation as a
 * filled NationPill (icon-only for compactness); clicking opens a small
 * popover listing every nation as a clickable NationPill row. Dismisses on
 * outside-click or Escape. Pairs with the native <select> beside it so both
 * controls drive the same nation_id.
 */
function NationChipPicker({
  nations,
  selectedId,
  onChange,
}: {
  nations: Nation[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = nations.find((n) => n.id === selectedId) ?? null;

  // When the popover opens, seed focus on the currently-selected nation
  // (or the first one) and move keyboard focus to that option.
  // This effect also performs a DOM side-effect (requestAnimationFrame focus),
  // so it must remain an effect; the setState calls track that same open state.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusIndex(-1);
      return;
    }
    const initialIdx = Math.max(
      0,
      nations.findIndex((n) => n.id === selectedId)
    );
    setFocusIndex(initialIdx);
    // Defer until after the popover renders so the ref is wired up.
    requestAnimationFrame(() => optionRefs.current[initialIdx]?.focus());
  }, [open, nations, selectedId]);

  // Outside-click + Escape close. Escape also returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleListboxKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (nations.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = focusIndex < nations.length - 1 ? focusIndex + 1 : 0;
      setFocusIndex(next);
      optionRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = focusIndex > 0 ? focusIndex - 1 : nations.length - 1;
      setFocusIndex(prev);
      optionRefs.current[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIndex(0);
      optionRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = nations.length - 1;
      setFocusIndex(last);
      optionRefs.current[last]?.focus();
    }
  }

  function handleTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    // ArrowDown / ArrowUp on a closed picker opens it (matches native
    // <select> behavior + the WAI listbox pattern).
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
        title={current?.name ?? "Pick nation"}
        aria-label="Pick nation"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-8 items-center justify-center rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {current ? (
          <NationPill nation={current} iconOnly />
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
            ?
          </span>
        )}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Nation"
          onKeyDown={handleListboxKey}
          className="absolute left-0 top-full z-20 mt-1 flex max-h-64 min-w-[10rem] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md focus:outline-none"
        >
          {nations.map((n, i) => (
            <button
              key={n.id}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="option"
              tabIndex={i === focusIndex ? 0 : -1}
              aria-selected={n.id === selectedId}
              onClick={() => {
                onChange(n.id);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              onFocus={() => setFocusIndex(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none",
                n.id === selectedId ? "bg-accent/50" : undefined
              )}
            >
              <NationPill nation={n} className="shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
