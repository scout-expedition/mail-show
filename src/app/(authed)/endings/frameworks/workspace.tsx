"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import {
  AutoTextarea,
  GHOST_FIELD,
  MUTED_ADD_BTN,
  OverflowMenu,
  PanelHeader,
  SaveRevert,
  Spinner,
  useUnsavedDialog,
} from "@/components/panel";
import { cn } from "@/lib/utils";
import type {
  EndingFramework,
  EndingFrameworkBlock,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import {
  changeConditionBlockVariable,
  createConditionBlock,
  createEndingFramework,
  createTextBlock,
  createValueInline,
  createVariableInline,
  deleteBlock,
  deleteEndingFramework,
  saveFramework,
} from "./actions";

type BlockState = {
  id: string;
  parent_block_id: string | null;
  parent_value_id: string | null;
  block_type: "text" | "condition";
  variable_id: string | null;
  text: string;
};

type ParentLoc = {
  parent_block_id: string | null;
  parent_value_id: string | null;
};

type ParentKey = string;
function parentKey(
  parent_block_id: string | null,
  parent_value_id: string | null
): ParentKey {
  return `${parent_block_id ?? "root"}:${parent_value_id ?? "root"}`;
}

type EditorHandle = {
  dirty: boolean;
  save: () => Promise<void>;
};

export function FrameworksWorkspace({
  frameworks,
  blocks,
  variables,
  values,
  selectedFrameworkId,
}: {
  frameworks: EndingFramework[];
  blocks: EndingFrameworkBlock[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  selectedFrameworkId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveId =
    (selectedFrameworkId &&
      frameworks.find((f) => f.id === selectedFrameworkId)?.id) ??
    frameworks[0]?.id ??
    null;
  const selected = frameworks.find((f) => f.id === effectiveId) ?? null;

  const editorHandleRef = useRef<EditorHandle>({
    dirty: false,
    save: async () => {},
  });
  const { ask, dialog } = useUnsavedDialog();

  async function navigateTo(frameworkId: string | null) {
    if (editorHandleRef.current.dirty) {
      const outcome = await ask(
        "Unsaved changes",
        "This framework has unsaved changes. Save before switching?"
      );
      if (outcome === "cancel") return;
      if (outcome === "save") {
        try {
          await editorHandleRef.current.save();
        } catch (e) {
          console.error(e);
          return;
        }
      }
    }
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    if (frameworkId) qs.set("framework", frameworkId);
    else qs.delete("framework");
    const suffix = qs.toString();
    router.push(`/endings/frameworks${suffix ? `?${suffix}` : ""}`);
  }

  return (
    <div className="grid gap-3 md:grid-cols-[240px_1fr]">
      <FrameworkList
        frameworks={frameworks}
        selectedId={effectiveId}
        onSelect={navigateTo}
      />

      {selected ? (
        <FrameworkEditor
          key={selected.id}
          framework={selected}
          blocks={blocks.filter((b) => b.framework_id === selected.id)}
          variables={variables}
          values={values}
          onDeleted={() => navigateTo(null)}
          registerHandle={(h) => {
            editorHandleRef.current = h;
          }}
        />
      ) : (
        <div className="rounded-md border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Select or create a framework.
        </div>
      )}
      {dialog}
    </div>
  );
}

function FrameworkList({
  frameworks,
  selectedId,
  onSelect,
}: {
  frameworks: EndingFramework[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  async function handleCreate() {
    startTransition(async () => {
      const res = await createEndingFramework();
      onSelect(res.id);
    });
  }

  return (
    <aside className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <PanelHeader title="Frameworks" />
        {frameworks.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            None yet.
          </p>
        ) : (
          <ul>
            {frameworks.map((f) => {
              const active = f.id === selectedId;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(f.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent/40",
                      active && "bg-accent/60 text-accent-foreground"
                    )}
                  >
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={pending}
      >
        {pending ? (
          <>
            <Spinner />
            Creating…
          </>
        ) : (
          "+ Framework"
        )}
      </Button>
    </aside>
  );
}

// ------------------------------------------------------------------
// Editor
// ------------------------------------------------------------------

function FrameworkEditor({
  framework,
  blocks,
  variables,
  values,
  onDeleted,
  registerHandle,
}: {
  framework: EndingFramework;
  blocks: EndingFrameworkBlock[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  onDeleted: () => void;
  registerHandle: (h: EditorHandle) => void;
}) {
  const initial = useMemo<{ name: string; blocks: BlockState[] }>(
    () => ({
      name: framework.name,
      blocks: blocks.map((b) => ({
        id: b.id,
        parent_block_id: b.parent_block_id,
        parent_value_id: b.parent_value_id,
        block_type: b.block_type,
        variable_id: b.variable_id,
        text: b.text,
      })),
    }),
    [framework.name, blocks]
  );

  const [name, setName] = useState(initial.name);
  const [blockState, setBlockState] = useState<BlockState[]>(initial.blocks);
  const [dirty, setDirty] = useState(false);
  const [pending, startSave] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  // Drag reorder — the dragged block id, tracked across the whole tree.
  const [dragId, setDragId] = useState<string | null>(null);

  // Preview mode.
  const [previewOn, setPreviewOn] = useState(false);
  const [previewSelections, setPreviewSelections] = useState<
    Record<string, string | null>
  >({});

  useEffect(() => {
    if (!dirty) {
      setName(initial.name);
      setBlockState(initial.blocks);
      return;
    }
    setBlockState((prev) => {
      const prevById = new Map(prev.map((b) => [b.id, b]));
      const serverIds = new Set(initial.blocks.map((b) => b.id));
      const kept = prev.filter((b) => serverIds.has(b.id));
      const keptIds = new Set(kept.map((b) => b.id));
      const additions = initial.blocks
        .filter((b) => !prevById.has(b.id))
        .filter((b) => !keptIds.has(b.id));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }, [initial, dirty]);

  function updateBlock(id: string, patch: Partial<BlockState>) {
    setBlockState((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
    setDirty(true);
  }

  /**
   * Move a block to a new parent, inserting before `beforeId` (or at end).
   * Blocks anywhere in the tree can be dragged anywhere; we guard against
   * cycles (dropping a block inside its own subtree).
   */
  function moveBlock(blockId: string, target: ParentLoc, beforeId: string | null) {
    setBlockState((prev) => {
      const b = prev.find((x) => x.id === blockId);
      if (!b) return prev;
      if (beforeId === blockId) return prev;

      // Cycle guard: if target's ancestor chain passes through blockId, reject.
      let cur: string | null = target.parent_block_id;
      while (cur) {
        if (cur === blockId) return prev;
        const parent = prev.find((x) => x.id === cur);
        cur = parent?.parent_block_id ?? null;
      }

      const withReparent = prev.map((x) =>
        x.id === blockId
          ? {
              ...x,
              parent_block_id: target.parent_block_id,
              parent_value_id: target.parent_value_id,
            }
          : x
      );
      const fromIdx = withReparent.findIndex((x) => x.id === blockId);
      const [moved] = withReparent.splice(fromIdx, 1);
      if (beforeId) {
        const toIdx = withReparent.findIndex((x) => x.id === beforeId);
        withReparent.splice(toIdx < 0 ? withReparent.length : toIdx, 0, moved);
      } else {
        withReparent.push(moved);
      }
      return withReparent;
    });
    setDirty(true);
  }

  const byParent = useMemo(() => {
    const map = new Map<ParentKey, BlockState[]>();
    for (const b of blockState) {
      const key = parentKey(b.parent_block_id, b.parent_value_id);
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [blockState]);

  async function doSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const payload: Array<{
      id: string;
      parent_block_id: string | null;
      parent_value_id: string | null;
      block_type: "text" | "condition";
      variable_id: string | null;
      text: string;
      sort_order: number;
    }> = [];
    function visit(pbId: string | null, pvId: string | null) {
      const list = byParent.get(parentKey(pbId, pvId)) ?? [];
      list.forEach((b, i) => {
        payload.push({
          id: b.id,
          parent_block_id: b.parent_block_id,
          parent_value_id: b.parent_value_id,
          block_type: b.block_type,
          variable_id: b.variable_id,
          text: b.text,
          sort_order: i,
        });
        if (b.block_type === "condition" && b.variable_id) {
          const vals = values.filter((v) => v.variable_id === b.variable_id);
          for (const v of vals) visit(b.id, v.id);
        }
      });
    }
    visit(null, null);

    await saveFramework({
      id: framework.id,
      name: trimmedName,
      blocks: payload,
    });
    setDirty(false);
  }

  function handleSave() {
    startSave(doSave);
  }

  function handleRevert() {
    setName(initial.name);
    setBlockState(initial.blocks);
    setDirty(false);
  }

  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  });
  useEffect(() => {
    registerHandle({
      dirty,
      save: () => doSaveRef.current(),
    });
  }, [dirty, registerHandle]);

  async function handleDelete() {
    const ok = await confirmDialog({
      title: "Delete framework?",
      message: `"${framework.name}" and all of its blocks will be permanently removed. Logic rules that target this framework will also be removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", framework.id);
    startSave(async () => {
      await deleteEndingFramework(fd);
      onDeleted();
    });
  }

  async function handleAddTextBlock(target: ParentLoc) {
    await createTextBlock({
      framework_id: framework.id,
      parent_block_id: target.parent_block_id,
      parent_value_id: target.parent_value_id,
    });
  }

  async function handleAddConditionBlock(
    target: ParentLoc,
    variable_id: string
  ) {
    await createConditionBlock({
      framework_id: framework.id,
      parent_block_id: target.parent_block_id,
      parent_value_id: target.parent_value_id,
      variable_id,
    });
  }

  async function handleDeleteBlock(id: string, blockIsCondition: boolean) {
    const ok = await confirmDialog({
      title: "Delete block?",
      message: blockIsCondition
        ? "This condition block and all of its value columns (including every nested block) will be permanently removed."
        : "This block will be permanently removed.",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", id);
    await deleteBlock(fd);
  }

  async function handleChangeConditionVariable(
    blockId: string,
    newVariableId: string
  ) {
    const descendants: string[] = [];
    let frontier = [blockId];
    while (frontier.length > 0) {
      const children = blockState.filter(
        (b) => b.parent_block_id && frontier.includes(b.parent_block_id)
      );
      const ids = children.map((b) => b.id);
      descendants.push(...ids);
      frontier = ids;
    }
    if (descendants.length > 0) {
      const ok = await confirmDialog({
        title: "Change variable?",
        message: `Changing the variable will permanently delete ${descendants.length} nested block${descendants.length === 1 ? "" : "s"} attached to the old variable's values.`,
        confirmLabel: "Change and delete",
        intent: "destructive",
      });
      if (!ok) return;
    }
    await changeConditionBlockVariable({
      block_id: blockId,
      variable_id: newVariableId,
    });
  }

  function onDragStart(blockId: string) {
    setDragId(blockId);
  }
  function onDragEnd() {
    setDragId(null);
  }
  function onDragOverBlock(target: ParentLoc, overId: string) {
    if (!dragId) return;
    if (dragId === overId) return;
    moveBlock(dragId, target, overId);
  }
  function onDragOverEmpty(target: ParentLoc) {
    if (!dragId) return;
    const dragged = blockState.find((b) => b.id === dragId);
    if (!dragged) return;
    // If it's already the only block in that parent, no-op.
    if (
      dragged.parent_block_id === target.parent_block_id &&
      dragged.parent_value_id === target.parent_value_id
    ) {
      return;
    }
    moveBlock(dragId, target, null);
  }

  const referencedVariableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of blockState) {
      if (b.block_type === "condition" && b.variable_id) ids.add(b.variable_id);
    }
    return ids;
  }, [blockState]);
  const referencedVariables = useMemo(
    () => variables.filter((v) => referencedVariableIds.has(v.id)),
    [variables, referencedVariableIds]
  );
  useEffect(() => {
    setPreviewSelections((prev) => {
      const next: Record<string, string | null> = {};
      for (const v of referencedVariables) {
        next[v.id] = prev[v.id] ?? v.default_value_id ?? null;
      }
      return next;
    });
  }, [referencedVariables]);

  const rootBlocks = byParent.get(parentKey(null, null)) ?? [];
  const nameInvalid = !name.trim();

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={framework.name}
        dirty={dirty}
        showSaved
        saveRevert={
          <SaveRevert
            dirty={dirty && !nameInvalid}
            pending={pending}
            onSave={handleSave}
            onRevert={handleRevert}
          />
        }
        menu={
          <button
            type="button"
            onClick={() => setPreviewOn((v) => !v)}
            aria-label={previewOn ? "Exit preview" : "Preview"}
            title={previewOn ? "Exit preview" : "Preview"}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              previewOn
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {previewOn ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
        }
      />

      {previewOn ? (
        <PreviewView
          name={name}
          byParent={byParent}
          referencedVariables={referencedVariables}
          values={values}
          selections={previewSelections}
          onChange={(variableId, valueId) =>
            setPreviewSelections((prev) => ({ ...prev, [variableId]: valueId }))
          }
        />
      ) : (
        <div className="flex flex-col gap-4 p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <Label className="!text-xs">Framework name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                placeholder="Framework name"
                className={cn(
                  "mt-1 h-9",
                  GHOST_FIELD,
                  nameInvalid && "ring-2 ring-destructive"
                )}
              />
            </div>
            <button
              type="button"
              aria-label="Delete framework"
              title="Delete framework"
              onClick={handleDelete}
              className="mt-6 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>

          <BlockList
            blocks={rootBlocks}
            allBlocks={blockState}
            byParent={byParent}
            variables={variables}
            values={values}
            target={{ parent_block_id: null, parent_value_id: null }}
            dragId={dragId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOverBlock={onDragOverBlock}
            onDragOverEmpty={onDragOverEmpty}
            onBlockChange={updateBlock}
            onAddText={handleAddTextBlock}
            onAddCondition={handleAddConditionBlock}
            onDeleteBlock={handleDeleteBlock}
            onChangeConditionVariable={handleChangeConditionVariable}
          />
        </div>
      )}

      {confirmDialogEl}
    </section>
  );
}

// ------------------------------------------------------------------
// Authoring tree
// ------------------------------------------------------------------

type BlockListProps = {
  blocks: BlockState[];
  allBlocks: BlockState[];
  byParent: Map<ParentKey, BlockState[]>;
  variables: EndingVariable[];
  values: EndingVariableValue[];
  target: ParentLoc;
  dragId: string | null;
  onDragStart: (blockId: string) => void;
  onDragEnd: () => void;
  onDragOverBlock: (target: ParentLoc, overId: string) => void;
  onDragOverEmpty: (target: ParentLoc) => void;
  onBlockChange: (id: string, patch: Partial<BlockState>) => void;
  onAddText: (target: ParentLoc) => Promise<void>;
  onAddCondition: (target: ParentLoc, variable_id: string) => Promise<void>;
  onDeleteBlock: (id: string, isCondition: boolean) => Promise<void>;
  onChangeConditionVariable: (
    blockId: string,
    newVariableId: string
  ) => Promise<void>;
};

function BlockList(props: BlockListProps) {
  const {
    blocks,
    allBlocks,
    byParent,
    variables,
    values,
    target,
    dragId,
    onDragStart,
    onDragEnd,
    onDragOverBlock,
    onDragOverEmpty,
    onBlockChange,
    onAddText,
    onAddCondition,
    onDeleteBlock,
    onChangeConditionVariable,
  } = props;

  function handleEmptyDragOver(e: React.DragEvent) {
    if (!dragId) return;
    e.preventDefault();
    onDragOverEmpty(target);
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.length === 0 ? (
        <div
          onDragOver={handleEmptyDragOver}
          className={cn(
            "rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground",
            dragId && "border-primary/60 bg-primary/5 text-foreground"
          )}
        >
          {dragId ? "Drop here" : "No blocks here."}
        </div>
      ) : null}

      {blocks.map((b) => (
        <BlockRow
          key={b.id}
          block={b}
          target={target}
          dragId={dragId}
          allBlocks={allBlocks}
          byParent={byParent}
          variables={variables}
          values={values}
          onChange={onBlockChange}
          onDragStart={() => onDragStart(b.id)}
          onDragEnd={onDragEnd}
          onDragOver={() => onDragOverBlock(target, b.id)}
          onAddText={onAddText}
          onAddCondition={onAddCondition}
          onDelete={() => onDeleteBlock(b.id, b.block_type === "condition")}
          onDragStartChild={onDragStart}
          onDragEndChild={onDragEnd}
          onDragOverChild={onDragOverBlock}
          onDragOverEmptyChild={onDragOverEmpty}
          onChildChange={onBlockChange}
          onChildDelete={onDeleteBlock}
          onChangeConditionVariable={onChangeConditionVariable}
        />
      ))}

      <BlockAdder
        variables={variables}
        onAddText={() => onAddText(target)}
        onAddCondition={(variableId) => onAddCondition(target, variableId)}
      />
    </div>
  );
}

function BlockRow({
  block,
  target,
  dragId,
  allBlocks,
  byParent,
  variables,
  values,
  onChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onAddText,
  onAddCondition,
  onDelete,
  onDragStartChild,
  onDragEndChild,
  onDragOverChild,
  onDragOverEmptyChild,
  onChildChange,
  onChildDelete,
  onChangeConditionVariable,
}: {
  block: BlockState;
  target: ParentLoc;
  dragId: string | null;
  allBlocks: BlockState[];
  byParent: Map<ParentKey, BlockState[]>;
  variables: EndingVariable[];
  values: EndingVariableValue[];
  onChange: (id: string, patch: Partial<BlockState>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onAddText: (target: ParentLoc) => Promise<void>;
  onAddCondition: (target: ParentLoc, variable_id: string) => Promise<void>;
  onDelete: () => void;
  onDragStartChild: (blockId: string) => void;
  onDragEndChild: () => void;
  onDragOverChild: (target: ParentLoc, overId: string) => void;
  onDragOverEmptyChild: (target: ParentLoc) => void;
  onChildChange: (id: string, patch: Partial<BlockState>) => void;
  onChildDelete: (id: string, isCondition: boolean) => Promise<void>;
  onChangeConditionVariable: (
    blockId: string,
    newVariableId: string
  ) => Promise<void>;
}) {
  const isCondition = block.block_type === "condition";
  const hasChildren =
    isCondition && allBlocks.some((b) => b.parent_block_id === block.id);
  const dragging = dragId === block.id;

  function handleDragOver(e: React.DragEvent) {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    onDragOver();
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      className={cn(
        "rounded-md border border-border bg-background/40 transition-opacity",
        dragging && "opacity-40"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-2 py-1.5">
        <span
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical size={14} aria-hidden />
        </span>
        {isCondition ? (
          <ConditionHeader
            block={block}
            hasChildren={hasChildren}
            variables={variables}
            onChange={onChange}
            onChangeConditionVariable={onChangeConditionVariable}
          />
        ) : (
          <span className="inline-flex h-5 items-center rounded bg-muted/30 px-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            Text
          </span>
        )}
        <span className="flex-1" />
        <OverflowMenu
          items={[
            {
              label: "Delete block",
              intent: "destructive",
              icon: <Trash2 size={12} aria-hidden />,
              onClick: onDelete,
            },
          ]}
        />
      </div>

      <div className="p-2">
        {isCondition ? (
          <ConditionBlockBody
            block={block}
            values={values}
            allBlocks={allBlocks}
            byParent={byParent}
            variables={variables}
            dragId={dragId}
            onDragStartChild={onDragStartChild}
            onDragEndChild={onDragEndChild}
            onDragOverChild={onDragOverChild}
            onDragOverEmptyChild={onDragOverEmptyChild}
            onChildChange={onChildChange}
            onAddText={onAddText}
            onAddCondition={onAddCondition}
            onChildDelete={onChildDelete}
            onChangeConditionVariable={onChangeConditionVariable}
          />
        ) : (
          <AutoTextarea
            value={block.text}
            onChange={(e) => onChange(block.id, { text: e.target.value })}
            placeholder="Block text…"
            minRows={2}
            className={GHOST_FIELD}
          />
        )}
      </div>
    </div>
  );
}

function ConditionHeader({
  block,
  hasChildren,
  variables,
  onChange,
  onChangeConditionVariable,
}: {
  block: BlockState;
  hasChildren: boolean;
  variables: EndingVariable[];
  onChange: (id: string, patch: Partial<BlockState>) => void;
  onChangeConditionVariable: (
    blockId: string,
    newVariableId: string
  ) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const NEW_VAR = "__new_variable__";

  async function applyVariable(newId: string) {
    if (!newId || newId === block.variable_id) return;
    if (hasChildren) {
      await onChangeConditionVariable(block.id, newId);
    } else {
      onChange(block.id, { variable_id: newId });
    }
  }

  function handlePickVariable(raw: string) {
    if (raw === NEW_VAR) {
      const promptName = window.prompt("Variable name:");
      if (!promptName || !promptName.trim()) return;
      startTransition(async () => {
        const res = await createVariableInline({ name: promptName.trim() });
        await applyVariable(res.id);
      });
      return;
    }
    startTransition(() => applyVariable(raw));
  }

  return (
    <>
      <span className="inline-flex h-5 items-center rounded bg-muted/30 px-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        Condition
      </span>
      <Label className="!text-xs">on</Label>
      <Select
        value={block.variable_id ?? ""}
        onChange={(e) => handlePickVariable(e.target.value)}
        className={cn("h-7 w-auto min-w-[160px]", GHOST_FIELD)}
        disabled={pending}
      >
        <option value="">— pick variable —</option>
        {variables.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
        <option value={NEW_VAR}>+ New variable…</option>
      </Select>
      {pending ? <Spinner /> : null}
    </>
  );
}

function ConditionBlockBody({
  block,
  values,
  allBlocks,
  byParent,
  variables,
  dragId,
  onDragStartChild,
  onDragEndChild,
  onDragOverChild,
  onDragOverEmptyChild,
  onChildChange,
  onAddText,
  onAddCondition,
  onChildDelete,
  onChangeConditionVariable,
}: {
  block: BlockState;
  values: EndingVariableValue[];
  allBlocks: BlockState[];
  byParent: Map<ParentKey, BlockState[]>;
  variables: EndingVariable[];
  dragId: string | null;
  onDragStartChild: (blockId: string) => void;
  onDragEndChild: () => void;
  onDragOverChild: (target: ParentLoc, overId: string) => void;
  onDragOverEmptyChild: (target: ParentLoc) => void;
  onChildChange: (id: string, patch: Partial<BlockState>) => void;
  onAddText: (target: ParentLoc) => Promise<void>;
  onAddCondition: (target: ParentLoc, variable_id: string) => Promise<void>;
  onChildDelete: (id: string, isCondition: boolean) => Promise<void>;
  onChangeConditionVariable: (
    blockId: string,
    newVariableId: string
  ) => Promise<void>;
}) {
  const variableValues = values.filter(
    (v) => v.variable_id === block.variable_id
  );

  if (!block.variable_id) {
    return (
      <p className="px-1 py-1 text-xs text-muted-foreground">
        Pick a variable in the block header above to branch on.
      </p>
    );
  }

  if (variableValues.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        This variable has no values yet. Add some in the Variables tab or{" "}
        <ValueInlineCreator variableId={block.variable_id} />.
      </p>
    );
  }

  // Columns share one grid — no per-column boxes. Value label sits above
  // each column. Grid wraps so 4 values become 2×2 on mid screens, 4×1 on
  // wide screens, 1-per-row on narrow.
  return (
    <div
      className={cn(
        "grid auto-rows-min gap-x-3 gap-y-2",
        variableValues.length === 1 && "grid-cols-1",
        variableValues.length === 2 && "grid-cols-1 sm:grid-cols-2",
        variableValues.length >= 3 &&
          "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      )}
    >
      {variableValues.map((v) => (
        <div key={v.id} className="flex min-w-0 flex-col gap-1.5">
          <div className="sticky top-0 flex items-center gap-1.5">
            <span className="inline-flex h-5 items-center rounded bg-muted/40 px-2 text-[11px] font-mono tracking-wide text-foreground">
              {v.value}
            </span>
          </div>
          <BlockList
            blocks={byParent.get(parentKey(block.id, v.id)) ?? []}
            allBlocks={allBlocks}
            byParent={byParent}
            variables={variables}
            values={values}
            target={{ parent_block_id: block.id, parent_value_id: v.id }}
            dragId={dragId}
            onDragStart={onDragStartChild}
            onDragEnd={onDragEndChild}
            onDragOverBlock={onDragOverChild}
            onDragOverEmpty={onDragOverEmptyChild}
            onBlockChange={onChildChange}
            onAddText={onAddText}
            onAddCondition={onAddCondition}
            onDeleteBlock={onChildDelete}
            onChangeConditionVariable={onChangeConditionVariable}
          />
        </div>
      ))}
    </div>
  );
}

function ValueInlineCreator({ variableId }: { variableId: string }) {
  const [pending, startTransition] = useTransition();
  function handleClick() {
    const text = window.prompt("New value:");
    if (!text || !text.trim()) return;
    startTransition(async () => {
      await createValueInline({ variable_id: variableId, value: text.trim() });
    });
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="underline underline-offset-2 hover:text-foreground"
    >
      {pending ? "creating…" : "adding one inline"}
    </button>
  );
}

function BlockAdder({
  variables,
  onAddText,
  onAddCondition,
}: {
  variables: EndingVariable[];
  onAddText: () => Promise<void>;
  onAddCondition: (variableId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"closed" | "picking">("closed");
  const [pending, startTransition] = useTransition();

  const NEW_VAR = "__new_variable__";

  async function handleText() {
    startTransition(async () => {
      await onAddText();
    });
  }

  async function handleCondition(raw: string) {
    if (!raw) return;
    if (raw === NEW_VAR) {
      const promptName = window.prompt("Variable name:");
      if (!promptName || !promptName.trim()) return;
      startTransition(async () => {
        const v = await createVariableInline({ name: promptName.trim() });
        await onAddCondition(v.id);
        setMode("closed");
      });
      return;
    }
    startTransition(async () => {
      await onAddCondition(raw);
      setMode("closed");
    });
  }

  if (pending) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Spinner />
        Adding…
      </div>
    );
  }

  if (mode === "picking") {
    return (
      <div className="flex items-center gap-2">
        <Select
          autoFocus
          value=""
          onChange={(e) => handleCondition(e.target.value)}
          onBlur={() => setMode("closed")}
          className="h-8 w-auto min-w-[180px]"
          aria-label="Condition on variable"
        >
          <option value="">Condition on…</option>
          {variables.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          <option value={NEW_VAR}>+ New variable…</option>
        </Select>
        <button
          type="button"
          onClick={() => setMode("closed")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={handleText} className={MUTED_ADD_BTN}>
        + Text Block
      </button>
      <button
        type="button"
        onClick={() => setMode("picking")}
        className={MUTED_ADD_BTN}
      >
        + Condition Block
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// Preview view
// ------------------------------------------------------------------

function PreviewView({
  name,
  byParent,
  referencedVariables,
  values,
  selections,
  onChange,
}: {
  name: string;
  byParent: Map<ParentKey, BlockState[]>;
  referencedVariables: EndingVariable[];
  values: EndingVariableValue[];
  selections: Record<string, string | null>;
  onChange: (variableId: string, valueId: string | null) => void;
}) {
  const paragraphs = useMemo(
    () => renderParagraphs(byParent.get(parentKey(null, null)) ?? [], byParent, selections),
    [byParent, selections]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {referencedVariables.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Set variable values
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {referencedVariables.map((v) => (
              <div
                key={v.id}
                className="grid grid-cols-[1fr_1fr] items-center gap-2"
              >
                <Label className="!text-xs">{v.name}</Label>
                <Select
                  value={selections[v.id] ?? ""}
                  onChange={(e) => onChange(v.id, e.target.value || null)}
                  className={cn("h-8", GHOST_FIELD)}
                >
                  <option value="">—</option>
                  {values
                    .filter((val) => val.variable_id === v.id)
                    .map((val) => (
                      <option key={val.id} value={val.id}>
                        {val.value}
                      </option>
                    ))}
                </Select>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <article className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {name || "(unnamed framework)"}
        </h3>
        {paragraphs.length === 0 ? (
          <p className="italic text-muted-foreground/80">
            (no blocks to render)
          </p>
        ) : (
          paragraphs.map((para, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {para}
            </p>
          ))
        )}
      </article>
    </div>
  );
}

type Paragraph = React.ReactNode;

function renderParagraphs(
  blocks: BlockState[],
  byParent: Map<ParentKey, BlockState[]>,
  selections: Record<string, string | null>
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const b of blocks) {
    if (b.block_type === "text") {
      if (b.text.trim().length === 0) continue;
      out.push(b.text);
    } else if (b.block_type === "condition" && b.variable_id) {
      const selected = selections[b.variable_id];
      if (!selected) {
        out.push(
          <span className="italic text-muted-foreground/80">[unset]</span>
        );
        continue;
      }
      const children = byParent.get(parentKey(b.id, selected)) ?? [];
      out.push(...renderParagraphs(children, byParent, selections));
    }
  }
  return out;
}
