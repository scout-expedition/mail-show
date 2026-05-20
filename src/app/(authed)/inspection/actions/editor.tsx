"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { IconPickerDialog } from "@/components/icon-picker-dialog";
import { IconDisplay } from "@/components/icon-display";
import { CompositeActionChip } from "@/components/composite-action-chip";
import {
  OverflowMenu,
  PanelHeader,
  type OverflowMenuItem,
} from "@/components/panel";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { usePresenceUser } from "@/components/presence-user-context";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { cn } from "@/lib/utils";
import type { ActionTemplate, ActionTemplateGroup } from "@/lib/db/types";
import {
  createActionTemplate,
  createActionTemplateGroup,
  deleteActionTemplate,
  deleteActionTemplateGroup,
  duplicateActionTemplate,
  moveTemplateToGroup,
  patchActionTemplate,
  patchActionTemplateGroup,
  renumberActionContainer,
} from "./actions";

const WATCHED_TABLES = ["action_templates", "action_template_groups"];

function readableOn(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/** Display name for a group: stored name overrides; otherwise members joined
 *  by " + ". Falls back to "Empty group" when no members (transient state
 *  that the server-side auto-cleanup makes rare). */
function derivedGroupName(members: ActionTemplate[]): string {
  if (members.length === 0) return "Empty group";
  return members.map((m) => m.name).join(" + ");
}

export function ActionTemplatesEditor({
  templates,
  groups,
}: {
  templates: ActionTemplate[];
  groups: ActionTemplateGroup[];
}) {
  const presenceUser = usePresenceUser();
  return (
    <WorkspacePresenceProvider
      channelName="action-templates"
      userId={presenceUser?.userId}
      email={presenceUser?.email}
      profile={presenceUser?.profile ?? null}
      postgresTables={WATCHED_TABLES}
    >
      <EditorBody templates={templates} groups={groups} />
    </WorkspacePresenceProvider>
  );
}

type DragRef =
  | { kind: "template"; id: string; sourceGroupId: string }
  | { kind: "group"; id: string }
  | null;

type DropTarget =
  | { container: "top"; index: number }
  | { container: "group"; groupId: string; index: number }
  | { container: "group-header"; groupId: string }
  | null;

function EditorBody({
  templates: initialTemplates,
  groups: initialGroups,
}: {
  templates: ActionTemplate[];
  groups: ActionTemplateGroup[];
}) {
  const router = useRouter();
  const { onPostgresChanges } = usePresenceContext();

  // Local mirror with optimistic ghosts. The server-side props are the
  // settled truth; `pendingTemplates` / `pendingGroups` are ids the user
  // just created (rendered as ghosts) or just deleted (rendered as leaving)
  // — they're reconciled when the matching row appears or disappears from
  // the server props.
  const [pendingAdds, setPendingAdds] = useState<{
    groups: ActionTemplateGroup[];
    templates: ActionTemplate[];
  }>({ groups: [], templates: [] });
  const [pendingDeletes, setPendingDeletes] = useState<{
    groups: Set<string>;
    templates: Set<string>;
  }>({ groups: new Set(), templates: new Set() });
  // Optimistic moves: when the user drags a template into another group,
  // the local view should reflect the new group_id immediately even though
  // the server roundtrip is still in flight. Map key is template id; value
  // captures both the target group and the in-group sort_order so a
  // reorder shows up at the right slot.
  const [pendingMoves, setPendingMoves] = useState<
    Map<string, { groupId: string; sortOrder: number }>
  >(new Map());
  // Same idea for group reordering — overlays the new sort_order on each
  // group while the server roundtrip is in flight.
  const [pendingGroupOrders, setPendingGroupOrders] = useState<
    Map<string, number>
  >(new Map());

  // Reconcile ghosts whenever the server props change.
  const [prevGroups, setPrevGroups] = useState(initialGroups);
  const [prevTemplates, setPrevTemplates] = useState(initialTemplates);
  if (initialGroups !== prevGroups || initialTemplates !== prevTemplates) {
    setPrevGroups(initialGroups);
    setPrevTemplates(initialTemplates);
    const serverGroupIds = new Set(initialGroups.map((g) => g.id));
    const serverTemplateIds = new Set(initialTemplates.map((t) => t.id));
    setPendingAdds((prev) => {
      const groups = prev.groups.filter((g) => !serverGroupIds.has(g.id));
      const templates = prev.templates.filter(
        (t) => !serverTemplateIds.has(t.id)
      );
      if (
        groups.length === prev.groups.length &&
        templates.length === prev.templates.length
      ) {
        return prev;
      }
      return { groups, templates };
    });
    setPendingDeletes((prev) => {
      const groups = new Set<string>();
      for (const id of prev.groups) {
        if (serverGroupIds.has(id)) groups.add(id);
      }
      const templates = new Set<string>();
      for (const id of prev.templates) {
        if (serverTemplateIds.has(id)) templates.add(id);
      }
      if (
        groups.size === prev.groups.size &&
        templates.size === prev.templates.size
      ) {
        return prev;
      }
      return { groups, templates };
    });
    // Drop any pendingMove whose server row now reflects the optimistic
    // target — the move has fully settled and the overlay is no longer
    // needed.
    setPendingMoves((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [tid, move] of prev) {
        const server = initialTemplates.find((t) => t.id === tid);
        if (server && server.group_id === move.groupId) {
          next.delete(tid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setPendingGroupOrders((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [gid, sortOrder] of prev) {
        const server = initialGroups.find((g) => g.id === gid);
        if (server && server.sort_order === sortOrder) {
          next.delete(gid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  // Coalesce realtime echoes into a debounced refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onPostgresChanges((change) => {
      if (!WATCHED_TABLES.includes(change.table)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [onPostgresChanges, router]);

  // Merge server props + pending ghosts, then exclude pending deletes for
  // the rendered list. The user's perception is: clicked "+", sees the row
  // immediately; clicked "delete", sees the row fade out; both settle to
  // truth when the server confirms.
  const groups = useMemo(() => {
    const merged = [...initialGroups, ...pendingAdds.groups];
    const withOverlays =
      pendingGroupOrders.size === 0
        ? merged
        : merged.map((g) => {
            const override = pendingGroupOrders.get(g.id);
            return override !== undefined ? { ...g, sort_order: override } : g;
          });
    return withOverlays.sort((a, b) => a.sort_order - b.sort_order);
  }, [initialGroups, pendingAdds.groups, pendingGroupOrders]);

  const templates = useMemo(() => {
    const all = [...initialTemplates, ...pendingAdds.templates];
    if (pendingMoves.size === 0) return all;
    return all.map((t) => {
      const move = pendingMoves.get(t.id);
      if (!move) return t;
      return { ...t, group_id: move.groupId, sort_order: move.sortOrder };
    });
  }, [initialTemplates, pendingAdds.templates, pendingMoves]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, ActionTemplate[]>();
    for (const t of templates) {
      if (!t.group_id) continue;
      const arr = m.get(t.group_id) ?? [];
      arr.push(t);
      m.set(t.group_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.sort_order - b.sort_order);
    }
    return m;
  }, [templates]);

  // Drag-and-drop
  const [drag, setDrag] = useState<DragRef>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  function handleDragStart(ref: DragRef) {
    setDrag(ref);
    setDropTarget(null);
  }
  function handleDragEnd() {
    setDrag(null);
    setDropTarget(null);
  }
  function handleDrop() {
    if (!drag || !dropTarget) {
      setDrag(null);
      setDropTarget(null);
      return;
    }
    void applyDrop(drag, dropTarget);
    setDrag(null);
    setDropTarget(null);
  }

  async function applyDrop(d: DragRef, target: DropTarget) {
    if (!d || !target) return;

    if (d.kind === "group") {
      if (target.container !== "top") return;
      const order = groups.filter((g) => g.id !== d.id).map((g) => g.id);
      const insertAt = Math.max(0, Math.min(target.index, order.length));
      order.splice(insertAt, 0, d.id);
      // Optimistic: stamp each group's new sort_order locally so the row
      // jumps into place immediately. The reconciler drops these once the
      // server props match.
      setPendingGroupOrders((prev) => {
        const next = new Map(prev);
        order.forEach((id, i) => next.set(id, i));
        return next;
      });
      try {
        await Promise.all(
          order.map((id, i) =>
            patchActionTemplateGroup(id, { sort_order: i })
          )
        );
      } catch {
        setPendingGroupOrders((prev) => {
          const next = new Map(prev);
          for (const id of order) next.delete(id);
          return next;
        });
      }
      return;
    }

    // template
    const dragged = templates.find((t) => t.id === d.id);
    if (!dragged) return;

    if (target.container === "top") {
      // Dragging a template into the top-level gap creates a new solo group.
      // No optimistic overlay for this branch — the new group id isn't
      // known until the server returns.
      await moveTemplateToGroup(d.id, null, 0);
      return;
    }

    // Compute the final member order for the target group.
    const targetMembers = (membersByGroup.get(target.groupId) ?? []).filter(
      (m) => m.id !== d.id
    );
    let insertAt: number;
    if (target.container === "group-header") {
      insertAt = targetMembers.length;
    } else {
      insertAt = Math.max(0, Math.min(target.index, targetMembers.length));
    }
    const newOrder = targetMembers.slice();
    newOrder.splice(insertAt, 0, dragged);

    const isCrossGroup = dragged.group_id !== target.groupId;
    // Optimistic overlay: surface the dragged template in its new group +
    // position immediately, plus rewrite every other member's sort_order to
    // match the renumber the server is about to perform. Clears in the
    // finally block; settled by the prop-diff reconciler in any case.
    setPendingMoves((prev) => {
      const next = new Map(prev);
      newOrder.forEach((m, i) => {
        next.set(m.id, { groupId: target.groupId, sortOrder: i });
      });
      return next;
    });

    try {
      if (isCrossGroup) {
        // Cross-group move: server updates group_id + auto-deletes the empty
        // source group when applicable.
        await moveTemplateToGroup(d.id, target.groupId, insertAt);
      }
      // Renumber the destination group's member sort_orders so the visual
      // order matches the local one. (moveTemplateToGroup set a single
      // sort_order on the dragged row, but doesn't shift the other members
      // — this sweep fixes any ties.)
      await renumberActionContainer(
        "template",
        newOrder.map((m) => m.id),
        0
      );
    } catch {
      // Roll back the optimistic overlay so the row snaps back to its
      // pre-drag position.
      setPendingMoves((prev) => {
        const next = new Map(prev);
        for (const m of newOrder) next.delete(m.id);
        return next;
      });
    }
  }

  // Optimistic create. Ghost ids carry a "pending-" prefix so they never
  // collide with server uuids. The ghost is removed when the server action
  // resolves — Next's RSC revalidation surfaces the real row right after,
  // so a brief gap is acceptable in practice.
  const [creating, startCreate] = useTransition();

  function handleCreateAction() {
    const tempTemplateId = `pending-template-${crypto.randomUUID()}`;
    const existingUngrouped = groups.find(
      (g) => (g.name ?? "").toLowerCase() === "ungrouped"
    );
    const tempGroupId = existingUngrouped
      ? null
      : `pending-group-${crypto.randomUUID()}`;
    const sortOrder =
      Math.max(0, ...groups.map((g) => g.sort_order)) + 1;
    setPendingAdds((prev) => ({
      groups: tempGroupId
        ? [
            ...prev.groups,
            { id: tempGroupId, name: "Ungrouped", sort_order: sortOrder },
          ]
        : prev.groups,
      templates: [
        ...prev.templates,
        {
          id: tempTemplateId,
          name: "New action",
          icon_type: "lucide",
          icon_value: null,
          color_hex: "#888888",
          sort_order: 0,
          group_id: tempGroupId ?? existingUngrouped!.id,
        },
      ],
    }));
    startCreate(async () => {
      try {
        await createActionTemplate();
      } catch {
        // Even on success we drop the ghost here; on failure we additionally
        // surface nothing user-facing (TODO toast).
      } finally {
        setPendingAdds((prev) => ({
          groups: tempGroupId
            ? prev.groups.filter((g) => g.id !== tempGroupId)
            : prev.groups,
          templates: prev.templates.filter((t) => t.id !== tempTemplateId),
        }));
      }
    });
  }

  function handleCreateGroup() {
    const tempGroupId = `pending-group-${crypto.randomUUID()}`;
    const sortOrder =
      Math.max(0, ...groups.map((g) => g.sort_order)) + 1;
    setPendingAdds((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id: tempGroupId, name: null, sort_order: sortOrder },
      ],
    }));
    startCreate(async () => {
      try {
        await createActionTemplateGroup();
      } catch {
        // ignored — finally drops the ghost.
      } finally {
        setPendingAdds((prev) => ({
          ...prev,
          groups: prev.groups.filter((g) => g.id !== tempGroupId),
        }));
      }
    });
  }

  function markTemplatePendingDelete(id: string) {
    setPendingDeletes((prev) => {
      const next = new Set(prev.templates);
      next.add(id);
      return { ...prev, templates: next };
    });
  }
  function markGroupPendingDelete(id: string) {
    setPendingDeletes((prev) => {
      const next = new Set(prev.groups);
      next.add(id);
      return { ...prev, groups: next };
    });
  }
  function clearTemplatePendingDelete(id: string) {
    setPendingDeletes((prev) => {
      const next = new Set(prev.templates);
      next.delete(id);
      return { ...prev, templates: next };
    });
  }
  function clearGroupPendingDelete(id: string) {
    setPendingDeletes((prev) => {
      const next = new Set(prev.groups);
      next.delete(id);
      return { ...prev, groups: next };
    });
  }

  return (
    // onDrop lives at the outer container so the top-level drop strips
    // between groups (which sit between GroupBlocks and have no onDrop of
    // their own) still trigger the drop handler when the user releases.
    <div
      className="overflow-hidden rounded-md border border-border bg-card"
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => {
        if (drag) e.preventDefault();
      }}
    >
      <PanelHeader
        title="Action groups"
        icon={
          <Zap
            size={14}
            aria-hidden
            className="text-muted-foreground/70"
          />
        }
        menu={
          <AddMenuButton
            disabled={creating}
            onAddAction={handleCreateAction}
            onAddGroup={handleCreateGroup}
          />
        }
      />

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No action templates yet. Hit + to add one.
        </p>
      ) : null}

      <DropStrip
        active={
          !!drag &&
          drag.kind === "group" &&
          dropTarget?.container === "top" &&
          dropTarget.index === 0
        }
        accept={!!drag && drag.kind === "group"}
        onEnter={() => setDropTarget({ container: "top", index: 0 })}
      />
      {groups.map((group, i) => {
        const members = membersByGroup.get(group.id) ?? [];
        return (
          <div key={group.id}>
            <GroupBlock
              group={group}
              members={members}
              drag={drag}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              isPendingAdd={pendingAdds.groups.some((g) => g.id === group.id)}
              isPendingDelete={pendingDeletes.groups.has(group.id)}
              pendingTemplateIds={pendingAdds.templates.map((t) => t.id)}
              pendingDeleteTemplateIds={pendingDeletes.templates}
              onDragStartGroup={() =>
                handleDragStart({ kind: "group", id: group.id })
              }
              onDragStartMember={(id) =>
                handleDragStart({
                  kind: "template",
                  id,
                  sourceGroupId: group.id,
                })
              }
              onDeleteGroupStart={() => markGroupPendingDelete(group.id)}
              onDeleteGroupRollback={() => clearGroupPendingDelete(group.id)}
              onDeleteTemplateStart={(id) => markTemplatePendingDelete(id)}
              onDeleteTemplateRollback={(id) => clearTemplatePendingDelete(id)}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
            />
            <DropStrip
              active={
                !!drag &&
                drag.kind === "group" &&
                dropTarget?.container === "top" &&
                dropTarget.index === i + 1
              }
              accept={!!drag && drag.kind === "group"}
              onEnter={() =>
                setDropTarget({ container: "top", index: i + 1 })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function AddMenuButton({
  disabled,
  onAddAction,
  onAddGroup,
}: {
  disabled?: boolean;
  onAddAction: () => void;
  onAddGroup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(fn: () => void) {
    fn();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add"
        title="Add"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Plus size={14} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-max overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick(onAddAction)}
            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] text-foreground transition-colors hover:bg-accent/40"
          >
            <Zap size={11} aria-hidden />
            Action
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick(onAddGroup)}
            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] text-foreground transition-colors hover:bg-accent/40"
          >
            <FolderPlus size={11} aria-hidden />
            Group
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DropStrip({
  active,
  accept,
  onEnter,
}: {
  active: boolean;
  accept: boolean;
  onEnter: () => void;
}) {
  return (
    <div
      onDragEnter={(e) => {
        if (!accept) return;
        e.preventDefault();
        onEnter();
      }}
      onDragOver={(e) => {
        if (!accept) return;
        e.preventDefault();
      }}
      className={cn("h-1 transition-colors", active && "bg-primary/60")}
      aria-hidden
    />
  );
}

function GroupBlock({
  group,
  members,
  drag,
  dropTarget,
  setDropTarget,
  isPendingAdd,
  isPendingDelete,
  pendingTemplateIds,
  pendingDeleteTemplateIds,
  onDragStartGroup,
  onDragStartMember,
  onDeleteGroupStart,
  onDeleteGroupRollback,
  onDeleteTemplateStart,
  onDeleteTemplateRollback,
  onDragEnd,
  onDrop,
}: {
  group: ActionTemplateGroup;
  members: ActionTemplate[];
  drag: DragRef;
  dropTarget: DropTarget;
  setDropTarget: (t: DropTarget) => void;
  isPendingAdd: boolean;
  isPendingDelete: boolean;
  pendingTemplateIds: string[];
  pendingDeleteTemplateIds: Set<string>;
  onDragStartGroup: () => void;
  onDragStartMember: (id: string) => void;
  onDeleteGroupStart: () => void;
  onDeleteGroupRollback: () => void;
  onDeleteTemplateStart: (id: string) => void;
  onDeleteTemplateRollback: (id: string) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const { peers, setFocus } = usePresenceContext();
  const { confirm, dialog } = useConfirm();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const derived = derivedGroupName(members);
  const displayName = group.name?.trim() ? group.name : derived;
  const hasCustomName = !!group.name?.trim();

  const name = useInstantField<string>({
    value: group.name ?? "",
    onCommit: (v) => patchActionTemplateGroup(group.id, { name: v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? {
              table: "action_template_groups",
              recordId: group.id,
              field: "name",
            }
          : null
      ),
  });

  const isPendingGroup = group.id.startsWith("pending-");
  const isDragSource = drag?.kind === "group" && drag.id === group.id;
  const headerIsDropTarget =
    !!drag &&
    drag.kind === "template" &&
    dropTarget?.container === "group-header" &&
    dropTarget.groupId === group.id;
  // The whole block lights up whenever a template-drop is targeting this
  // group (either its header for append, or a gap between members for
  // insert-at-position) so the user sees "this is the destination group".
  const blockIsDropTarget =
    !!drag &&
    drag.kind === "template" &&
    drag.sourceGroupId !== group.id &&
    ((dropTarget?.container === "group" &&
      dropTarget.groupId === group.id) ||
      headerIsDropTarget);

  const menuItems: OverflowMenuItem[] = [
    {
      label: "Delete group",
      intent: "destructive",
      icon: <Trash2 size={10} aria-hidden />,
      onClick: async () => {
        const ok = await confirm({
          title: "Delete this group?",
          message:
            members.length === 0
              ? "Removes the empty group."
              : `Removes the group AND its ${members.length} action${members.length === 1 ? "" : "s"}.`,
          confirmLabel: "Delete",
          intent: "destructive",
        });
        if (!ok) return;
        onDeleteGroupStart();
        startTransition(async () => {
          try {
            await deleteActionTemplateGroup(group.id);
          } catch {
            onDeleteGroupRollback();
          }
        });
      },
      disabled: isPendingGroup,
    },
  ];

  return (
    <div
      className={cn(
        // 2px divider on top of every group except the first — heavier than
        // a default 1px so the group/member separation reads at a glance.
        "border-t-2 border-border/80 first:border-t-0",
        isDragSource && "opacity-50",
        isPendingAdd && "animate-pulse opacity-60",
        isPendingDelete && "pointer-events-none opacity-40 line-through",
        blockIsDropTarget && "bg-primary/5 ring-2 ring-inset ring-primary/70"
      )}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      {/* Group header row — distinctly darker than member rows so the
          hierarchy reads at a glance. */}
      <div
        className={cn(
          "group/grow flex items-center gap-1.5 border-b border-border/60 bg-muted/70 pl-1 pr-1.5 py-1.5",
          headerIsDropTarget && "ring-2 ring-inset ring-primary"
        )}
        onDragEnter={(e) => {
          if (!drag || drag.kind !== "template") return;
          if (drag.sourceGroupId === group.id) return;
          e.preventDefault();
          setDropTarget({ container: "group-header", groupId: group.id });
        }}
        onDragOver={(e) => {
          if (!drag || drag.kind !== "template") return;
          if (drag.sourceGroupId === group.id) return;
          e.preventDefault();
        }}
      >
        <DragHandle
          onDragStart={onDragStartGroup}
          disabled={isPendingGroup}
        />
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={collapsed ? "Expand group" : "Collapse group"}
        >
          {collapsed ? (
            <ChevronRight size={13} aria-hidden />
          ) : (
            <ChevronDown size={13} aria-hidden />
          )}
        </button>
        <CompositeActionChip members={members} size={28} />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <FieldHighlight
              peers={peers}
              focusKey={{
                table: "action_template_groups",
                recordId: group.id,
                field: "name",
              }}
            >
              <Input
                autoFocus
                value={name.value}
                placeholder={derived}
                onChange={(e) => name.set(e.target.value)}
                onFocus={name.onFocus}
                onBlur={() => {
                  name.onBlur();
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="h-7 font-medium"
                aria-label="Group name"
              />
            </FieldHighlight>
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className={cn(
                "block w-full truncate rounded px-1.5 py-0.5 text-left text-sm font-medium hover:bg-accent/30",
                !hasCustomName && "italic text-muted-foreground"
              )}
              title={hasCustomName ? "Click to rename" : "Auto: " + derived}
            >
              {displayName}
            </button>
          )}
        </div>
        <span className="hidden font-mono text-[10px] text-muted-foreground @[300px]:inline">
          {members.length} {members.length === 1 ? "action" : "actions"}
        </span>
        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/grow:opacity-100">
          <OverflowMenu items={menuItems} size="sm" />
        </span>
      </div>

      {/* Members */}
      {!collapsed ? (
        <>
          <DropStrip
            active={
              !!drag &&
              drag.kind === "template" &&
              dropTarget?.container === "group" &&
              dropTarget.groupId === group.id &&
              dropTarget.index === 0
            }
            accept={!!drag && drag.kind === "template"}
            onEnter={() =>
              setDropTarget({
                container: "group",
                groupId: group.id,
                index: 0,
              })
            }
          />
          {members.map((m, i) => (
            <div key={m.id}>
              <TemplateRow
                template={m}
                disabled={pendingTemplateIds.includes(m.id)}
                isPendingAdd={pendingTemplateIds.includes(m.id)}
                isPendingDelete={pendingDeleteTemplateIds.has(m.id)}
                onDragStart={() => onDragStartMember(m.id)}
                onDeleteStart={() => onDeleteTemplateStart(m.id)}
                onDeleteRollback={() => onDeleteTemplateRollback(m.id)}
              />
              <DropStrip
                active={
                  !!drag &&
                  drag.kind === "template" &&
                  dropTarget?.container === "group" &&
                  dropTarget.groupId === group.id &&
                  dropTarget.index === i + 1
                }
                accept={!!drag && drag.kind === "template"}
                onEnter={() =>
                  setDropTarget({
                    container: "group",
                    groupId: group.id,
                    index: i + 1,
                  })
                }
              />
            </div>
          ))}
        </>
      ) : null}
      {dialog}
    </div>
  );
}

function TemplateRow({
  template,
  disabled,
  isPendingAdd,
  isPendingDelete,
  onDragStart,
  onDeleteStart,
  onDeleteRollback,
}: {
  template: ActionTemplate;
  disabled: boolean;
  isPendingAdd: boolean;
  isPendingDelete: boolean;
  onDragStart: () => void;
  onDeleteStart: () => void;
  onDeleteRollback: () => void;
}) {
  const { peers, setFocus } = usePresenceContext();
  const { confirm, dialog } = useConfirm();
  const [, startTransition] = useTransition();
  const [iconOpen, setIconOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const name = useInstantField<string>({
    value: template.name,
    onCommit: (v) => patchActionTemplate(template.id, { name: v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "action_templates", recordId: template.id, field: "name" }
          : null
      ),
  });

  const fg = readableOn(template.color_hex);

  const menuItems: OverflowMenuItem[] = [
    {
      label: "Duplicate",
      icon: <Copy size={10} aria-hidden />,
      onClick: () => {
        startTransition(() => {
          void duplicateActionTemplate(template.id);
        });
      },
      disabled,
    },
    {
      label: "Delete",
      intent: "destructive",
      icon: <Trash2 size={10} aria-hidden />,
      onClick: async () => {
        const ok = await confirm({
          title: "Delete action?",
          message: `"${template.name}" will be permanently removed.`,
          confirmLabel: "Delete",
          intent: "destructive",
        });
        if (!ok) return;
        onDeleteStart();
        startTransition(async () => {
          try {
            const fd = new FormData();
            fd.set("id", template.id);
            await deleteActionTemplate(fd);
          } catch {
            onDeleteRollback();
          }
        });
      },
      disabled,
    },
  ];

  return (
    <div
      className={cn(
        "group/row flex items-center gap-1.5 pl-9 pr-1.5 py-1",
        isPendingAdd && "animate-pulse opacity-60",
        isPendingDelete && "pointer-events-none opacity-40 line-through"
      )}
    >
      <DragHandle onDragStart={onDragStart} hoverOnly disabled={disabled} />
      <button
        type="button"
        onClick={() => !disabled && setIconOpen(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border"
        style={{ background: template.color_hex, color: fg }}
        title="Icon and color"
        aria-label="Edit icon and color"
        disabled={disabled}
      >
        {template.icon_value ? (
          <IconDisplay
            type={template.icon_type}
            value={template.icon_value}
            size={12}
          />
        ) : (
          <span className="font-mono text-[8px] opacity-70">ic</span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        {editingName ? (
          <FieldHighlight
            peers={peers}
            focusKey={{
              table: "action_templates",
              recordId: template.id,
              field: "name",
            }}
          >
            <Input
              autoFocus
              value={name.value}
              onChange={(e) => name.set(e.target.value)}
              onFocus={name.onFocus}
              onBlur={() => {
                name.onBlur();
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className={cn(
                "h-7",
                !name.value.trim() && "ring-2 ring-destructive"
              )}
              aria-label="Action name"
            />
          </FieldHighlight>
        ) : (
          <button
            type="button"
            onClick={() => !disabled && setEditingName(true)}
            className="block w-full truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-accent/30"
            title="Click to rename"
            disabled={disabled}
          >
            {template.name}
          </button>
        )}
      </div>
      <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <OverflowMenu items={menuItems} size="sm" />
      </span>
      {iconOpen ? (
        <IconPickerDialog
          title="Edit icon"
          initialType={template.icon_type}
          initialValue={template.icon_value}
          initialColor={template.color_hex}
          onSave={(p) =>
            patchActionTemplate(template.id, {
              icon_type: p.type,
              icon_value: p.value,
              color_hex: p.color,
            })
          }
          onClose={() => setIconOpen(false)}
        />
      ) : null}
      {dialog}
    </div>
  );
}

function DragHandle({
  onDragStart,
  hoverOnly,
  disabled,
}: {
  onDragStart: () => void;
  hoverOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      draggable={!disabled}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onDragStart();
      }}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className={cn(
        "flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground transition-opacity",
        hoverOnly
          ? "opacity-0 group-hover/row:opacity-100"
          : "opacity-0 group-hover/grow:opacity-100",
        !disabled && "cursor-grab active:cursor-grabbing",
        disabled && "opacity-30"
      )}
    >
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden>
        <circle cx="1.5" cy="2.5" r="1" />
        <circle cx="6.5" cy="2.5" r="1" />
        <circle cx="1.5" cy="7" r="1" />
        <circle cx="6.5" cy="7" r="1" />
        <circle cx="1.5" cy="11.5" r="1" />
        <circle cx="6.5" cy="11.5" r="1" />
      </svg>
    </span>
  );
}

