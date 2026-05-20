"use client";

import { useTransition } from "react";
import { LayoutList, Trash2, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { FolderTreeOption } from "./variable-inspector";

/** Right-pane inspector that shows up when more than one row is selected.
 *  Lets the user move the whole selection into a folder/root or delete
 *  them all at once. */
export function MultiSelectInspector({
  variableCount,
  folderCount,
  folderOptions,
  onMove,
  onDelete,
  onClear,
}: {
  variableCount: number;
  folderCount: number;
  /** Indented folder labels excluding selected folders + their descendants
   *  (cycle protection — can't move INTO yourself). */
  folderOptions: FolderTreeOption[];
  onMove: (folderId: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const total = variableCount + folderCount;

  function move(folderId: string | null) {
    startTransition(async () => {
      await onMove(folderId);
    });
  }

  async function deleteAll() {
    const summary = formatCounts(variableCount, folderCount);
    const ok = await confirm({
      title: `Delete ${total} item${total === 1 ? "" : "s"}?`,
      message:
        `${summary} will be permanently removed. References in condition blocks, logic rules, and letter-action assignments will also be removed. ` +
        (folderCount > 0
          ? "Variables and subfolders inside each deleted folder will be moved up to that folder's parent."
          : ""),
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      await onDelete();
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={`${total} item${total === 1 ? "" : "s"} selected`}
        icon={
          <LayoutList
            size={14}
            aria-hidden
            className="text-muted-foreground/70"
          />
        }
        menu={
          <OverflowMenu
            items={[
              {
                label: "Clear selection",
                icon: <X size={12} aria-hidden />,
                onClick: onClear,
              },
              { divider: true },
              {
                label: "Delete selected",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: deleteAll,
                disabled: pending,
              },
            ]}
          />
        }
      />

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/40 bg-background/30 p-3 text-xs">
          <div>
            <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground/70">
              Variables
            </div>
            <div className="mt-1 text-foreground">{variableCount}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground/70">
              Folders
            </div>
            <div className="mt-1 text-foreground">{folderCount}</div>
          </div>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <Label className="!text-xs">Move to</Label>
          <Select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              e.target.value = "";
              move(v === "__root__" ? null : v);
            }}
            disabled={pending}
            aria-label="Move selection to"
            className={cn("h-8", GHOST_FIELD)}
          >
            <option value="" disabled>
              Pick destination…
            </option>
            <option value="__root__">— (root)</option>
            {folderOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

function formatCounts(variableCount: number, folderCount: number): string {
  const parts: string[] = [];
  if (variableCount > 0)
    parts.push(`${variableCount} variable${variableCount === 1 ? "" : "s"}`);
  if (folderCount > 0)
    parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
  return parts.join(" and ");
}
