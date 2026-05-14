"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceFocus, PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import type { Day, SortingLetterView } from "@/lib/db/types";
import { deleteSortingLetter, patchSortingLetter } from "./actions";

const POSTGRES_TABLES = ["sorting_letters"];

// ─── Public component: wraps inner in WorkspacePresenceProvider ──────────────

export function SortingLettersEditor({
  letters,
  days,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  letters: SortingLetterView[];
  days: Day[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="sorting-letters"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={POSTGRES_TABLES}
    >
      <SortingLettersEditorInner
        letters={letters}
        days={days}
      />
    </WorkspacePresenceProvider>
  );
}

// ─── Inner component (reads presence context) ────────────────────────────────

function SortingLettersEditorInner({
  letters: lettersProp,
  days,
}: {
  letters: SortingLetterView[];
  days: Day[];
}) {
  const router = useRouter();
  const { peers, selfPeer, onPostgresChanges } = usePresenceContext();
  const { toast, toaster } = useToast();

  // Mirror server array so postgres_changes can fan out without a page reload.
  // "Adjust state during render" pattern keeps it in sync on structural revalidates.
  const [letters, setLetters] = useState(lettersProp);
  const [prevLettersProp, setPrevLettersProp] = useState(lettersProp);
  if (lettersProp !== prevLettersProp) {
    setPrevLettersProp(lettersProp);
    setLetters(lettersProp);
  }

  const [filterDayId, setFilterDayId] = useState<string>("");

  // Debounced router.refresh for INSERT events from peers (view-derived columns
  // like content_id require the RSC layer — can't be computed client-side).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // postgres_changes subscription
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      const { table, eventType } = change;
      if (table !== "sorting_letters") return;

      if (eventType === "UPDATE") {
        const newRow = change.new as Record<string, unknown>;
        const id = newRow.id as string | undefined;
        if (!id) return;
        setLetters((prev) =>
          prev.map((r) =>
            r.id === id ? ({ ...r, ...newRow } as unknown as SortingLetterView) : r
          )
        );
        return;
      }

      if (eventType === "DELETE") {
        const oldRow = change.old as Record<string, unknown> | undefined;
        const id = oldRow?.id as string | undefined;
        if (!id) return;
        setLetters((prev) => prev.filter((r) => r.id !== id));
        toast({ intent: "destructive", message: "Someone deleted a sorting letter" });
        return;
      }

      if (eventType === "INSERT") {
        scheduleRefresh();
        return;
      }
    });
  }, [onPostgresChanges, toast, scheduleRefresh]);

  const view = useMemo(() => {
    if (!filterDayId) return letters;
    return letters.filter((r) => r.day_id === filterDayId);
  }, [letters, filterDayId]);

  return (
    <>
      {toaster}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Label className="!text-xs">Day</Label>
        <Select
          value={filterDayId}
          onChange={(e) => setFilterDayId(e.target.value)}
          className="h-8 w-auto"
        >
          <option value="">All days</option>
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.identifier}
              {d.name ? ` — ${d.name}` : ""}
            </option>
          ))}
        </Select>

        <AvatarStack
          peers={peers}
          self={selfPeer}
          popupAlign="right"
          className="ml-3"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[80px_70px_1fr_1fr_70px_120px_28px_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <Label>ID</Label>
          <Label>Day</Label>
          <Label>Recipient</Label>
          <Label>Sender</Label>
          <Label>Fake?</Label>
          <Label>Storage</Label>
          <span />
          <span />
        </div>
        {view.map((row) => (
          <SortingLetterRow
            key={row.id}
            row={row}
            days={days}
            peers={peers}
          />
        ))}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No sorting letters{filterDayId ? " for that day" : ""} yet.
          </p>
        ) : null}
      </div>
    </>
  );
}

// ─── Per-row component with instant-save fields ──────────────────────────────

