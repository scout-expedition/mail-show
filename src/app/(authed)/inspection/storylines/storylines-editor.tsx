"use client";

import { startTransition, useCallback, useEffect, useRef, useTransition, useState } from "react";
import { IconPicker } from "@/components/icon-picker";
import { IconDisplay } from "@/components/icon-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-dialog";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresenceFocus } from "@/lib/realtime/presence";
import type { PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";
import type { Storyline } from "@/lib/db/types";
import {
  deleteStoryline,
  patchStoryline,
  reorderStorylines,
} from "./actions";

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

/**
 * Outer shell: mounts WorkspacePresenceProvider so every StorylineRow inside
 * can call usePresenceContext() and get live peers + setFocus.
 */
export function StorylinesEditor({
  storylines,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  storylines: Storyline[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="storylines-editor"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={["storylines"]}
    >
      <StorylinesEditorInner storylines={storylines} />
    </WorkspacePresenceProvider>
  );
}

/**
 * The real editor body. Instant-save per field; drag-reorder is a structural
 * mutation (saves sort_order for all rows via `reorderStorylines`).
 */
function StorylinesEditorInner({ storylines }: { storylines: Storyline[] }) {
  const router = useRouter();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const { peers, selfPeer, onPostgresChanges } = usePresenceContext();

  // Mirror rows locally so drag-reorder works without RSC round-trips, and
  // so postgres_changes UPDATEs/DELETEs can fan out without a page reload.
  const [rows, setRows] = useState<Storyline[]>(() => storylines);
  const [prevStorylinesRef, setPrevStorylinesRef] = useState(storylines);
  if (storylines !== prevStorylinesRef) {
    setPrevStorylinesRef(storylines);
    // "adjust state during render" — resync mirror when RSC props change.
    setRows(storylines);
  }

  // Coalesce bursts of INSERTs into one RSC refetch. Matching the
  // workspace.tsx B5 pattern: debounce 100 ms + startTransition wrap so
  // Next 16 doesn't coalesce the refresh away before it invalidates the route.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    []
  );
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      startTransition(() => {
        router.refresh();
      });
    }, 100);
  }, [router]);

  // Subscribe to postgres_changes on "storylines" so edits from peers
  // (and other surfaces like the inline inspector) fan out in real time.
  useEffect(() => {
    return onPostgresChanges((change) => {
      if (change.table !== "storylines") return;
      if (change.eventType === "UPDATE") {
        setRows((prev) =>
          prev.map((r) =>
            r.id === (change.new as { id: string }).id
              ? { ...r, ...(change.new as unknown as Storyline) }
              : r
          )
        );
      } else if (change.eventType === "DELETE") {
        setRows((prev) => prev.filter((r) => r.id !== change.old.id));
      } else if (change.eventType === "INSERT") {
        // A peer created a new storyline — the raw postgres payload doesn't
        // include computed columns, so refresh the RSC layer to reseed the
        // mirror with the full row. Debounced to coalesce burst inserts;
        // wrapped in startTransition so Next 16 schedules the refetch
        // rather than coalescing it away (B5 lesson #1).
        scheduleRefresh();
      }
    });
  }, [onPostgresChanges, scheduleRefresh]);

  // ----- Drag-reorder -----
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [reorderPending, startReorder] = useTransition();

  // viewRows: pendingOrder overrides the server order during drag.
  const viewRows = pendingOrder
    ? pendingOrder
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is Storyline => !!r)
    : rows;

  const orderDirty =
    !!pendingOrder &&
    (pendingOrder.length !== rows.length ||
      pendingOrder.some((id, i) => id !== rows[i]?.id));

  function handleDragOver(e: React.DragEvent, overIdx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIdx) return;
    const current = pendingOrder ?? rows.map((r) => r.id);
    const next = current.slice();
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIdx, 0, moved);
    setPendingOrder(next);
    setDragIndex(overIdx);
  }

  function saveReorder() {
    if (!pendingOrder) return;
    const final = pendingOrder;
    startReorder(async () => {
      await reorderStorylines(final);
      setPendingOrder(null);
    });
  }

  function cancelReorder() {
    setPendingOrder(null);
    setDragIndex(null);
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-2">
        <AvatarStack
          peers={peers}
          self={selfPeer}
          popupAlign="right"
        />
        {orderDirty ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={cancelReorder}
              disabled={reorderPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveReorder}
              disabled={reorderPending}
            >
              {reorderPending ? "Saving…" : "Save order"}
            </Button>
          </>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[20px_32px_220px_60px_1fr_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <span />
          <Label>Name</Label>
          <Label>Abbr</Label>
          <Label>Description</Label>
          <span />
        </div>
        {viewRows.map((row, i) => (
          <StorylineRow
            key={row.id}
            row={row}
            index={i}
            dragIndex={dragIndex}
            onDragStart={() => {
              setDragIndex(i);
              if (!pendingOrder) setPendingOrder(rows.map((r) => r.id));
            }}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={() => setDragIndex(null)}
            peers={peers}
            onConfirmDialog={confirmDialog}
          />
        ))}
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No storylines yet.
          </p>
        ) : null}
      </div>
      {confirmDialogEl}
    </>
  );
}

