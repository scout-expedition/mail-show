"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { useLocalStorage } from "@/lib/use-local-storage";
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
  color_hex: string | null;
  created_at: string;
  values: ValueState[];
};

type ViewMode = "grouped" | "list";
type SortMode = "created_desc" | "alpha_asc";

const VIEW_KEY = "endings-variables-view";
const SORT_KEY = "endings-variables-sort";

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
    return variables
      .filter((v) => v.kind === "text")
      .map((v) => ({
        id: v.id,
        name: v.name,
        default_value_id: v.default_value_id,
        sort_order: v.sort_order,
        color_index: v.color_index,
        color_hex: v.color_hex,
        created_at: v.created_at,
        values: byVar.get(v.id) ?? [],
      }));
  }, [variables, values]);

  const [rows, setRows] = useState<VariableState[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, startSave] = useTransition();
  const [view, setView] = useLocalStorage<ViewMode>(VIEW_KEY, "grouped");
  const [sort, setSort] = useLocalStorage<SortMode>(SORT_KEY, "created_desc");
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedVars, setExpandedVars] = useState<Set<string>>(
    () => new Set()
  );

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
      const merged = kept.map((r) => {
        const serverR = initial.find((s) => s.id === r.id)!;
        const prevValIds = new Set(r.values.map((v) => v.id));
        const serverValIds = new Set(serverR.values.map((v) => v.id));
        const keptVals = r.values.filter((v) => serverValIds.has(v.id));
        const addedVals = serverR.values.filter((v) => !prevValIds.has(v.id));
        return { ...r, values: [...keptVals, ...addedVals] };
      });
      const additions = initial.filter((s) => !prevById.has(s.id));
      if (additions.length === 0 && merged.length === prev.length) {
        const same = merged.every(
          (r, i) =>
            r.id === prev[i].id && r.values.length === prev[i].values.length
        );
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
      color_hex: r.color_hex,
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

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    if (sort === "alpha_asc") {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // created_desc — most-recent first.
      copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return copy;
  }, [rows, sort]);

  function togglePanel(key: string) {
    setCollapsedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVariable(id: string) {
    setExpandedVars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="View"
            className="inline-flex rounded-md border border-border bg-card text-xs"
          >
            {(
              [
                { id: "grouped", label: "Grouped" },
                { id: "list", label: "List" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={view === opt.id}
                onClick={() => setView(opt.id)}
                className={cn(
                  "px-3 py-1 transition-colors",
                  view === opt.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/40"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {view === "list" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sort
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                className={cn("h-7 w-auto", GHOST_FIELD)}
              >
                <option value="created_desc">Created (newest first)</option>
                <option value="alpha_asc">Name (A → Z)</option>
              </Select>
            </label>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      <div className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No ending variables yet.
          </p>
        ) : view === "grouped" ? (
          panels.map((panel) => (
            <GroupPanel
              key={panel.key}
              title={panel.title}
              rows={panel.rows}
              collapsed={collapsedPanels.has(panel.key)}
              onToggle={() => togglePanel(panel.key)}
              expandedIds={expandedVars}
              onToggleVariable={toggleVariable}
              onChangeName={(id, name) => updateVariable(id, { name })}
              onChangeDefault={(id, vid) =>
                updateVariable(id, { default_value_id: vid })
              }
              onChangeColor={(id, hex) =>
                updateVariable(id, { color_hex: hex })
              }
              onChangeValue={updateValue}
            />
          ))
        ) : (
          <ListView
            rows={sortedRows}
            expandedIds={expandedVars}
            onToggleVariable={toggleVariable}
            onChangeName={(id, name) => updateVariable(id, { name })}
            onChangeDefault={(id, vid) =>
              updateVariable(id, { default_value_id: vid })
            }
            onChangeColor={(id, hex) => updateVariable(id, { color_hex: hex })}
            onChangeValue={updateValue}
          />
        )}
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
  collapsed,
  onToggle,
  expandedIds,
  onToggleVariable,
  onChangeName,
  onChangeDefault,
  onChangeColor,
  onChangeValue,
}: {
  title: string;
  rows: VariableState[];
  collapsed: boolean;
  onToggle: () => void;
  expandedIds: Set<string>;
  onToggleVariable: (id: string) => void;
  onChangeName: (id: string, name: string) => void;
  onChangeDefault: (id: string, vid: string | null) => void;
  onChangeColor: (id: string, hex: string | null) => void;
  onChangeValue: (varId: string, valId: string, text: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          aria-hidden
          className="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <PanelHeader title={`${title} (${rows.length})`} />
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-2 p-3">
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
              None.
            </p>
          ) : null}
          {rows.map((row) => (
            <VariableCard
              key={row.id}
              row={row}
              expanded={expandedIds.has(row.id)}
              onToggle={() => onToggleVariable(row.id)}
              onChangeName={(name) => onChangeName(row.id, name)}
              onChangeDefault={(vid) => onChangeDefault(row.id, vid)}
              onChangeColor={(hex) => onChangeColor(row.id, hex)}
              onChangeValue={(valId, text) => onChangeValue(row.id, valId, text)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ListView({
  rows,
  expandedIds,
  onToggleVariable,
  onChangeName,
  onChangeDefault,
  onChangeColor,
  onChangeValue,
}: {
  rows: VariableState[];
  expandedIds: Set<string>;
  onToggleVariable: (id: string) => void;
  onChangeName: (id: string, name: string) => void;
  onChangeDefault: (id: string, vid: string | null) => void;
  onChangeColor: (id: string, hex: string | null) => void;
  onChangeValue: (varId: string, valId: string, text: string) => void;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <VariableCard
            key={row.id}
            row={row}
            expanded={expandedIds.has(row.id)}
            onToggle={() => onToggleVariable(row.id)}
            onChangeName={(name) => onChangeName(row.id, name)}
            onChangeDefault={(vid) => onChangeDefault(row.id, vid)}
            onChangeColor={(hex) => onChangeColor(row.id, hex)}
            onChangeValue={(valId, text) => onChangeValue(row.id, valId, text)}
          />
        ))}
      </div>
    </section>
  );
}

function VariableCard({
  row,
  expanded,
  onToggle,
  onChangeName,
  onChangeDefault,
  onChangeColor,
  onChangeValue,
}: {
  row: VariableState;
  expanded: boolean;
  onToggle: () => void;
  onChangeName: (name: string) => void;
  onChangeDefault: (valId: string | null) => void;
  onChangeColor: (hex: string | null) => void;
  onChangeValue: (valId: string, text: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  const effectiveColor = row.color_hex ?? paletteColor(row.color_index);

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
      <div className="grid grid-cols-[24px_20px_minmax(0,1fr)_auto_minmax(140px,200px)_28px] items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse variable" : "Expand variable"}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/40"
        >
          {expanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
        </button>
        <label
          aria-label="Variable color"
          title="Variable color (used for chips in the frameworks editor)"
          className="relative inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
        >
          <span
            aria-hidden
            className="block h-4 w-4 rounded-sm border border-border/60"
            style={{ backgroundColor: effectiveColor }}
          />
          <input
            type="color"
            value={effectiveColor}
            onChange={(e) => onChangeColor(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={row.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Variable name"
          className={cn(
            "h-8 min-w-0 font-medium",
            GHOST_FIELD,
            !row.name.trim() && "ring-2 ring-destructive"
          )}
        />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Default
        </span>
        <Select
          value={row.default_value_id ?? ""}
          onChange={(e) => onChangeDefault(e.target.value || null)}
          aria-label="Default value"
          className={cn("h-8 w-full", GHOST_FIELD)}
        >
          <option value="">—</option>
          {row.values.map((v) => (
            <option key={v.id} value={v.id}>
              {v.value || "(unnamed)"}
            </option>
          ))}
        </Select>
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

      {expanded ? (
        <div className="border-t border-border/40">
          {row.color_hex ? (
            <div className="flex items-center justify-end px-3 py-1 text-[10px] text-muted-foreground/70">
              <button
                type="button"
                onClick={() => onChangeColor(null)}
                title="Clear custom color (use palette default)"
                className="uppercase tracking-widest hover:text-foreground"
              >
                reset color
              </button>
            </div>
          ) : null}
          {row.values.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">
              No values yet.
            </p>
          ) : (
            row.values.map((val) => (
              <div
                key={val.id}
                className="grid grid-cols-[1fr_36px] items-center gap-2 border-t border-border/30 px-3 py-1 first:border-t-0"
              >
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
          <div className="flex justify-center border-t border-border/30 bg-muted/5 px-3 py-1.5">
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
        </div>
      ) : null}
      {confirmDialogEl}
    </div>
  );
}
