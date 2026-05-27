"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Playthrough } from "@/lib/db/types";
import {
  clearActivePlaythrough,
  deletePlaythrough,
  setActivePlaythrough,
  updatePlaythrough,
} from "../../actions";

/** Gear-icon dropdown that hosts the admin controls rehomed from the
 *  old free-form editor: name + notes edit, make/clear active, delete.
 *  Delete uses `useConfirm()` per the workspace dialog convention. */
export function PlayMenu({ playthrough }: { playthrough: Playthrough }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const popRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (popRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onDelete() {
    const ok = await confirm({
      title: "Delete this playthrough?",
      message:
        "Removes the playthrough and all of its action choices. This can't be undone.",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", playthrough.id);
    startTransition(async () => {
      await deletePlaythrough(fd);
    });
  }

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Playthrough menu"
          aria-expanded={open}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            open ? "bg-accent text-foreground" : null
          )}
        >
          <Settings2 size={16} aria-hidden />
        </button>
        {open ? (
          <div
            ref={popRef}
            role="menu"
            className="absolute right-0 top-full z-40 mt-2 w-80 rounded-md border border-border bg-popover p-3 shadow-xl"
          >
            <form
              action={updatePlaythrough}
              className="flex flex-col gap-2.5"
              onSubmit={() => setOpen(false)}
            >
              <input type="hidden" name="id" value={playthrough.id} />
              {/* Preserve current_day_id / current_phase — the form posts the
                  whole payload, so keep them on the wire even though they're
                  driven by play mode rather than this menu. */}
              <input
                type="hidden"
                name="current_day_id"
                value={playthrough.current_day_id ?? ""}
              />
              <input
                type="hidden"
                name="current_phase"
                value={playthrough.current_phase}
              />
              <div className="flex flex-col gap-1.5">
                <Label className="!text-xs">Name</Label>
                <Input name="name" defaultValue={playthrough.name} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="!text-xs">Notes</Label>
                <Textarea
                  name="notes"
                  defaultValue={playthrough.notes ?? ""}
                  rows={2}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  Save
                </Button>
              </div>
            </form>
            <div className="my-3 border-t border-border" />
            <div className="flex flex-col gap-2">
              {playthrough.is_active ? (
                <form
                  action={async () => {
                    await clearActivePlaythrough();
                    router.refresh();
                  }}
                >
                  <Button type="submit" size="sm" variant="ghost" className="w-full justify-start">
                    Clear active flag
                  </Button>
                </form>
              ) : (
                <form action={setActivePlaythrough}>
                  <input type="hidden" name="id" value={playthrough.id} />
                  <Button type="submit" size="sm" variant="ghost" className="w-full justify-start">
                    Make active
                  </Button>
                </form>
              )}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={onDelete}
                className="w-full justify-start"
              >
                Delete playthrough
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {dialog}
    </>
  );
}
