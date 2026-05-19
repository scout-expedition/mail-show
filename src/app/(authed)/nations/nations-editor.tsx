"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe, Plus } from "lucide-react";
import { PanelHeader } from "@/components/panel";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import type { City, Nation } from "@/lib/db/types";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type { PresencePeer, PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { IconDisplay } from "@/components/icon-display";
import type { IconType } from "@/lib/db/enums";
import { createNation, updateAllNations } from "./actions";
import { NationInspector } from "./nation-inspector";

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

export function NationsEditor({
  nations,
  cities,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  nations: Nation[];
  cities: City[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="nations-editor"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={["nations"]}
    >
      <NationsEditorInner nations={nations} cities={cities} />
    </WorkspacePresenceProvider>
  );
}

/** Resolve the nation a peer currently has open. */
function peerNationId(peer: PresencePeer): string | null {
  const fromSelection = peer.selection?.payload?.nationId;
  if (fromSelection) return fromSelection;
  if (peer.focus?.table === "nations") return peer.focus.recordId;
  return null;
}

function NationsEditorInner({
  nations: initialNations,
  cities,
}: {
  nations: Nation[];
  cities: City[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { peers, onPostgresChanges, setSelection } = usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startReorderTransition] = useTransition();

  // Local mirror of nations
  const [rows, setRows] = useState<Nation[]>(initialNations);
  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(initialNations.map((n) => n.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: Nation[] = [];
      for (const n of initialNations) {
        if (!prevById.has(n.id)) additions.push(n);
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [initialNations]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Selection state
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Two-way URL param sync (?nation=<name>). Matches by name first, falls
  // back to id for backwards compatibility with old links. URLSearchParams
  // handles encode/decode of the value transparently — no manual encoding.
  const appliedParamRef = useRef<string | null>(null);
  // URL → state
  useEffect(() => {
    const param = searchParams.get("nation");
    if (param === appliedParamRef.current) return;
    appliedParamRef.current = param;
    if (param) {
      const match =
        rows.find((r) => r.name === param) ??
        rows.find((r) => r.id === param) ??
        null;
      setSelectedId(match?.id ?? null);
    } else {
      setSelectedId(null);
    }
  }, [searchParams, rows]);
  // state → URL
  useEffect(() => {
    const row = selectedId ? rows.find((r) => r.id === selectedId) : null;
    const desired = row ? row.name?.trim() || row.id : null;
    if (desired === appliedParamRef.current) return;
    appliedParamRef.current = desired;
    const params = new URLSearchParams(searchParams);
    if (desired) params.set("nation", desired);
    else params.delete("nation");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [selectedId, rows, searchParams, pathname, router]);

  // Broadcast selection to peers
  useEffect(() => {
    if (selectedId) {
      setSelection({
        storylineId: null,
        groupId: null,
        letterId: null,
        segmentId: null,
        view: "nation",
        payload: { nationId: selectedId },
      });
    } else {
      setSelection(null);
    }
  }, [selectedId, setSelection]);

  // postgres_changes handler
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "nations") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as Nation;
        setRows((prev) =>
          prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string; updated_by?: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        setSelectedId((cur) => (cur === deleted.id ? null : cur));
        const by = deleted.updated_by ?? "Someone";
        toast({
          message: `${by} deleted a nation.`,
          intent: "destructive",
        });
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as Nation;
        setRows((prev) => {
          if (prev.some((r) => r.id === inserted.id)) return prev;
          return [...prev, inserted];
        });
        startTransition(() => router.refresh());
      }
    });
  }, [onPostgresChanges, router, toast]);

  // Drag reorder
  function handleDragOver(e: React.DragEvent, overIdx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIdx) return;
    setRows((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIdx, 0, moved);
      return next;
    });
    setDragIndex(overIdx);
  }

  function handleDragEnd() {
    setDragIndex(null);
    const fd = new FormData();
    rows.forEach((r, i) => {
      fd.append("ids", r.id);
      fd.append("names", r.name);
      fd.append("abbreviations", r.abbreviation ?? "");
      fd.append("colors", r.color_hex);
      fd.append("icon_types", r.icon_type);
      fd.append("icon_values", r.icon_value ?? "");
      fd.append("sort_orders", String(i));
    });
    startReorderTransition(async () => {
      await updateAllNations(fd);
    });
  }

  // The inspector has already run deleteNation — reconcile local state.
  function handleDeleted(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  const [creating, startCreate] = useTransition();
  function handleCreate() {
    startCreate(async () => {
      const created = await createNation();
      setRows((prev) =>
        prev.some((r) => r.id === created.id) ? prev : [...prev, created]
      );
      setSelectedId(created.id);
    });
  }

  // Peer rings indexed by nationId
  const peerRingsByNation = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of peers) {
      const nid = peerNationId(p);
      if (!nid) continue;
      const color = p.profile?.avatarColorHex ?? p.color;
      const arr = m.get(nid) ?? [];
      arr.push(color);
      m.set(nid, arr);
    }
    return m;
  }, [peers]);

  // City count by nation id
  const cityCountByNation = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cities) {
      m.set(c.nation_id, (m.get(c.nation_id) ?? 0) + 1);
    }
    return m;
  }, [cities]);

  // otherNames for the inspector's duplicate detection
  const otherNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.id === selectedId) continue;
      const k = r.name.trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [rows, selectedId]);

  const nationById = useMemo(
    () => new Map(rows.map((r) => [r.id, r])),
    [rows]
  );
  const selected = selectedId ? (nationById.get(selectedId) ?? null) : null;

  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {toaster}
      <div className="flex items-start gap-4">
        {/* Left list panel */}
        <div
          ref={panelRef}
          className="sticky top-4 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        >
          <PanelHeader
            title="Nations"
            icon={
              <Globe
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
            }
            menu={
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                aria-label="Add nation"
                title="Add nation"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Plus size={14} aria-hidden />
              </button>
            }
          />
          {/* Column headers */}
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <span className="w-5 shrink-0" aria-hidden />
            <span className="w-8 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 font-mono text-xs font-medium text-muted-foreground">
              Name
            </span>
            <span className="w-[60px] shrink-0 text-right font-mono text-xs font-medium text-muted-foreground">
              Abbr
            </span>
            <span className="w-[80px] shrink-0 text-right font-mono text-xs font-medium text-muted-foreground">
              Cities
            </span>
          </div>

          {rows.map((row, i) => {
            const peerColors = peerRingsByNation.get(row.id) ?? null;
            const cityCount = cityCountByNation.get(row.id) ?? 0;
            const fg = readableOn(row.color_hex);

            // Peer rings: inset box-shadows
            const boxShadow = peerColors?.length
              ? peerColors
                  .map((c, pi) => `inset 0 0 0 ${(pi + 1) * 2}px ${c}`)
                  .join(", ")
              : undefined;

            return (
              <div
                key={row.id}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={handleDragEnd}
                style={boxShadow ? { boxShadow } : undefined}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-t border-border px-3 py-1.5 text-sm transition-colors first:border-t-0 hover:bg-accent/20 focus:outline-none focus-visible:bg-accent/20",
                  row.id === selectedId ? "bg-accent/30" : undefined,
                  dragIndex === i ? "opacity-60" : undefined
                )}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSelectedId((cur) => (cur === row.id ? null : row.id))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId((cur) => (cur === row.id ? null : row.id));
                  }
                }}
              >
                {/* Drag handle — stopPropagation so grabbing doesn't toggle selection */}
                <span
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragIndex(i);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                >
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="2" cy="3" r="1.2" />
                    <circle cx="8" cy="3" r="1.2" />
                    <circle cx="2" cy="8" r="1.2" />
                    <circle cx="8" cy="8" r="1.2" />
                    <circle cx="2" cy="13" r="1.2" />
                    <circle cx="8" cy="13" r="1.2" />
                  </svg>
                </span>

                {/* Color + icon swatch (32px) */}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border"
                  style={{ background: row.color_hex, color: fg }}
                  aria-hidden
                >
                  {row.icon_value ? (
                    <IconDisplay
                      type={row.icon_type as IconType}
                      value={row.icon_value}
                      size={14}
                    />
                  ) : (
                    <span className="font-mono text-[9px] opacity-70">ic</span>
                  )}
                </span>

                {/* Name */}
                <span className="min-w-0 flex-1 truncate">{row.name}</span>

                {/* Abbreviation */}
                <span className="w-[60px] shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {row.abbreviation ?? ""}
                </span>

                {/* City count */}
                <span className="w-[80px] shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {cityCount} {cityCount === 1 ? "city" : "cities"}
                </span>
              </div>
            );
          })}

          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No nations yet.
            </p>
          ) : null}
        </div>

        {/* Right inspector panel */}
        {selected ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <NationInspector
              key={selected.id}
              nation={selected}
              cities={cities}
              otherNames={otherNames}
              onDeleted={handleDeleted}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