function SortingLetterRow({
  row,
  days,
  peers,
}: {
  row: SortingLetterView;
  days: Day[];
  peers: ReturnType<typeof usePresenceContext>["peers"];
}) {
  const { setFocus, pingActivity } = usePresenceContext();

  function makeFocusKey(field: string): PresenceFocus {
    return { table: "sorting_letters", recordId: row.id, field };
  }

  const dayField = useInstantField<string>({
    value: row.day_id,
    onCommit: (v) => patchSortingLetter(row.id, { day_id: v }),
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("day_id") : null),
    onActivity: pingActivity,
  });

  const recipientField = useInstantField<string>({
    value: row.recipient_name ?? "",
    onCommit: (v) => patchSortingLetter(row.id, { recipient_name: v.trim() || null }),
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("recipient_name") : null),
    onActivity: pingActivity,
  });

  const senderField = useInstantField<string>({
    value: row.sender_name ?? "",
    onCommit: (v) => patchSortingLetter(row.id, { sender_name: v.trim() || null }),
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("sender_name") : null),
    onActivity: pingActivity,
  });

  const counterField = useInstantField<boolean>({
    value: row.is_counterfeit,
    onCommit: (v) => patchSortingLetter(row.id, { is_counterfeit: v }),
    onFocusChange: (focused) =>
      setFocus(focused ? makeFocusKey("is_counterfeit") : null),
    onActivity: pingActivity,
  });

  const storageField = useInstantField<string>({
    value: row.storage_location ?? "",
    onCommit: (v) =>
      patchSortingLetter(row.id, { storage_location: v.trim() || null }),
    onFocusChange: (focused) =>
      setFocus(focused ? makeFocusKey("storage_location") : null),
    onActivity: pingActivity,
  });

  return (
    <div className="grid grid-cols-[80px_70px_1fr_1fr_70px_120px_28px_36px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0">
      <Badge variant="secondary" className="font-mono">
        {row.content_id}
      </Badge>

      <FieldHighlight peers={peers} focusKey={makeFocusKey("day_id")}>
        <Select
          value={dayField.value}
          onChange={(e) => dayField.set(e.target.value)}
          onFocus={dayField.onFocus}
          onBlur={dayField.onBlur}
          className="h-8"
        >
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.identifier}
            </option>
          ))}
        </Select>
      </FieldHighlight>

      <FieldHighlight peers={peers} focusKey={makeFocusKey("recipient_name")}>
        <Input
          value={recipientField.value}
          onChange={(e) => recipientField.set(e.target.value)}
          onFocus={recipientField.onFocus}
          onBlur={recipientField.onBlur}
          placeholder="—"
          className="h-8"
        />
      </FieldHighlight>

      <FieldHighlight peers={peers} focusKey={makeFocusKey("sender_name")}>
        <Input
          value={senderField.value}
          onChange={(e) => senderField.set(e.target.value)}
          onFocus={senderField.onFocus}
          onBlur={senderField.onBlur}
          placeholder="—"
          className="h-8"
        />
      </FieldHighlight>

      <FieldHighlight peers={peers} focusKey={makeFocusKey("is_counterfeit")}>
        <label
          className={cn(
            "flex h-8 cursor-pointer items-center justify-center rounded-md text-xs",
            counterField.value && "text-destructive"
          )}
        >
          <input
            type="checkbox"
            checked={counterField.value}
            onChange={(e) => {
              counterField.set(e.target.checked);
              // Checkbox fires change but not focus — call handlers explicitly.
              counterField.onFocus();
              // Blur fires separately; leave the blur handler wired on the label.
            }}
            onFocus={counterField.onFocus}
            onBlur={counterField.onBlur}
            className="mr-1 accent-destructive"
          />
          {counterField.value ? "yes" : "no"}
        </label>
      </FieldHighlight>

      <FieldHighlight peers={peers} focusKey={makeFocusKey("storage_location")}>
        <Input
          value={storageField.value}
          onChange={(e) => storageField.set(e.target.value)}
          onFocus={storageField.onFocus}
          onBlur={storageField.onBlur}
          placeholder="—"
          className="h-8 font-mono"
        />
      </FieldHighlight>

      <Link
        href={`/sorting/letters/${row.id}`}
        aria-label="Open detail editor"
        title="Open detail editor"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <PencilIcon />
      </Link>
      <DeleteX id={row.id} name={row.content_id} />
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function DeleteX({ id, name }: { id: string; name: string }) {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label="Delete sorting letter"
        title="Delete"
        onClick={async () => {
          const ok = await confirmDialog({
            title: "Delete sorting letter?",
            message: `${name} will be permanently removed.`,
            confirmLabel: "Delete",
            intent: "destructive",
          });
          if (!ok) return;
          const fd = new FormData();
          fd.set("id", id);
          startTransition(() => deleteSortingLetter(fd));
        }}
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
      {confirmDialogEl}
    </>
  );
}
