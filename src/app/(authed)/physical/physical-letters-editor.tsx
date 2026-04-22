"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  InspectionLetterView,
  PhysicalLetter,
  SortingLetterView,
} from "@/lib/db/types";
import {
  deletePhysicalLetter,
  updateAllPhysicalLetters,
} from "./actions";

type RowState = {
  id: string;
  letter_id: number;
  rfid_payload: string;
  content_ref_type: "sorting" | "inspection";
  content_ref_id: string;
  storage_location: string;
};

function toRowState(p: PhysicalLetter): RowState {
  return {
    id: p.id,
    letter_id: p.letter_id,
    rfid_payload: p.rfid_payload,
    content_ref_type: p.content_ref_type,
    content_ref_id: p.content_ref_id,
    storage_location: p.storage_location ?? "",
  };
}

export function PhysicalLettersEditor({
  physical,
  sortingRefs,
  inspectionRefs,
}: {
  physical: PhysicalLetter[];
  sortingRefs: Pick<SortingLetterView, "id" | "content_id">[];
  inspectionRefs: Pick<InspectionLetterView, "id" | "content_id">[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<RowState[]>(() => physical.map(toRowState));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(physical.map((p) => p.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const additions: RowState[] = [];
      for (const p of physical) {
        if (!prevById.has(p.id)) additions.push(toRowState(p));
      }
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [physical]);

  function save() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await updateAllPhysicalLetters(fd);
      setDirty(false);
    });
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function contentIdFor(r: RowState): string {
    if (r.content_ref_type === "sorting") {
      return (
        sortingRefs.find((x) => x.id === r.content_ref_id)?.content_id ??
        "(missing)"
      );
    }
    return (
      inspectionRefs.find((x) => x.id === r.content_ref_id)?.content_id ??
      "(missing)"
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          onClick={save}
          variant={dirty ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty}
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
        <div className="grid grid-cols-[100px_130px_90px_100px_1fr_36px] items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <Label>Letter ID</Label>
          <Label>RFID</Label>
          <Label>Type</Label>
          <Label>Content</Label>
          <Label>Storage</Label>
          <span />
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[100px_130px_90px_100px_1fr_36px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0"
          >
            <input type="hidden" name="ids" value={row.id} />
            <input
              type="hidden"
              name="storage_locations"
              value={row.storage_location}
            />

            <span className="font-mono text-sm">
              {String(row.letter_id).padStart(6, "0")}
            </span>
            <Badge variant="secondary" className="font-mono">
              {row.rfid_payload}
            </Badge>
            <span className="text-xs capitalize text-muted-foreground">
              {row.content_ref_type}
            </span>
            <Badge variant="muted" className="font-mono">
              {contentIdFor(row)}
            </Badge>
            <Input
              value={row.storage_location}
              onChange={(e) =>
                updateRow(row.id, { storage_location: e.target.value })
              }
              placeholder="—"
              className="h-8 font-mono"
            />
            <DeleteX id={row.id} label={row.rfid_payload} />
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No physical letters yet.
          </p>
        ) : null}
      </form>
    </>
  );
}

function DeleteX({ id, label }: { id: string; label: string }) {
  return (
    <form action={deletePhysicalLetter}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label="Delete physical letter"
        title="Delete"
        onClick={(e) => {
          if (
            !confirm(`Delete physical letter ${label}? This cannot be undone.`)
          )
            e.preventDefault();
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
    </form>
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
