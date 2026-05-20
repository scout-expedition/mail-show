"use client";

// "+ New variable…" popover for the endings frameworks/logic editors.
// Opens in a draft state collecting name + first value + color + folder.
// On submit it calls createEndingVariableInline and transitions to
// VariableInspector (the same side-panel form used on /endings/variables)
// so the author can keep editing the new variable without leaving the
// popover.
//
// Lifecycle hygiene: useInstantField inside VariableInspector fires
// presence focus signals and a debounced commit on each field. Before
// the popover unmounts we blur whatever inside it currently has focus
// so the field's onBlur path flushes the pending commit and clears
// presence focus. Without that, dismissing the popover mid-edit could
// leave the inspector's `setFocus(true)` permanently latched on the
// channel.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PanelHeader } from "@/components/panel";
import { cn } from "@/lib/utils";
import { colorIndexFor, paletteColor } from "@/lib/endings/color-palette";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import type {
  EndingVariable,
  EndingVariableFolder,
  EndingVariableValue,
} from "@/lib/db/types";
import {
  createEndingVariableInline,
  createEndingVariableValueInline,
} from "../variables/actions";
import { buildFolderOptions } from "../variables/folder-tree";
import { VariableInspector } from "../variables/variable-inspector";

export interface CreateVariablePopoverProps {
  /** Anchor coords (viewport-relative). Caller computes from the
   *  trigger's getBoundingClientRect(). */
  position: { top: number; left: number };
  folders: ReadonlyArray<EndingVariableFolder>;
  /** Folder to pre-select on the form. null = root. */
  initialFolderId?: string | null;
  /** Optimistic snapshot of the variables the caller has in memory.
   *  After create, VariableInspector pulls live data from the DB via
   *  its own presence/realtime path; we just need the seed row. */
  onClose: () => void;
  /** Fires after a successful create. Caller typically uses this to
   *  commit the new variable into the surrounding picker context
   *  (insert mention pill, add header chip, etc.). Receives both the
   *  id (for add-block-variable / onPick) and the name (for surfaces
   *  that need to render the variable immediately, e.g. the Lexical
   *  mention pill, since the parent's `variables` prop may not yet
   *  reflect the revalidated DB row). */
  onCreated: (result: { variableId: string; name: string }) => void;
}

type Phase =
  | { stage: "draft" }
  | {
      stage: "inspect";
      variable: EndingVariable;
      values: EndingVariableValue[];
    };

