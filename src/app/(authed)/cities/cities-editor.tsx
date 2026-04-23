"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { IconDisplay } from "@/components/icon-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import type { City, Nation } from "@/lib/db/types";
import { deleteCity, updateAllCities } from "./actions";

type SortMode = "city" | "nation";

type RowState = {
  id: string;
  name: string;
  code: string;
  nation_id: string;
};

/** "ABC DEF" — 3 alnum + single space + 3 alnum, all uppercase, no symbols. */
function formatCityCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}
function isValidCityCode(code: string): boolean {
  return /^[A-Z0-9]{3} [A-Z0-9]{3}$/.test(code);
}

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

export function CitiesEditor({
  cities,
  nations,
}: {
  cities: City[];
  nations: Nation[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() =>
    cities.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      nation_id: c.nation_id,
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sortMode, setSortMode] = useState<SortMode>("city");
  const [filterNationId, setFilterNationId] = useState<string>("");

  // Reconcile server data.
  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(cities.map((c) => c.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      const additions: RowState[] = [];
      for (const c of cities) {
        if (!prevById.has(c.id)) {
          additions.push({
            id: c.id,
            name: c.name,
            code: c.code,
            nation_id: c.nation_id,
          });
        }
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }, [cities]);

  const nationMap = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );

  // Duplicate-code tracking across all rows.
  const codeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.code.trim();
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  function rowHasCodeError(r: RowState): boolean {
    if (!isValidCityCode(r.code)) return true;
    return (codeCounts.get(r.code.trim()) ?? 0) > 1;
  }

  const anyBlocked = rows.some((r) => !r.name.trim() || rowHasCodeError(r));

  const view = useMemo(() => {
    let list = rows.slice();
    if (filterNationId) list = list.filter((r) => r.nation_id === filterNationId);
    list.sort((a, b) => {
      if (sortMode === "nation") {
        const an = nationMap.get(a.nation_id)?.name ?? "";
        const bn = nationMap.get(b.nation_id)?.name ?? "";
        const byNation = an.localeCompare(bn);
        if (byNation !== 0) return byNation;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, sortMode, nationMap, filterNationId]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllCities(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {anyBlocked ? (
          <span className="text-xs text-destructive">
            Fix invalid or duplicate city codes to save.
          </span>
        ) : null}
        <Label className="!text-xs">Filter</Label>
        <Select
          value={filterNationId}
          onChange={(e) => setFilterNationId(e.target.value)}
          className="h-8 w-auto"
        >
          <option value="">All nations</option>
          {nations.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </Select>
        <Label className="ml-3 !text-xs">Sort</Label>
        <Select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="h-8 w-auto"
        >
          <option value="city">City name</option>
          <option value="nation">Nation, then city</option>
        </Select>
        <Button
          type="button"
          onClick={save}
          variant={dirty && !anyBlocked ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty || anyBlocked}
          className="ml-3"
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

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="overflow-hidden rounded-md border border-border bg-card"
      >
        <div className="grid grid-cols-[32px_1fr_110px_220px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <Label>Name</Label>
          <Label>Code</Label>
          <Label>Nation</Label>
          <span />
        </div>
        {view.map((r) => {
          const n = nationMap.get(r.nation_id);
          const codeError = rowHasCodeError(r);
          return (
            <CityRow
              key={r.id}
              row={r}
              nations={nations}
              nation={n}
              codeError={codeError}
              onChange={(patch) => updateRow(r.id, patch)}
              onDelete={() => {
                const fd = new FormData();
                fd.append("id", r.id);
                startTransition(async () => {
                  await deleteCity(fd);
                  setRows((prev) => prev.filter((x) => x.id !== r.id));
                });
              }}
            />
          );
        })}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No cities{filterNationId ? " in that nation" : ""} yet.
          </p>
        ) : null}
      </form>
    </>
  );
}

function CityRow({
  row,
  nations,
  nation,
  codeError,
  onChange,
  onDelete,
}: {
  row: RowState;
  nations: Nation[];
  nation: Nation | undefined;
  codeError: boolean;
  onChange: (patch: Partial<RowState>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setEditing(false);
    }
  }

  return (
    <div
      tabIndex={-1}
      onFocus={() => setEditing(true)}
      onClick={() => setEditing(true)}
      onBlur={handleBlur}
      className={cn(
        "grid cursor-text grid-cols-[32px_1fr_110px_220px_36px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0",
        editing && "bg-accent/20"
      )}
    >
      <input type="hidden" name="ids" value={row.id} />
      <input type="hidden" name="names" value={row.name} />
      <input type="hidden" name="codes" value={row.code} />
      <input type="hidden" name="nation_ids" value={row.nation_id} />

      <span
        className="flex h-6 w-6 items-center justify-center rounded"
        style={{
          background: nation?.color_hex ?? "var(--muted)",
          color: nation ? readableOn(nation.color_hex) : undefined,
        }}
        title={nation?.name}
      >
        {nation?.icon_value ? (
          <IconDisplay
            type={nation.icon_type}
            value={nation.icon_value}
            size={14}
          />
        ) : null}
      </span>
      {editing ? (
        <>
          <Input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn("h-8", !row.name.trim() && "ring-2 ring-destructive")}
            autoFocus
            required
          />
          <Input
            value={row.code}
            onChange={(e) => onChange({ code: formatCityCode(e.target.value) })}
            placeholder="ABC DEF"
            maxLength={7}
            className={cn(
              "h-8 uppercase tracking-wider",
              codeError && "ring-2 ring-destructive"
            )}
            aria-invalid={codeError}
          />
          <Select
            value={row.nation_id}
            onChange={(e) => onChange({ nation_id: e.target.value })}
            className="h-8"
          >
            {nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </>
      ) : (
        <>
          <ReadCell className={cn(!row.name.trim() && "ring-2 ring-destructive")}>
            {row.name || <span className="text-muted-foreground">—</span>}
          </ReadCell>
          <ReadCell
            className={cn("font-mono", codeError && "ring-2 ring-destructive")}
          >
            {row.code || <span className="text-muted-foreground">—</span>}
          </ReadCell>
          <ReadCell>
            {nation?.name ?? <span className="text-muted-foreground">—</span>}
          </ReadCell>
        </>
      )}
      <DeleteX name={row.name} onDelete={onDelete} />
    </div>
  );
}

function ReadCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-8 items-center truncate rounded-md px-2 text-sm",
        className
      )}
    >
      {children}
    </span>
  );
}

function DeleteX({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  return (
    <>
      <button
        type="button"
        aria-label="Delete city"
        title="Delete"
        onClick={async () => {
          const ok = await confirmDialog({
            title: "Delete city?",
            message: `"${name}" will be permanently removed.`,
            confirmLabel: "Delete",
            intent: "destructive",
          });
          if (!ok) return;
          onDelete();
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
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
      {confirmDialogEl}
    </>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
