"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import type { Day, SortingLetterView } from "@/lib/db/types";
import {
  deleteSortingLetter,
  updateAllSortingLetters,
} from "./actions";

type RowState = {
  id: string;
  content_id: string;
  day_id: string;
  recipient_name: string;
  sender_name: string;
  storage_location: string;
  is_counterfeit: boolean;
};

function toRowState(l: SortingLetterView): RowState {
  return {
    id: l.id,
    content_id: l.content_id,
    day_id: l.day_id,
    recipient_name: l.recipient_name ?? "",
    sender_name: l.sender_name ?? "",
    storage_location: l.storage_location ?? "",
    is_counterfeit: l.is_counterfeit,
  };
}

export function SortingLettersEditor({
  letters,
  days,
}: {
  letters: SortingLetterView[];
  days: Day[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() => letters.map(toRowState));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [filterDayId, setFilterDayId] = useState<string>("");

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(letters.map((l) => l.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: RowState[] = [];
      for (const l of letters) {
        if (!prevById.has(l.id)) additions.push(toRowState(l));
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [letters]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllSortingLetters(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  const view = useMemo(() => {
    let list = rows.slice();
    if (filterDayId) list = list.filter((r) => r.day_id === filterDayId);
    return list;
  }, [rows, filterDayId]);

  return (
    <>
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
        <Button
          type="button"
          onClick={save}
          variant={dirty ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty}
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
        className="overflow-hidden rounded-md border border-border bg-card"
      >
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
          <div
            key={row.id}
            className="grid grid-cols-[80px_70px_1fr_1fr_70px_120px_28px_36px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0"
          >
            <input type="hidden" name="ids" value={row.id} />
            <input type="hidden" name="day_ids" value={row.day_id} />
            <input type="hidden" name="recipient_names" value={row.recipient_name} />
            <input type="hidden" name="sender_names" value={row.sender_name} />
            <input
              type="hidden"
              name="storage_locations"
              value={row.storage_location}
            />
            <input
              type="hidden"
              name="is_counterfeits"
              value={row.is_counterfeit ? "true" : "false"}
            />

            <Badge variant="secondary" className="font-mono">
              {row.content_id}
            </Badge>
            <Select
              value={row.day_id}
              onChange={(e) => updateRow(row.id, { day_id: e.target.value })}
              className="h-8"
            >
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.identifier}
                </option>
              ))}
            </Select>
            <Input
              value={row.recipient_name}
              onChange={(e) =>
                updateRow(row.id, { recipient_name: e.target.value })
              }
              placeholder="—"
              className="h-8"
            />
            <Input
              value={row.sender_name}
              onChange={(e) =>
                updateRow(row.id, { sender_name: e.target.value })
              }
              placeholder="—"
              className="h-8"
            />
            <label
              className={cn(
                "flex h-8 cursor-pointer items-center justify-center rounded-md text-xs",
                row.is_counterfeit && "text-destructive"
              )}
            >
              <input
                type="checkbox"
                checked={row.is_counterfeit}
                onChange={(e) =>
                  updateRow(row.id, { is_counterfeit: e.target.checked })
                }
                className="mr-1 accent-destructive"
              />
              {row.is_counterfeit ? "yes" : "no"}
            </label>
            <Input
              value={row.storage_location}
              onChange={(e) =>
                updateRow(row.id, { storage_location: e.target.value })
              }
              placeholder="—"
              className="h-8 font-mono"
            />
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
        ))}
        {view.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No sorting letters{filterDayId ? " for that day" : ""} yet.
          </p>
        ) : null}
      </form>
    </>
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

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
