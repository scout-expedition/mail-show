"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/confirm-dialog";
import {
  GHOST_FIELD,
  MUTED_ADD_BTN,
  PanelHeader,
  SaveRevert,
  Spinner,
} from "@/components/panel";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import type {
  EndingFramework,
  EndingLogicRuleCondition,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import {
  createEndingVariable,
  createEndingVariableValue,
  deleteEndingVariable,
  deleteEndingVariableValue,
  updateAllEndingVariables,
} from "./actions";

type ValueState = { id: string; value: string; sort_order: number };

type VariableState = {
  id: string;
  name: string;
  default_value_id: string | null;
  sort_order: number;
  color_index: number;
  values: ValueState[];
};

export function VariablesEditor({
  variables,
  values,
  frameworks,
  frameworkVariableRefs,
  logicConditions,
}: {
  variables: EndingVariable[];
  values: EndingVariableValue[];
  frameworks: EndingFramework[];
  frameworkVariableRefs: Array<{ framework_id: string; variable_id: string }>;
  logicConditions: Array<Pick<EndingLogicRuleCondition, "variable_id">>;
}) {
  const initial = useMemo<VariableState[]>(() => {
    const byVar = new Map<string, ValueState[]>();
    for (const v of values) {
      const list = byVar.get(v.variable_id) ?? [];
      list.push({ id: v.id, value: v.value, sort_order: v.sort_order });
      byVar.set(v.variable_id, list);
    }
    for (const list of byVar.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
    }
    // Hide number_ref variables — they're seeded by migration 0016 and
    // surfaced only inside the frameworks chip picker.
    return variables
      .filter((v) => v.kind === "text")
      .map((v) => ({
        id: v.id,
        name: v.name,
        default_value_id: v.default_value_id,
        sort_order: v.sort_order,
        color_index: v.color_index,
        values: byVar.get(v.id) ?? [],
      }));
  }, [variables, values]);

  const [rows, setRows] = useState<VariableState[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, startSave] = useTransition();

  // Reconcile server state, preserving local edits.
  useEffect(() => {
    if (!dirty) {
      setRows(initial);
      return;
    }
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const initialIds = new Set(initial.map((r) => r.id));
      const kept = prev.filter((r) => initialIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      // Merge in new values that server has but prev didn't
      const merged = kept.map((r) => {
        const serverR = initial.find((s) => s.id === r.id)!;
        const prevValIds = new Set(r.values.map((v) => v.id));
        const serverValIds = new Set(serverR.values.map((v) => v.id));
        // Drop local values removed on server; add server-only values.
        const keptVals = r.values.filter((v) => serverValIds.has(v.id));
        const addedVals = serverR.values.filter((v) => !prevValIds.has(v.id));
        return { ...r, values: [...keptVals, ...addedVals] };
      });
      const additions = initial.filter((s) => !prevById.has(s.id));
      if (additions.length === 0 && merged.length === prev.length) {
        // Check whether we actually changed anything — if not, skip update.
        const same =
          merged.every(
            (r, i) =>
              r.id === prev[i].id && r.values.length === prev[i].values.length
          ) &&
          merged.every((r) => r.values.every((_, i) => true));
        if (same) return prev;
      }
      return [...merged, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }, [initial, dirty]);

  function updateVariable(id: string, patch: Partial<VariableState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function updateValue(varId: string, valId: string, text: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === varId
          ? {
              ...r,
              values: r.values.map((v) =>
                v.id === valId ? { ...v, value: text } : v
              ),
            }
          : r
      )
    );
    setDirty(true);
  }

  function revert() {
    setRows(initial);
    setDirty(false);
  }

  function save() {
    const payload = rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      default_value_id: r.default_value_id,
      sort_order: i,
      values: r.values.map((v, j) => ({
        id: v.id,
        value: v.value,
        sort_order: j,
      })),
    }));
    startSave(async () => {
      await updateAllEndingVariables(payload);
      setDirty(false);
    });
  }

  const anyBlocked = rows.some(
    (r) => !r.name.trim() || r.values.some((v) => !v.value.trim())
  );

  // Index of variable_id → which panels it appears in.
  const variableRefs = useMemo(() => {
    const byFramework = new Map<string, Set<string>>();
    for (const ref of frameworkVariableRefs) {
      const set = byFramework.get(ref.framework_id) ?? new Set<string>();
      set.add(ref.variable_id);
      byFramework.set(ref.framework_id, set);
    }
    const logicIds = new Set(
      logicConditions.map((c) => c.variable_id).filter(Boolean)
    );
    return { byFramework, logicIds };
  }, [frameworkVariableRefs, logicConditions]);

  const allReferencedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of variableRefs.byFramework.values())
      for (const id of s) ids.add(id);
    for (const id of variableRefs.logicIds) ids.add(id);
    return ids;
  }, [variableRefs]);

  const frameworkPanels = frameworks
    .map((f) => {
      const ids = variableRefs.byFramework.get(f.id) ?? new Set<string>();
      return {
        key: `framework:${f.id}`,
        title: `Used in: ${f.name}`,
        rows: rows.filter((r) => ids.has(r.id)),
      };
    })
    .filter((p) => p.rows.length > 0);

  const logicPanel = {
    key: "logic",
    title: "Used in ending logic",
    rows: rows.filter((r) => variableRefs.logicIds.has(r.id)),
  };

  const unreferencedPanel = {
    key: "unreferenced",
    title: "Unreferenced",
    rows: rows.filter((r) => !allReferencedIds.has(r.id)),
  };

  const panels = [
    ...frameworkPanels,
    ...(logicPanel.rows.length > 0 ? [logicPanel] : []),
    unreferencedPanel,
  ];

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2">
        {anyBlocked ? (
          <span className="text-xs text-destructive">
            Fill in every name and value to save.
          </span>
        ) : null}
        <SaveRevert
          dirty={dirty && !anyBlocked}
          pending={pending}
          onSave={save}
          onRevert={revert}
        />
      </div>

      <div className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No ending variables yet.
          </p>
        ) : null}

        {rows.length > 0
          ? panels.map((panel) => (
              <GroupPanel
                key={panel.key}
                title={panel.title}
                rows={panel.rows}
                onChangeName={(id, name) => updateVariable(id, { name })}
                onChangeDefault={(id, vid) =>
                  updateVariable(id, { default_value_id: vid })
                }
                onChangeValue={updateValue}
              />
            ))
          : null}
      </div>

      <div className="mt-4 flex justify-center">
        <form action={createEndingVariable}>
          <Button type="submit" variant="outline" size="sm">
            + Variable
          </Button>
        </form>
      </div>
    </>
  );
}

