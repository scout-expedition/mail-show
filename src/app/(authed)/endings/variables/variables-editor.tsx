"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import {
  GHOST_FIELD,
  MUTED_ADD_BTN,
  PanelHeader,
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
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PresencePeer, PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import {
  createEndingVariable,
  createEndingVariableValue,
  deleteEndingVariable,
  deleteEndingVariableValue,
  patchEndingVariable,
  patchEndingVariableValue,
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

const VAR_TABLE = "ending_variables";
const VALUE_TABLE = "ending_variable_values";

export function VariablesEditor({
  variables,
  values,
  frameworks,
  frameworkVariableRefs,
  logicConditions,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  variables: EndingVariable[];
  values: EndingVariableValue[];
  frameworks: EndingFramework[];
  frameworkVariableRefs: Array<{ framework_id: string; variable_id: string }>;
  logicConditions: Array<Pick<EndingLogicRuleCondition, "variable_id">>;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="endings-variables"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[VAR_TABLE, VALUE_TABLE]}
    >
      <VariablesEditorInner
        variables={variables}
        values={values}
        frameworks={frameworks}
        frameworkVariableRefs={frameworkVariableRefs}
        logicConditions={logicConditions}
      />
    </WorkspacePresenceProvider>
  );
}

function VariablesEditorInner({
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
  const router = useRouter();
  const { peers, onPostgresChanges, pingActivity } = usePresenceContext();
  const { toast, toaster } = useToast();

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

  // Local mirror — seeded from server props, reconciled by server-prop
  // changes (structural revalidate on create/delete) AND by postgres_changes
  // (column-level updates from peer edits). Per-field typed text lives inside
  // each child VariableCard's useInstantField hooks; the mirror only carries
  // server-authoritative values.
  const [rows, setRows] = useState<VariableState[]>(initial);

  // Server-prop reconcile: preserve local order for kept rows; append new
  // rows; drop deleted rows. Uses the "adjust state in render" pattern.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const initialIds = new Set(initial.map((r) => r.id));
      const kept = prev.filter((r) => initialIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      const additions = initial.filter((s) => !prevById.has(s.id));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }

  // postgres_changes handler — merges column-level updates from peers.
  // INSERT triggers router.refresh() so server-derived joins (variable refs)
  // recompute. DELETE splices locally so the user doesn't see a phantom row
  // until the next nav.
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table === VAR_TABLE) {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingVariable;
          if (updated.kind !== "text") return;
          setRows((prev) =>
            prev.map((r) =>
              r.id === updated.id
                ? {
                    ...r,
                    name: updated.name,
                    default_value_id: updated.default_value_id,
                    sort_order: updated.sort_order,
                    color_index: updated.color_index,
                    color_hex: updated.color_hex,
                  }
                : r
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setRows((prev) => prev.filter((r) => r.id !== deleted.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingVariable;
          if (inserted.kind !== "text") return;
          startTransition(() => router.refresh());
        }
        return;
      }
      if (change.table === VALUE_TABLE) {
        if (change.eventType === "UPDATE" && change.new) {
          const v = change.new as unknown as EndingVariableValue;
          setRows((prev) =>
            prev.map((r) =>
              r.id === v.variable_id
                ? {
                    ...r,
                    values: r.values.map((existing) =>
                      existing.id === v.id
                        ? {
                            ...existing,
                            value: v.value,
                            sort_order: v.sort_order,
                          }
                        : existing
                    ),
                  }
                : r
            )
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const old = change.old as unknown as { id: string };
          setRows((prev) =>
            prev.map((r) => ({
              ...r,
              values: r.values.filter((v) => v.id !== old.id),
            }))
          );
        } else if (change.eventType === "INSERT" && change.new) {
          const v = change.new as unknown as EndingVariableValue;
          setRows((prev) =>
            prev.map((r) =>
              r.id === v.variable_id
                ? {
                    ...r,
                    values: r.values.some((x) => x.id === v.id)
                      ? r.values
                      : [
                          ...r.values,
                          {
                            id: v.id,
                            value: v.value,
                            sort_order: v.sort_order,
                          },
                        ].sort((a, b) => a.sort_order - b.sort_order),
                  }
                : r
            )
          );
        }
      }
    });
  }, [onPostgresChanges, router]);

  const [view, setView] = useLocalStorage<ViewMode>(VIEW_KEY, "grouped");
  const [sort, setSort] = useLocalStorage<SortMode>(SORT_KEY, "created_desc");
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedVars, setExpandedVars] = useState<Set<string>>(() => new Set());

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
      {toaster}
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
              peers={peers}
              onActivity={pingActivity}
              onPatchError={(msg) => toast({ message: msg, intent: "destructive" })}
            />
          ))
        ) : (
          <ListView
            rows={sortedRows}
            expandedIds={expandedVars}
            onToggleVariable={toggleVariable}
            peers={peers}
            onActivity={pingActivity}
            onPatchError={(msg) => toast({ message: msg, intent: "destructive" })}
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
  peers,
  onActivity,
  onPatchError,
}: {
  title: string;
  rows: VariableState[];
  collapsed: boolean;
  onToggle: () => void;
  expandedIds: Set<string>;
  onToggleVariable: (id: string) => void;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
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
              peers={peers}
              onActivity={onActivity}
              onPatchError={onPatchError}
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
  peers,
  onActivity,
  onPatchError,
}: {
  rows: VariableState[];
  expandedIds: Set<string>;
  onToggleVariable: (id: string) => void;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
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
            peers={peers}
            onActivity={onActivity}
            onPatchError={onPatchError}
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
  peers,
  onActivity,
  onPatchError,
}: {
  row: VariableState;
  expanded: boolean;
  onToggle: () => void;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
}) {
  const { setFocus } = usePresenceContext();
  const [pending, startDeleteTransition] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

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
    value: row.name,
    onCommit: (v) => commit(() => patchEndingVariable(row.id, { name: v })),
    onFocusChange: (focused) => {
      setFocus(
        focused ? { table: VAR_TABLE, recordId: row.id, field: "name" } : null
      );
    },
    onActivity,
  });

  const defaultField = useInstantField<string | null>({
    value: row.default_value_id,
    onCommit: (v) =>
      commit(() => patchEndingVariable(row.id, { default_value_id: v })),
    onFocusChange: (focused) => {
      setFocus(
        focused
          ? { table: VAR_TABLE, recordId: row.id, field: "default_value_id" }
          : null
      );
    },
    onActivity,
  });

  const colorField = useInstantField<string | null>({
    value: row.color_hex,
    onCommit: (v) =>
      commit(() => patchEndingVariable(row.id, { color_hex: v })),
    onFocusChange: (focused) => {
      setFocus(
        focused ? { table: VAR_TABLE, recordId: row.id, field: "color_hex" } : null
      );
    },
    onActivity,
  });

  const effectiveColor = colorField.value ?? paletteColor(row.color_index);

  // Force-expand when a peer is focused on any of this row's nested values
  // so the FieldHighlight rings have an element to render against. Peer
  // focus on the variable row itself (name/default/color) is always visible
  // because the row chrome is always rendered.
  const valueIds = useMemo(
    () => new Set(row.values.map((v) => v.id)),
    [row.values]
  );
  const peerOnValueHere = peers.some(
    (p) => p.focus?.table === VALUE_TABLE && p.focus && valueIds.has(p.focus.recordId)
  );
  const showValues = expanded || peerOnValueHere;

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
    startDeleteTransition(() => deleteEndingVariable(fd));
  }

  function addValue() {
    const fd = new FormData();
    fd.set("variable_id", row.id);
    startDeleteTransition(() => createEndingVariableValue(fd));
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
        <FieldHighlight
          peers={peers}
          focusKey={{ table: VAR_TABLE, recordId: row.id, field: "color_hex" }}
        >
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
              onChange={(e) => colorField.set(e.target.value)}
              onFocus={colorField.onFocus}
              onBlur={colorField.onBlur}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </FieldHighlight>
        <FieldHighlight
          peers={peers}
          focusKey={{ table: VAR_TABLE, recordId: row.id, field: "name" }}
        >
          <Input
            value={nameField.value}
            onChange={(e) => nameField.set(e.target.value)}
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
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Default
        </span>
        <FieldHighlight
          peers={peers}
          focusKey={{
            table: VAR_TABLE,
            recordId: row.id,
            field: "default_value_id",
          }}
        >
          <Select
            value={defaultField.value ?? ""}
            onChange={(e) => defaultField.set(e.target.value || null)}
            onFocus={defaultField.onFocus}
            onBlur={defaultField.onBlur}
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
        </FieldHighlight>
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

      {showValues ? (
        <div className="border-t border-border/40">
          {colorField.value ? (
            <div className="flex items-center justify-end px-3 py-1 text-[10px] text-muted-foreground/70">
              <button
                type="button"
                onClick={() => colorField.set(null)}
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
              <ValueRow
                key={val.id}
                val={val}
                peers={peers}
                onActivity={onActivity}
                onPatchError={onPatchError}
              />
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

function ValueRow({
  val,
  peers,
  onActivity,
  onPatchError,
}: {
  val: ValueState;
  peers: PresencePeer[];
  onActivity: () => void;
  onPatchError: (msg: string) => void;
}) {
  const { setFocus } = usePresenceContext();
  const [pending, startDeleteTransition] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

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
    onFocusChange: (focused) => {
      setFocus(
        focused ? { table: VALUE_TABLE, recordId: val.id, field: "value" } : null
      );
    },
    onActivity,
  });

  async function confirmDeleteValue() {
    const ok = await confirmDialog({
      title: "Delete value?",
      message: `"${val.value}" will be permanently removed. Column children of condition blocks referencing this value, logic rules, and letter-action assignments will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", val.id);
    startDeleteTransition(() => deleteEndingVariableValue(fd));
  }

  return (
    <div className="grid grid-cols-[1fr_36px] items-center gap-2 border-t border-border/30 px-3 py-1 first:border-t-0">
      <FieldHighlight
        peers={peers}
        focusKey={{ table: VALUE_TABLE, recordId: val.id, field: "value" }}
      >
        <Input
          value={valueField.value}
          onChange={(e) => valueField.set(e.target.value)}
          onFocus={valueField.onFocus}
          onBlur={valueField.onBlur}
          placeholder="Value"
          className={cn(
            "h-8",
            GHOST_FIELD,
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
        onClick={confirmDeleteValue}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
      >
        <Trash2 size={12} aria-hidden />
      </button>
      {confirmDialogEl}
    </div>
  );
}
