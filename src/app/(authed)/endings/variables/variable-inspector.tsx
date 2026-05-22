"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Hash, Plus, Star, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { GHOST_FIELD, OverflowMenu, PanelHeader } from "@/components/panel";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import type { EndingVariable, EndingVariableValue } from "@/lib/db/types";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresencePeer } from "@/lib/realtime/presence";
import {
  deleteEndingVariable,
  deleteEndingVariableValue,
  patchEndingVariable,
  patchEndingVariableValue,
} from "./actions";

const VAR_TABLE = "ending_variables";
const VALUE_TABLE = "ending_variable_values";

export type FolderTreeOption = { id: string; label: string };

export function VariableInspector({
  variable,
  values,
  folderOptions,
  peers,
  onActivity,
  onPatchError,
  onDeleted,
  onAddValue,
}: {
  variable: EndingVariable;
  values: EndingVariableValue[];
  folderOptions: FolderTreeOption[];
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
  onDeleted: (id: string) => void;
  /** Editor-owned add: the editor performs the optimistic local insert + the
   *  server call so the new value pops into the list before the round-trip. */
  onAddValue: (variableId: string) => Promise<string | null>;
}) {
  const { setFocus } = usePresenceContext();
  const [pending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  // After a value is created (via plus button or Enter-to-add), this state
  // names the id whose input should autofocus once it mounts. ValueRow
  // watches it and clears via onAutoFocused.
  const [autoFocusValueId, setAutoFocusValueId] = useState<string | null>(null);
  // Optimistic default toggle — paint the star immediately and reconcile
  // when the server echoes the patch back. `undefined` means "no pending
  // override; use the server value".
  const [optimisticDefaultId, setOptimisticDefaultId] = useState<
    string | null | undefined
  >(undefined);
  // Clear the optimistic paint once the server's authoritative value
  // matches what we asked for. "Adjust state in render" pattern
  // satisfies the new react-hooks/set-state-in-effect rule.
  if (
    optimisticDefaultId !== undefined &&
    variable.default_value_id === optimisticDefaultId
  ) {
    setOptimisticDefaultId(undefined);
  }
  const effectiveDefaultId =
    optimisticDefaultId !== undefined
      ? optimisticDefaultId
      : variable.default_value_id;

  const focusKey = (field: string) => ({
    table: VAR_TABLE,
    recordId: variable.id,
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

  const [collidedFrom, setCollidedFrom] = useState<string | null>(null);
  const nameFieldRef = useRef<{ set: (v: string) => void } | null>(null);
  const nameField = useInstantField({
    value: variable.name,
    onCommit: async (v) => {
      const trimmed = v.trim();
      const result = await commit(() =>
        patchEndingVariable(variable.id, { name: v })
      );
      if (result?.collided && result.savedName) {
        setCollidedFrom(trimmed);
        nameFieldRef.current?.set(result.savedName);
      } else {
        setCollidedFrom(null);
      }
    },
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("name") : null),
    onActivity,
  });
  useEffect(() => {
    nameFieldRef.current = nameField;
  });

  const colorField = useInstantField<string | null>({
    value: variable.color_hex,
    onCommit: async (v) => {
      await commit(() => patchEndingVariable(variable.id, { color_hex: v }));
    },
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("color_hex") : null),
    onActivity,
  });

  const defaultField = useInstantField<string | null>({
    value: variable.default_value_id,
    onCommit: async (v) => {
      await commit(() =>
        patchEndingVariable(variable.id, { default_value_id: v })
      );
    },
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("default_value_id") : null),
    onActivity,
  });

  const folderField = useInstantField<string | null>({
    value: variable.folder_id,
    onCommit: async (v) => {
      await commit(() => patchEndingVariable(variable.id, { folder_id: v }));
    },
    onFocusChange: (focused) =>
      setFocus(focused ? focusKey("folder_id") : null),
    onActivity,
  });

  const effectiveColor = colorField.value ?? paletteColor(variable.color_index);
  const dirty =
    nameField.status === "dirty" ||
    nameField.status === "saving" ||
    colorField.status === "dirty" ||
    colorField.status === "saving" ||
    defaultField.status === "dirty" ||
    defaultField.status === "saving" ||
    folderField.status === "dirty" ||
    folderField.status === "saving";

  const sortedValues = useMemo(
    () => [...values].sort((a, b) => a.sort_order - b.sort_order),
    [values]
  );

  async function handleDeleteVariable() {
    const ok = await confirm({
      title: "Delete variable?",
      message: `"${variable.name}" and its values will be permanently removed. References to this variable in condition blocks, logic rules, and letter-action assignments will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", variable.id);
    startTransition(async () => {
      await deleteEndingVariable(fd);
      onDeleted(variable.id);
    });
  }

  function addValue(): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const id = await onAddValue(variable.id);
        if (id) setAutoFocusValueId(id);
        resolve(id);
      });
    });
  }

  function setDefault(valueId: string | null) {
    setOptimisticDefaultId(valueId);
    void commit(() =>
      patchEndingVariable(variable.id, { default_value_id: valueId })
    ).catch(() => {
      // Roll back the optimistic paint on commit error.
      setOptimisticDefaultId(undefined);
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <PanelHeader
        title={nameField.value || "Unnamed variable"}
        icon={
          <Hash size={14} aria-hidden className="text-muted-foreground/70" />
        }
        dirty={dirty}
        showSaved={!dirty}
        menu={
          <OverflowMenu
            items={[
              {
                label: "Delete variable",
                intent: "destructive",
                icon: <Trash2 size={12} aria-hidden />,
                onClick: handleDeleteVariable,
                disabled: pending,
              },
            ]}
          />
        }
      />

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <Label className="!text-xs">Color</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("color_hex")}>
            <label
              aria-label="Variable color"
              className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-start"
            >
              <span
                aria-hidden
                className="block h-5 w-5 rounded-sm border border-border/60"
                style={{ backgroundColor: effectiveColor }}
              />
              <input
                type="color"
                value={effectiveColor}
                onChange={(e) => colorField.set(e.target.value)}
                onFocus={colorField.onFocus}
                onBlur={colorField.onBlur}
                className="absolute inset-0 h-full w-7 cursor-pointer opacity-0"
              />
            </label>
          </FieldHighlight>

          <Label className="!text-xs">Name</Label>
          <div className="flex flex-col gap-1">
            <FieldHighlight peers={peers} focusKey={focusKey("name")}>
              <Input
                value={nameField.value}
                onChange={(e) => {
                  if (collidedFrom !== null) setCollidedFrom(null);
                  nameField.set(e.target.value);
                }}
                onFocus={nameField.onFocus}
                onBlur={nameField.onBlur}
                placeholder="Variable name"
                className={cn(
                  "h-8 min-w-0 font-medium",
                  GHOST_FIELD,
                  !nameField.value.trim() && "ring-2 ring-destructive",
                  nameField.status === "error" && "ring-2 ring-destructive"
                )}
              />
            </FieldHighlight>
            {collidedFrom ? (
              <span
                className="inline-flex items-center self-start rounded-md border border-amber-500/40 bg-amber-500/5 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.025em] text-amber-200"
                title={`The name “${collidedFrom}” was already in use; a number was appended.`}
              >
                Variable with the name “{collidedFrom}” already exists
              </span>
            ) : null}
          </div>

          <Label className="!text-xs">Folder</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("folder_id")}>
            <Select
              value={folderField.value ?? ""}
              onChange={(e) => folderField.set(e.target.value || null)}
              onFocus={folderField.onFocus}
              onBlur={folderField.onBlur}
              aria-label="Folder"
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

          <Label className="!text-xs">Default</Label>
          <FieldHighlight peers={peers} focusKey={focusKey("default_value_id")}>
            <Select
              value={defaultField.value ?? ""}
              onChange={(e) => defaultField.set(e.target.value || null)}
              onFocus={defaultField.onFocus}
              onBlur={defaultField.onBlur}
              aria-label="Default value"
              className={cn("h-8", GHOST_FIELD)}
            >
              <option value="">—</option>
              {sortedValues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.value || "(unnamed)"}
                </option>
              ))}
            </Select>
          </FieldHighlight>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="!text-xs">Values</Label>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              {sortedValues.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-background/40">
            {sortedValues.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                No values yet.
              </p>
            ) : (
              sortedValues.map((val) => (
                <ValueRow
                  key={val.id}
                  val={val}
                  isDefault={effectiveDefaultId === val.id}
                  peers={peers}
                  onActivity={onActivity}
                  onPatchError={onPatchError}
                  onToggleDefault={() =>
                    setDefault(effectiveDefaultId === val.id ? null : val.id)
                  }
                  onAddBelow={addValue}
                  autoFocus={autoFocusValueId === val.id}
                  onAutoFocused={() => setAutoFocusValueId(null)}
                />
              ))
            )}
            <AddValueZone onAdd={addValue} disabled={pending} />
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

function AddValueZone({
  onAdd,
  disabled,
}: {
  onAdd: () => Promise<string | null>;
  disabled?: boolean;
}) {
  return (
    <div className="group/zone relative flex h-9 items-center justify-center border-t border-border">
      <button
        type="button"
        onClick={() => void onAdd()}
        disabled={disabled}
        aria-label="Add value"
        title="Add value"
        className={cn(
          "group/insertbtn inline-flex h-5 w-10 items-center justify-center rounded-md border border-border border-dashed text-muted-foreground transition-[opacity,background-color,border-color,color] duration-200 ease-out",
          "opacity-0 group-hover/zone:opacity-100 focus-visible:opacity-100",
          "hover:border-solid hover:bg-white/10 hover:text-foreground",
          "disabled:opacity-40"
        )}
      >
        <Plus size={12} aria-hidden />
      </button>
    </div>
  );
}

function ValueRow({
  val,
  isDefault,
  peers,
  onActivity,
  onPatchError,
  onToggleDefault,
  onAddBelow,
  autoFocus,
  onAutoFocused,
}: {
  val: EndingVariableValue;
  isDefault: boolean;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
  onToggleDefault: () => void;
  onAddBelow: () => Promise<string | null>;
  autoFocus: boolean;
  onAutoFocused: () => void;
}) {
  const { setFocus } = usePresenceContext();
  const [pending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);

  const valueField = useInstantField({
    value: val.value,
    onCommit: async (v) => {
      try {
        await patchEndingVariableValue(val.id, { value: v });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed.";
        onPatchError(msg);
        throw err;
      }
    },
    onFocusChange: (focused) =>
      setFocus(focused ? { table: VALUE_TABLE, recordId: val.id, field: "value" } : null),
    onActivity,
  });

  // Autofocus when this row is the newly-created one (set by the parent
  // after createEndingVariableValue resolves). Effect waits one frame so
  // mount + ref attach complete before we focus.
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    onAutoFocused();
  }, [autoFocus, onAutoFocused]);

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete value?",
      message: `"${val.value}" will be permanently removed. References to this value in condition blocks, logic rules, and letter-action assignments will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", val.id);
    startTransition(() => deleteEndingVariableValue(fd));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Blur first so useInstantField's onBlur flushes any pending edit
    // before we hand focus to the freshly-added row.
    inputRef.current?.blur();
    void onAddBelow();
  }

  return (
    <div
      className={cn(
        "group/value grid grid-cols-[20px_1fr_20px] items-center gap-2 border-t border-border px-3 py-1 first:border-t-0 transition-colors",
        isDefault && "bg-accent/10",
        // Subtle row tint on hover so it reads as "clickable to edit"
        // without forcing a heavy input look at rest.
        "hover:bg-accent/10"
      )}
    >
      <button
        type="button"
        onClick={onToggleDefault}
        aria-label={isDefault ? "Clear default value" : "Set as default value"}
        title={isDefault ? "Default value" : "Set as default"}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-[opacity,color] hover:text-foreground",
          isDefault
            ? "opacity-100 text-amber-400 hover:text-amber-300"
            : "opacity-0 group-hover/value:opacity-60 focus-visible:opacity-100"
        )}
      >
        <Star
          size={13}
          aria-hidden
          fill={isDefault ? "currentColor" : "none"}
        />
      </button>
      <FieldHighlight
        peers={peers}
        focusKey={{ table: VALUE_TABLE, recordId: val.id, field: "value" }}
      >
        <Input
          ref={inputRef}
          value={valueField.value}
          onChange={(e) => valueField.set(e.target.value)}
          onFocus={valueField.onFocus}
          onBlur={valueField.onBlur}
          onKeyDown={onKeyDown}
          placeholder="Value"
          // Resting state is invisible — the row reads like text. The dark
          // input fill only appears on focus, so clicking to edit reveals
          // the input box.
          className={cn(
            "h-7 border-transparent bg-transparent shadow-none focus:border-border focus:bg-black/50 focus-visible:bg-black/50 focus-visible:shadow-sm",
            !valueField.value.trim() && "ring-2 ring-destructive",
            valueField.status === "error" && "ring-2 ring-destructive"
          )}
        />
      </FieldHighlight>
      <button
        type="button"
        disabled={pending}
        aria-label="Delete value"
        title="Delete value"
        onClick={handleDelete}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-[opacity,background-color,color] hover:bg-destructive/15 hover:text-destructive",
          "opacity-0 group-hover/value:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
        )}
      >
        <X size={13} aria-hidden />
      </button>
      {confirmDialog}
    </div>
  );
}