function GroupPanel({
  title,
  rows,
  onChangeName,
  onChangeDefault,
  onChangeValue,
}: {
  title: string;
  rows: VariableState[];
  onChangeName: (id: string, name: string) => void;
  onChangeDefault: (id: string, vid: string | null) => void;
  onChangeValue: (varId: string, valId: string, text: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader title={title} />
      <div className="flex flex-col gap-3 p-3">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
            None.
          </p>
        ) : null}
        {rows.map((row) => (
          <VariableCard
            key={row.id}
            row={row}
            onChangeName={(name) => onChangeName(row.id, name)}
            onChangeDefault={(vid) => onChangeDefault(row.id, vid)}
            onChangeValue={(valId, text) => onChangeValue(row.id, valId, text)}
          />
        ))}
      </div>
    </section>
  );
}

function VariableCard({
  row,
  onChangeName,
  onChangeDefault,
  onChangeValue,
}: {
  row: VariableState;
  onChangeName: (name: string) => void;
  onChangeDefault: (valId: string | null) => void;
  onChangeValue: (valId: string, text: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  async function confirmDeleteVariable() {
    const ok = await confirmDialog({
      title: "Delete variable?",
      message: `"${row.name}" and its values will be permanently removed, along with any ending logic, condition blocks, or letter-action assignments that use them.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(() => deleteEndingVariable(fd));
  }

  async function confirmDeleteValue(valId: string, valText: string) {
    const ok = await confirmDialog({
      title: "Delete value?",
      message: `"${valText}" will be permanently removed. Column children of condition blocks referencing this value, logic rules, and letter-action assignments will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", valId);
    startTransition(() => deleteEndingVariableValue(fd));
  }

  function addValue() {
    const fd = new FormData();
    fd.set("variable_id", row.id);
    startTransition(() => createEndingVariableValue(fd));
  }

  return (
    <div className="rounded-md border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-3 py-1.5">
        <span
          aria-label="Variable color"
          title="Auto-assigned color (used for chips in the frameworks editor)"
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-border/60"
          style={{ backgroundColor: paletteColor(row.color_index) }}
        />
        <Input
          value={row.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Variable name"
          className={cn(
            "h-8 font-medium",
            GHOST_FIELD,
            !row.name.trim() && "ring-2 ring-destructive"
          )}
        />
        <button
          type="button"
          disabled={pending}
          aria-label="Delete variable"
          title="Delete variable"
          onClick={confirmDeleteVariable}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-[60px_1fr_36px] items-center gap-2 border-b border-border/40 bg-muted/10 px-3 py-1">
        <Label className="!text-xs">Default</Label>
        <Label className="!text-xs">Value</Label>
        <span />
      </div>

      {row.values.length === 0 ? (
        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
          No values yet.
        </p>
      ) : (
        row.values.map((val) => (
          <div
            key={val.id}
            className="grid grid-cols-[60px_1fr_36px] items-center gap-2 border-t border-border/40 px-3 py-1 first:border-t-0"
          >
            <label className="flex h-8 items-center justify-center">
              <input
                type="radio"
                name={`default__${row.id}`}
                checked={row.default_value_id === val.id}
                onChange={() => onChangeDefault(val.id)}
                className="h-4 w-4 accent-primary"
              />
            </label>
            <Input
              value={val.value}
              onChange={(e) => onChangeValue(val.id, e.target.value)}
              placeholder="Value"
              className={cn(
                "h-8",
                GHOST_FIELD,
                !val.value.trim() && "ring-2 ring-destructive"
              )}
            />
            <button
              type="button"
              disabled={pending}
              aria-label="Delete value"
              title="Delete value"
              onClick={() => confirmDeleteValue(val.id, val.value)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </div>
        ))
      )}

      <div className="flex justify-center border-t border-border/40 bg-muted/5 px-3 py-1.5">
        <button
          type="button"
          onClick={addValue}
          disabled={pending}
          className={MUTED_ADD_BTN}
        >
          {pending ? (
            <>
              <Spinner />
              …
            </>
          ) : (
            "+ Value"
          )}
        </button>
      </div>
      {confirmDialogEl}
    </div>
  );
}
