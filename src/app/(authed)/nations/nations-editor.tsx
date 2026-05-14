"use client";

import {
  startTransition,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { IconDisplay } from "@/components/icon-display";
import { IconPicker } from "@/components/icon-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import type { IconType } from "@/lib/db/enums";
import type { Nation } from "@/lib/db/types";
import { WorkspacePresenceProvider, usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import type { PresenceProfile, PresencePeer } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import { deleteNation, patchNation, updateAllNations } from "./actions";
import { normalizeHex } from "@/lib/color";
import { useConfirm } from "@/components/confirm-dialog";

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
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  nations: Nation[];
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
      <NationsEditorInner nations={nations} />
    </WorkspacePresenceProvider>
  );
}

function NationsEditorInner({ nations: initialNations }: { nations: Nation[] }) {
  const router = useRouter();
  const { peers, selfPeer, onPostgresChanges, pingActivity } = usePresenceContext();
  const { toast, toaster } = useToast();
  const [, startReorderTransition] = useTransition();

  // Local mirror of nations, seeded from server props. useEffect reconciles
  // when the server prop changes (e.g. after a structural revalidate adds a nation).
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

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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
        const deleted = change.old as unknown as { id: string };
        setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        toast({
          message: "A nation was deleted by another user.",
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
    // Persist the new sort_order via the coarse updateAllNations action.
    // This is a structural mutation → keeps revalidatePath.
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

  return (
    <>
      {toaster}
      <div className="mb-4 flex items-center justify-end">
        <AvatarStack
          peers={peers}
          self={selfPeer ?? undefined}
          popupAlign="right"
          className="mr-auto"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[20px_32px_1fr_80px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span />
          <span />
          <Label>Name</Label>
          <Label>Abbr</Label>
          <span />
        </div>
        {rows.map((row, i) => {
          const expanded = expandedId === row.id;
          return (
            <div
              key={row.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              className={cn(
                "border-t border-border first:border-t-0",
                dragIndex === i && "opacity-60"
              )}
            >
              <NationRow
                row={row}
                peers={peers}
                expanded={expanded}
                onToggleExpand={() => setExpandedId(expanded ? null : row.id)}
                onActivity={pingActivity}
                onRowUpdate={(patch) =>
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r))
                  )
                }
              />
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No nations yet.
          </p>
        ) : null}
      </div>
    </>
  );
}

function NationRow({
  row,
  peers,
  expanded,
  onToggleExpand,
  onActivity,
  onRowUpdate,
}: {
  row: Nation;
  peers: PresencePeer[];
  expanded: boolean;
  onToggleExpand: () => void;
  onActivity: () => void;
  onRowUpdate: (patch: Partial<Nation>) => void;
}) {
  const { setFocus } = usePresenceContext();
  const fg = readableOn(row.color_hex);
  const focusBase = { table: "nations", recordId: row.id };

  const nameField = useInstantField({
    value: row.name,
    onCommit: (v) => patchNation(row.id, { name: v }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "name" } : null);
    },
    onActivity,
  });

  const abbreviationField = useInstantField({
    value: row.abbreviation ?? "",
    onCommit: (v) => patchNation(row.id, { abbreviation: v || null }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "abbreviation" } : null);
    },
    onActivity,
  });

  const colorField = useInstantField({
    value: row.color_hex,
    onCommit: (v) => patchNation(row.id, { color_hex: normalizeHex(v) }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "color_hex" } : null);
    },
    onActivity,
  });

  const iconTypeField = useInstantField({
    value: row.icon_type,
    onCommit: (v) => patchNation(row.id, { icon_type: v as IconType }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "icon_type" } : null);
    },
    onActivity,
  });

  const iconValueField = useInstantField({
    value: row.icon_value ?? "",
    onCommit: (v) => patchNation(row.id, { icon_value: v || null }),
    onFocusChange: (focused) => {
      setFocus(focused ? { ...focusBase, field: "icon_value" } : null);
    },
    onActivity,
  });

  return (
    <>
      <div className="grid grid-cols-[20px_32px_1fr_80px_36px] items-center gap-2 px-3 py-1">
        <DragHandle />
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
          style={{ background: colorField.value, color: fg }}
          title="Icon and color"
          aria-label="Edit icon and color"
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
        </button>
        <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "name" }}>
          <Input
            value={nameField.value}
            onChange={(e) => nameField.set(e.target.value)}
            onFocus={nameField.onFocus}
            onBlur={nameField.onBlur}
            className={cn("h-8", !nameField.value.trim() && "ring-2 ring-destructive")}
            required
          />
        </FieldHighlight>
        <FieldHighlight peers={peers} focusKey={{ ...focusBase, field: "abbreviation" }}>
          <Input
            value={abbreviationField.value}
            onChange={(e) => abbreviationField.set(e.target.value)}
            onFocus={abbreviationField.onFocus}
            onBlur={abbreviationField.onBlur}
            maxLength={1}
            className="h-8 text-center"
          />
        </FieldHighlight>
        <DeleteX id={row.id} name={row.name} />
      </div>

      {expanded ? (
        <div className="border-t border-border bg-accent/10 px-3 py-3">
          <FieldHighlight
            peers={peers}
            focusKey={{ ...focusBase, field: "icon_value" }}
          >
            <div
              onFocus={() => {
                iconValueField.onFocus();
                colorField.onFocus();
              }}
              onBlur={() => {
                iconValueField.onBlur();
                colorField.onBlur();
              }}
            >
              <IconPicker
                initialType={iconTypeField.value as IconType}
                initialValue={iconValueField.value || null}
                emitHiddenFields={false}
                onChange={(next) => {
                  iconTypeField.set(next.type);
                  iconValueField.set(next.value ?? "");
                  onRowUpdate({ icon_type: next.type, icon_value: next.value ?? null });
                }}
                color={colorField.value}
                onColorChange={(c) => {
                  colorField.set(c);
                  onRowUpdate({ color_hex: c });
                }}
              />
            </div>
          </FieldHighlight>
        </div>
      ) : null}
    </>
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

function DeleteX({ id, name }: { id: string; name: string }) {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  return (
    <>
      <button
        type="button"
        aria-label="Delete nation"
        title="Delete"
        onClick={async () => {
          const ok = await confirmDialog({
            title: "Delete nation?",
            message: `"${name}" will be permanently removed. This cannot be undone.`,
            confirmLabel: "Delete",
            intent: "destructive",
          });
          if (!ok) return;
          const fd = new FormData();
          fd.append("id", id);
          await deleteNation(fd);
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
