"use client";

import { useTransition } from "react";
import { Folder, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { EndingVariableFolder } from "@/lib/db/types";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresencePeer } from "@/lib/realtime/presence";
import {
  deleteEndingVariableFolder,
  patchEndingVariableFolder,
} from "./actions";
import type { FolderTreeOption } from "./variable-inspector";

const FOLDER_TABLE = "ending_variable_folders";

export function FolderInspector({
  folder,
  folderOptions,
  childFolderCount,
  childVariableCount,
  peers,
  onActivity,
  onPatchError,
  onDeleted,
}: {
  folder: EndingVariableFolder;
  /** All other folders, indented by depth — excludes self + descendants. */
  folderOptions: FolderTreeOption[];
  childFolderCount: number;
  childVariableCount: number;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { setFocus } = usePresenceContext();
  const [pending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const focusKey = (field: string) => ({
    table: FOLDER_TABLE,
    recordId: folder.id,
    field,
  });

  async function commit<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      onPatchError(msg);
      throw err;
    }
  }

  const nameField = useInstantField({
    value: folder.name,
    onCommit: (v) =>
      commit(() => patchEndingVariableFolder(folder.id, { name: v })),
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("name") : null),
    onActivity,
  });

  const parentField = useInstantField<string | null>({
    value: folder.parent_folder_id,
    onCommit: (v) =>
      commit(() =>
        patchEndingVariableFolder(folder.id, { parent_folder_id: v })
      ),
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("parent_folder_id") : null),
    onActivity,
  });

  const dirty =
    nameField.status === "dirty" ||
    nameField.status === "saving" ||
    parentField.status === "dirty" ||
    parentField.status === "saving";

  async function handleDelete() {
    const hasContents = childFolderCount > 0 || childVariableCount > 0;
    const message = hasContents
      ? `"${folder.name}" contains ${childVariableCount} variable${childVariableCount === 1 ? "" : "s"} and ${childFolderCount} subfolder${childFolderCount === 1 ? "" : "s"}. They will be moved to ${folder.parent_folder_id ? "the parent folder" : "the root"}.`
      : `"${folder.name}" will be removed.`;
    const ok = await confirm({
      title: "Delete folder?",
      message,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", folder.id);
    startTransition(async () => {
      await deleteEndingVariableFolder(fd);
      onDeleted(folder.id);
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={nameField.value || "Unnamed folder"}
        icon={
          <Folder size={14} aria-hidden className="text-muted-foreground/70" />
        }
        dirty={dirty}
        showSaved={!dirty}
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete folder",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: handleDelete,
                disabled: pending,
              },
            ]}
          />
        }
      />

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <Label className="!text-xs">Name</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("name")}>
            <Input
              value={nameField.value}
              onChange={(e) => nameField.set(e.target.value)}
              onFocus={nameField.onFocus}
              onBlur={nameField.onBlur}
              placeholder="Folder name"
              className={cn(
                "h-8 min-w-0 font-medium",
                GHOST_FIELD,
                !nameField.value.trim() && "ring-2 ring-destructive",
                nameField.status === "error" && "ring-2 ring-destructive"
              )}
            />
          </FieldHighlight>

          <Label className="!text-xs">Parent</Label>
          <FieldHighlight
            peers={peers}
            focusKey={focusKey("parent_folder_id")}
          >
            <Select
              value={parentField.value ?? ""}
              onChange={(e) => parentField.set(e.target.value || null)}
              onFocus={parentField.onFocus}
              onBlur={parentField.onBlur}
              aria-label="Parent folder"
              className={cn("h-8", GHOST_FIELD)}
            >
              <option value="">— (root)</option>
              {folderOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </FieldHighlight>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/40 bg-background/30 p-3 text-xs">
          <div>
            <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground/70">
              Subfolders
            </div>
            <div className="mt-1 text-foreground">{childFolderCount}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-widest text-[10px] text-muted-foreground/70">
              Variables
            </div>
            <div className="mt-1 text-foreground">{childVariableCount}</div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