/**
 * A single row in the storylines list. Owns its own instant-save hooks so
 * each field debounce is scoped to that row. The `key={row.id}` at the
 * call site ensures hooks remount when a different row takes this slot.
 */
function StorylineRow({
  row,
  index,
  dragIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  peers,
  onConfirmDialog,
}: {
  row: Storyline;
  index: number;
  dragIndex: number | null;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  peers: import("@/lib/realtime/presence").PresencePeer[];
  onConfirmDialog: (options: {
    title: string;
    message?: string;
    confirmLabel?: string;
    intent?: "destructive" | "default";
  }) => Promise<boolean>;
}) {
  const { setFocus, pingActivity } = usePresenceContext();
  const [expandedIcon, setExpandedIcon] = useState(false);
  const [deletePending, startDelete] = useTransition();

  // Local display state for icon/color (since the picker changes all three
  // at once). Text fields are driven directly by the instant-save field values.
  const [iconState, setIconState] = useState({
    icon_type: row.icon_type,
    icon_value: row.icon_value,
    color_hex: row.color_hex,
  });
  // Resync icon state when the server row changes (postgres_changes UPDATE or
  // RSC prop refresh) — "adjust state during render" pattern avoids a
  // useEffect setState that would trigger cascading renders.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevIconKey, setPrevIconKey] = useState(
    `${row.icon_type}:${row.icon_value}:${row.color_hex}`
  );
  const currentIconKey = `${row.icon_type}:${row.icon_value}:${row.color_hex}`;
  if (currentIconKey !== prevIconKey) {
    setPrevIconKey(currentIconKey);
    setIconState({
      icon_type: row.icon_type,
      icon_value: row.icon_value,
      color_hex: row.color_hex,
    });
  }

  // Focus-key helpers.
  function fk(field: string): PresenceFocus {
    return { table: "storylines", recordId: row.id, field };
  }

  // ----- Instant-save field hooks -----
  // value= MUST be the canonical server-row value (row.X), not iconState.X,
  // to avoid the B3 no-save bug.
  const nameField = useInstantField<string>({
    value: row.name,
    onCommit: async (next) => {
      await patchStoryline(row.id, { name: next });
    },
    onFocusChange: (focused) => setFocus(focused ? fk("name") : null),
    onActivity: pingActivity,
  });
  const abbrField = useInstantField<string>({
    value: row.abbreviation,
    onCommit: async (next) => {
      await patchStoryline(row.id, { abbreviation: next });
    },
    onFocusChange: (focused) => setFocus(focused ? fk("abbreviation") : null),
    onActivity: pingActivity,
  });
  const descriptionField = useInstantField<string | null>({
    value: row.description,
    onCommit: async (next) => {
      await patchStoryline(row.id, { description: next });
    },
    onFocusChange: (focused) => setFocus(focused ? fk("description") : null),
    onActivity: pingActivity,
  });
  const iconColorField = useInstantField<{
    icon_type: string;
    icon_value: string | null;
    color_hex: string;
  }>({
    value: {
      icon_type: row.icon_type,
      icon_value: row.icon_value,
      color_hex: row.color_hex,
    },
    equals: (a, b) =>
      a.icon_type === b.icon_type &&
      a.icon_value === b.icon_value &&
      a.color_hex === b.color_hex,
    onCommit: async (next) => {
      await patchStoryline(row.id, {
        icon_type: next.icon_type as IconType,
        icon_value: next.icon_value,
        color_hex: next.color_hex,
      });
    },
    onFocusChange: (focused) =>
      setFocus(focused ? fk("icon_color") : null),
    onActivity: pingActivity,
  });

  const fg = readableOn(iconState.color_hex);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        "border-t border-border first:border-t-0",
        dragIndex === index && "opacity-60"
      )}
    >
      <div className="grid grid-cols-[20px_32px_220px_60px_1fr_36px] items-center gap-2 px-3 py-1">
        <DragHandle />
        <FieldHighlight peers={peers} focusKey={fk("icon_color")}>
          <div onFocus={iconColorField.onFocus} onBlur={iconColorField.onBlur}>
            <button
              type="button"
              onClick={() => setExpandedIcon((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border"
              style={{ background: iconState.color_hex, color: fg }}
              title="Icon and color"
              aria-label="Edit icon and color"
              aria-expanded={expandedIcon}
            >
              {iconState.icon_value ? (
                <IconDisplay
                  type={iconState.icon_type}
                  value={iconState.icon_value}
                  size={14}
                />
              ) : (
                <span className="font-mono text-[9px] opacity-70">ic</span>
              )}
            </button>
          </div>
        </FieldHighlight>
        <FieldHighlight peers={peers} focusKey={fk("name")}>
          <Input
            value={nameField.value}
            onChange={(e) => nameField.set(e.target.value)}
            onFocus={nameField.onFocus}
            onBlur={nameField.onBlur}
            className={cn(
              "h-8",
              !nameField.value.trim() && "ring-2 ring-destructive"
            )}
            required
          />
        </FieldHighlight>
        <FieldHighlight peers={peers} focusKey={fk("abbreviation")}>
          <Input
            value={abbrField.value}
            onChange={(e) =>
              abbrField.set(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, "")
                  .slice(0, 1)
              )
            }
            onFocus={abbrField.onFocus}
            onBlur={abbrField.onBlur}
            maxLength={1}
            className="h-8 text-center"
          />
        </FieldHighlight>
        <FieldHighlight peers={peers} focusKey={fk("description")}>
          <Input
            value={descriptionField.value ?? ""}
            onChange={(e) => descriptionField.set(e.target.value || null)}
            onFocus={descriptionField.onFocus}
            onBlur={descriptionField.onBlur}
            className="h-8"
          />
        </FieldHighlight>
        <DeleteX
          pending={deletePending}
          onDelete={() => {
            void onConfirmDialog({
              title: "Delete storyline?",
              message: `"${row.name}" will be permanently removed.`,
              confirmLabel: "Delete",
              intent: "destructive",
            }).then((ok) => {
              if (!ok) return;
              const fd = new FormData();
              fd.set("id", row.id);
              startDelete(() => deleteStoryline(fd));
            });
          }}
        />
      </div>

      {expandedIcon ? (
        <div className="border-t border-border bg-accent/10 px-3 py-3">
          <FieldHighlight peers={peers} focusKey={fk("icon_color")}>
            <div onFocus={iconColorField.onFocus} onBlur={iconColorField.onBlur}>
              <IconPicker
                initialType={iconState.icon_type}
                initialValue={iconState.icon_value}
                emitHiddenFields={false}
                onChange={(next) => {
                  const updated = {
                    icon_type: next.type,
                    icon_value: next.value || null,
                    color_hex: iconState.color_hex,
                  };
                  setIconState((s) => ({ ...s, ...updated }));
                  iconColorField.set(updated);
                }}
                color={iconState.color_hex}
                onColorChange={(c) => {
                  const updated = {
                    icon_type: iconState.icon_type,
                    icon_value: iconState.icon_value,
                    color_hex: c,
                  };
                  setIconState((s) => ({ ...s, color_hex: c }));
                  iconColorField.set(updated);
                }}
              />
            </div>
          </FieldHighlight>
        </div>
      ) : null}
    </div>
  );
}

function DragHandle() {
  return (
    <span
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
  );
}

function DeleteX({
  pending,
  onDelete,
}: {
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Delete storyline"
      title="Delete"
      onClick={onDelete}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
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
  );
}