export function CreateVariablePopover({
  position,
  folders,
  initialFolderId,
  onClose,
  onCreated,
}: CreateVariablePopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ stage: "draft" });
  const [name, setName] = useState("");
  const [firstValue, setFirstValue] = useState("");
  const [folderId, setFolderId] = useState<string | null>(
    initialFolderId ?? null
  );
  const [color, setColor] = useState<string>(() =>
    paletteColor(Math.floor(Math.random() * 12))
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  // Position styles — fixed so caller-supplied viewport coords work
  // without a positioned parent. Same pattern as MentionAutocompletePopup.
  const positionStyle: CSSProperties = useMemo(
    () => ({
      position: "fixed",
      top: position.top,
      left: position.left,
      zIndex: 30,
    }),
    [position.top, position.left]
  );

  const handleClose = useCallback(() => {
    // Blur the focused field first so useInstantField inside
    // VariableInspector flushes any pending commit before unmount and
    // clears its presence focus signal.
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
      active.blur();
    }
    // If we already created the variable, hand it back to the caller.
    if (phase.stage === "inspect") {
      onCreated({
        variableId: phase.variable.id,
        name: phase.variable.name,
      });
    }
    onClose();
  }, [onClose, onCreated, phase]);

  // Click-outside + Esc close. Skip while a create transition is in
  // flight so a misaimed click doesn't strand a half-submitted form.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (pending) return;
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      handleClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pending) return;
        handleClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pending, handleClose]);

  function submit() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedValue = firstValue.trim();
    if (!trimmedName || !trimmedValue) return;
    const folder_id = folderId;
    const color_hex = color.toLowerCase();
    startTransition(async () => {
      try {
        const { variableId, valueId } = await createEndingVariableInline({
          name: trimmedName,
          firstValue: trimmedValue,
          folder_id,
          color_hex,
        });
        // Seed the inspector with what we just inserted. Realtime echo
        // will overlay any peer edits on top after mount.
        const seedVariable: EndingVariable = {
          id: variableId,
          name: trimmedName,
          default_value_id: valueId,
          sort_order: 0,
          kind: "text",
          number_ref: null,
          aggregate_ref: null,
          smart_variable_doc_id: null,
          color_index: colorIndexFor(variableId),
          color_hex,
          folder_id,
          created_at: new Date().toISOString(),
        };
        const seedValues: EndingVariableValue[] = [
          {
            id: valueId,
            variable_id: variableId,
            value: trimmedValue,
            sort_order: 0,
          },
        ];
        setPhase({ stage: "inspect", variable: seedVariable, values: seedValues });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Create failed.");
      }
    });
  }

  if (phase.stage === "draft") {
    const canSubmit =
      !pending && name.trim().length > 0 && firstValue.trim().length > 0;
    return (
      <div
        ref={rootRef}
        style={positionStyle}
        role="dialog"
        aria-label="New variable"
        className="w-80 rounded-md border border-border bg-popover shadow-lg"
      >
        <PanelHeader
          title="New variable"
          icon={<Hash size={14} aria-hidden className="text-muted-foreground/70" />}
        />
        <div className="space-y-3 p-3 text-xs">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            <Label className="!text-xs">Color</Label>
            <label
              aria-label="Variable color"
              className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-start"
            >
              <span
                aria-hidden
                className="block h-5 w-5 rounded-sm border border-border/60"
                style={{ backgroundColor: color }}
              />
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 h-full w-7 cursor-pointer opacity-0"
              />
            </label>
            <Label className="!text-xs">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Variable name"
              disabled={pending}
              className="h-8"
            />
            <Label className="!text-xs">Folder</Label>
            <Select
              value={folderId ?? ""}
              onChange={(e) => setFolderId(e.target.value || null)}
              disabled={pending}
              aria-label="Folder"
              className="h-8"
            >
              <option value="">— (root)</option>
              {folderOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <Label className="!text-xs">First value</Label>
            <Input
              value={firstValue}
              onChange={(e) => setFirstValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="e.g. happy"
              disabled={pending}
              className="h-8"
            />
          </div>
          {error ? (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                "rounded-md border border-primary bg-primary/10 px-2 py-1 text-xs text-primary",
                "hover:bg-primary/20 disabled:opacity-50"
              )}
            >
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // phase === "inspect": render the live inspector so the author can
  // keep editing (more values, default, name, folder, etc).
  return (
    <div
      ref={rootRef}
      style={positionStyle}
      role="dialog"
      aria-label="Edit new variable"
      className="w-80"
    >
      <InspectorHost
        variable={phase.variable}
        values={phase.values}
        folders={folders}
        onClose={handleClose}
      />
    </div>
  );
}

function InspectorHost({
  variable,
  values: initialValues,
  folders,
  onClose,
}: {
  variable: EndingVariable;
  values: EndingVariableValue[];
  folders: ReadonlyArray<EndingVariableFolder>;
  onClose: () => void;
}) {
  const { peers } = usePresenceContext();
  // Local mirror of the value list — adding a value via the inspector's
  // "+ Add value" affordance lands here so the new row appears
  // immediately without a server round-trip into the popover state.
  const [values, setValues] = useState<EndingVariableValue[]>(initialValues);
  const [, startTransition] = useTransition();
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  const handleAddValue = useCallback(
    (variableId: string): Promise<string | null> =>
      new Promise((resolve) => {
        startTransition(async () => {
          try {
            const { valueId } = await createEndingVariableValueInline({
              variable_id: variableId,
              value: "New value",
            });
            setValues((prev) => [
              ...prev,
              {
                id: valueId,
                variable_id: variableId,
                value: "New value",
                sort_order: prev.length,
              },
            ]);
            resolve(valueId);
          } catch {
            resolve(null);
          }
        });
      }),
    []
  );

  return (
    <div className="rounded-md border border-border bg-popover shadow-lg">
      <VariableInspector
        variable={variable}
        values={values}
        folderOptions={folderOptions}
        peers={peers}
        onActivity={() => {}}
        onPatchError={() => {}}
        onDeleted={onClose}
        onAddValue={handleAddValue}
      />
      <div className="flex justify-end gap-2 border-t border-border/60 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-primary bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"
        >
          Done
        </button>
      </div>
    </div>
  );
}
