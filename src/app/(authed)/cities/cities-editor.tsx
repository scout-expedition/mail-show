"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { IconDisplay } from "@/components/icon-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import type { City, Nation } from "@/lib/db/types";
import { WorkspacePresenceProvider, usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import type { PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { deleteCity, patchCity } from "./actions";

type SortMode = "city" | "nation";

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
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  cities: City[];
  nations: Nation[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="cities-editor"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={["cities"]}
    >
      <CitiesEditorInner cities={cities} nations={nations} />
    </WorkspacePresenceProvider>
  );
}

function CitiesEditorInner({
  cities: initialCities,
  nations,
}: {
  cities: City[];
  nations: Nation[];
}) {
  const router = useRouter();
  const { peers, selfPeer, onPostgresChanges, pingActivity } = usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startDeleteTransition] = useTransition();

  // Local mirror of cities, seeded from server props. useEffect reconciles
  // when the server prop changes (e.g. after a structural revalidate adds a city).
  // Postgres UPDATE/DELETE are handled separately by the postgres_changes handler.
  const [rows, setRows] = useState<City[]>(initialCities);
  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(initialCities.map((c) => c.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: City[] = [];
      for (const c of initialCities) {
        if (!prevById.has(c.id)) additions.push(c);
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [initialCities]);

  const [sortMode, setSortMode] = useState<SortMode>("city");
  const [filterNationId, setFilterNationId] = useState<string>("");

  const nationMap = useMemo(
    () => new Map(nations.map((n) => [n.id, n])),
    [nations]
  );

  // postgres_changes handler — merges column-level updates into the mirror.
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "cities") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as City;
        setRows((prev) =>
          prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        toast({
          message: "A city was deleted by another user.",
          intent: "destructive",
        });
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as City;
        setRows((prev) => {
          if (prev.some((r) => r.id === inserted.id)) return prev;
          return [...prev, inserted];
        });
        // Refresh to re-derive any view-mapped columns via RSC.
        startTransition(() => router.refresh());
      }
    });
  }, [onPostgresChanges, router, toast]);

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

  return (
    <>
      {toaster}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <AvatarStack
          peers={peers}
          self={selfPeer ?? undefined}
          popupAlign="right"
          className="mr-auto"
        />
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
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[32px_1fr_110px_220px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <Label>Name</Label>
          <Label>Code</Label>
          <Label>Nation</Label>
          <span />
        </div>
        {view.map((row) => {
          const n = nationMap.get(row.nation_id);
          return (
            <CityRow
              key={row.id}
              row={row}
              nations={nations}
              nation={n}
              peers={peers}
              onActivity={pingActivity}
              onDelete={() => {
                startDeleteTransition(async () => {
                  const fd = new FormData();
                  fd.append("id", row.id);
                  await deleteCity(fd);
                  setRows((prev) => prev.filter((x) => x.id !== row.id));
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
      </div>
    </>
  );
}

function CityRow({
  row,
  nations,
  nation,
  peers,
  onActivity,
  onDelete,
}: {
  row: City;
  nations: Nation[];
  nation: Nation | undefined;
  peers: ReturnType<typeof usePresenceContext>["peers"];
  onActivity: () => void;
  onDelete: () => void;
}) {
  const { setFocus } = usePresenceContext();
  const [editing, setEditing] = useState(false);

  // Duplicate-code tracking is done at the list level; for instant-save we
  // validate name non-empty and code format per-field. Full duplicate check
  // across all rows would require passing the full mirror down — omit for now
  // and rely on the server action to reject bad writes.

  const nameField = useInstantField({
    value: row.name,
    onCommit: (v) => patchCity(row.id, { name: v }),
    onFocusChange: (focused) => {
      setFocus(focused ? { table: "cities", recordId: row.id, field: "name" } : null);
    },
    onActivity,
  });

  const codeField = useInstantField({
    value: row.code,
    onCommit: (v) => patchCity(row.id, { code: v }),
    onFocusChange: (focused) => {
      setFocus(focused ? { table: "cities", recordId: row.id, field: "code" } : null);
    },
    onActivity,
  });

  const nationField = useInstantField({
    value: row.nation_id,
    onCommit: (v) => patchCity(row.id, { nation_id: v }),
    onFocusChange: (focused) => {
      setFocus(focused ? { table: "cities", recordId: row.id, field: "nation_id" } : null);
    },
    onActivity,
  });

  const codeError = !isValidCityCode(codeField.value);

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setEditing(false);
    }
  }

  const focusBase = { table: "cities", recordId: row.id };

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
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "name" }}>
            <Input
              value={nameField.value}
              onChange={(e) => nameField.set(e.target.value)}
              onFocus={nameField.onFocus}
              onBlur={nameField.onBlur}
              className={cn("h-8", !nameField.value.trim() && "ring-2 ring-destructive")}
              autoFocus
              required
            />
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "code" }}>
            <Input
              value={codeField.value}
              onChange={(e) => codeField.set(formatCityCode(e.target.value))}
              onFocus={codeField.onFocus}
              onBlur={codeField.onBlur}
              placeholder="ABC DEF"
              maxLength={7}
              className={cn(
                "h-8 uppercase tracking-wider",
                codeError && "ring-2 ring-destructive"
              )}
              aria-invalid={codeError}
            />
          </FieldHighlight>
          <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "nation_id" }}>
            <div
              onFocus={nationField.onFocus}
              onBlur={nationField.onBlur}
            >
              <Select
                value={nationField.value}
                onChange={(e) => nationField.set(e.target.value)}
                className="h-8"
              >
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </div>
          </FieldHighlight>
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
