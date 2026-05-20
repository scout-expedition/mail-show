"use client";

// The right-hand working area for a selected day: pinned intro block, a
// reorderable middle section interleaving letter-group blocks and generic
// report blocks, and a pinned sign-off block. Toggles to a preview.

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronsDownUp, ChevronsUpDown, Eye, ListCollapse } from "lucide-react";
import { PanelHeader, OverflowMenu } from "@/components/panel";
import { cn } from "@/lib/utils";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useSharedViewState } from "@/lib/realtime/use-shared-view-state";
import { useFlash } from "@/lib/realtime/use-flash";
import { FlashRing } from "@/lib/realtime/flash-ring";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  DayReportBlockView,
  InspectionLetterView,
  LetterGroup,
  ReportGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { PinnedBlock } from "./_blocks/pinned-block";
import { GenericReportBlock } from "./_blocks/generic-report-block";
import { LetterGroupBlock } from "./_blocks/letter-group-block";
import { InsertZone, type DragApi } from "./_blocks/block-shell";
import type { Trigger } from "./_blocks/report-block";
import type { MiddleItem } from "./_lib/middle-item";
import {
  MorningCollapseCtx,
  type MorningCollapseContext,
  type MorningCollapseMode,
} from "./_lib/collapse";
import { PreviewView } from "./preview-view";
import {
  createGenericReportBlock,
  renumberGenericReportBlocks,
  reorderDayReportBlocks,
} from "./actions";

/** Preview state shared live across everyone viewing a day — the preview
 *  toggle plus the per-letter-group simulation picks. Collapse state is
 *  deliberately NOT synced; it's a personal per-user choice. */
type MorningViewState = {
  previewOn: boolean;
  /** Per-letter-group simulation picks: groupId → letterId / actionId. */
  selectedLetter: Record<string, string>;
  selectedAction: Record<string, string>;
};

const WATCHED_TABLES = [
  "day_report_blocks",
  "report_segments",
  "days",
  "letter_groups",
  "actions",
  "inspection_letters",
];

const COLLAPSE_MODES: Array<{
  mode: MorningCollapseMode;
  Icon: typeof Eye;
  label: string;
}> = [
  { mode: "expanded", Icon: ChevronsUpDown, label: "Expand all" },
  { mode: "groups", Icon: ListCollapse, label: "Groups only" },
  { mode: "all", Icon: ChevronsDownUp, label: "Collapse all" },
];

export function MorningReportEditor({
  day,
  previousDay,
  blocks,
  segments,
  letterGroups,
  reportGroups,
  storylines,
  letters,
  actions,
  templates,
}: {
  day: Day;
  previousDay: Day | null;
  blocks: DayReportBlockView[];
  segments: ReportSegmentView[];
  letterGroups: LetterGroup[];
  reportGroups: ReportGroup[];
  storylines: Storyline[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  templates: ActionTemplate[];
}) {
  const router = useRouter();
  const { onPostgresChanges } = usePresenceContext();
  const [isPending, startTransition] = useTransition();

  // Coalesce postgres_changes echoes into a single debounced refresh so
  // structural + peer edits land without a refresh storm while typing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onPostgresChanges((change) => {
      if (!WATCHED_TABLES.includes(change.table)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [onPostgresChanges, router]);

  // --- collapse (personal — not synced across users) ---------------------
  const [collapseMode, setCollapseMode] =
    useState<MorningCollapseMode>("expanded");
  const [overrides, setOverrides] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const collapseCtx = useMemo<MorningCollapseContext>(
    () => ({
      mode: collapseMode,
      overrides,
      setOverride: (id, collapsed) =>
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(id, collapsed);
          return next;
        }),
    }),
    [collapseMode, overrides]
  );
  function setMode(mode: MorningCollapseMode) {
    setCollapseMode(mode);
    setOverrides(new Map());
  }

  // --- shared view state: preview ----------------------------------------
  // The preview toggle and the per-letter-group simulation picks (which
  // letter was delivered + which action was taken) are synced live to
  // everyone else viewing this day, so collaborators run the same
  // simulation together. Patches carry only the changed entry, so two
  // people picking for different groups never clobber each other; a peer's
  // change flashes the affected control.
  const { flashes, flash } = useFlash();
  const { state: viewState, update: updateView } =
    useSharedViewState<MorningViewState>({
      channelName: `morning-reports-view:${day.id}`,
      initialState: { previewOn: false, selectedLetter: {}, selectedAction: {} },
      onRemote: ({ prev, next, actorColor, kind }) => {
        // Only a live peer change flashes — a join catch-up adopts silently.
        if (kind !== "patch") return;
        const keys: string[] = [];
        if (prev.previewOn !== next.previewOn) keys.push("preview-toggle");
        for (const g of new Set([
          ...Object.keys(prev.selectedLetter),
          ...Object.keys(next.selectedLetter),
        ])) {
          if (prev.selectedLetter[g] !== next.selectedLetter[g]) {
            keys.push(`letter:${g}`);
          }
        }
        for (const g of new Set([
          ...Object.keys(prev.selectedAction),
          ...Object.keys(next.selectedAction),
        ])) {
          if (prev.selectedAction[g] !== next.selectedAction[g]) {
            keys.push(`action:${g}`);
          }
        }
        flash(keys, actorColor);
      },
    });
  const { previewOn, selectedLetter, selectedAction } = viewState;

  // --- lookups -----------------------------------------------------------
  const storylinesById = useMemo(
    () => new Map(storylines.map((s) => [s.id, s])),
    [storylines]
  );
  const lettersById = useMemo(
    () => new Map(letters.map((l) => [l.id, l])),
    [letters]
  );
  const templatesById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates]
  );
  const lgById = useMemo(
    () => new Map(letterGroups.map((g) => [g.id, g])),
    [letterGroups]
  );
  const reportGroupByLG = useMemo(
    () => new Map(reportGroups.map((rg) => [rg.letter_group_id, rg])),
    [reportGroups]
  );

  const landingSegments = useMemo(
    () => segments.filter((s) => s.effective_day_id === day.id),
    [segments, day.id]
  );
  const segmentsByLG = useMemo(() => {
    const m = new Map<string, ReportSegmentView[]>();
    for (const s of landingSegments) {
      const arr = m.get(s.letter_group_id) ?? [];
      arr.push(s);
      m.set(s.letter_group_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.variant.localeCompare(b.variant)
      );
    }
    return m;
  }, [landingSegments]);

  const triggersBySegment = useMemo(() => {
    const m = new Map<string, Trigger[]>();
    for (const a of actions) {
      if (!a.report_segment_id) continue;
      const letter = lettersById.get(a.inspection_letter_id);
      if (!letter) continue;
      const tpl = a.action_template_id
        ? templatesById.get(a.action_template_id)
        : undefined;
      const trigger: Trigger = {
        actionId: a.id,
        actionName: tpl?.name ?? a.name,
        actionIconType: tpl?.icon_type ?? a.icon_type,
        actionIconValue: tpl?.icon_value ?? a.icon_value,
        actionColorHex: tpl?.color_hex ?? a.color_hex ?? "#888888",
        letterContentId: letter.content_id,
        letterStoryline: storylinesById.get(letter.storyline_id),
        letterHref: letter.variant
          ? `/inspection/letters?letter=${letter.storyline_abbreviation}${letter.group_sequence}-${letter.variant}`
          : `/inspection/letters?group=${letter.storyline_abbreviation}${letter.group_sequence}`,
        letterSummary: letter.summary,
      };
      const arr = m.get(a.report_segment_id) ?? [];
      arr.push(trigger);
      m.set(a.report_segment_id, arr);
    }
    return m;
  }, [actions, lettersById, templatesById, storylinesById]);

  // --- middle items: stored blocks + derived letter-group anchors --------
  const middleItems = useMemo<MiddleItem[]>(() => {
    const landingLGIds = new Set(landingSegments.map((s) => s.letter_group_id));
    const items: MiddleItem[] = [];
    const anchored = new Set<string>();
    let maxSort = -1;
    for (const b of blocks) {
      maxSort = Math.max(maxSort, b.sort_order);
      if (b.kind === "generic") {
        items.push({
          kind: "generic",
          dragId: b.id,
          sortOrder: b.sort_order,
          block: b,
        });
      } else if (b.kind === "letter_group" && b.letter_group_id) {
        if (!landingLGIds.has(b.letter_group_id)) continue; // stale anchor
        const lg = lgById.get(b.letter_group_id);
        if (!lg) continue;
        anchored.add(b.letter_group_id);
        items.push({
          kind: "letter_group",
          dragId: b.id,
          sortOrder: b.sort_order,
          anchorId: b.id,
          letterGroup: lg,
          storyline: storylinesById.get(lg.storyline_id),
          segments: segmentsByLG.get(lg.id) ?? [],
        });
      }
    }
    const unanchored = [...landingLGIds]
      .filter((id) => !anchored.has(id))
      .map((id) => lgById.get(id))
      .filter((g): g is LetterGroup => Boolean(g))
      .sort(
        (a, b) =>
          (reportGroupByLG.get(a.id)?.display_order ?? 0) -
            (reportGroupByLG.get(b.id)?.display_order ?? 0) ||
          a.sequence - b.sequence
      );
    unanchored.forEach((lg, i) => {
      items.push({
        kind: "letter_group",
        dragId: `lg:${lg.id}`,
        sortOrder: maxSort + 1 + i,
        anchorId: null,
        letterGroup: lg,
        storyline: storylinesById.get(lg.storyline_id),
        segments: segmentsByLG.get(lg.id) ?? [],
      });
    });
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    return items;
  }, [
    blocks,
    landingSegments,
    segmentsByLG,
    lgById,
    storylinesById,
    reportGroupByLG,
  ]);

  // --- optimistic reorder ------------------------------------------------
  // `optimistic` holds a drag-reordered dragId list for instant feedback,
  // dropped the moment fresh server `blocks` arrive (via the sanctioned
  // "adjust state during render" pattern).
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [optimisticBasis, setOptimisticBasis] = useState(blocks);
  if (blocks !== optimisticBasis) {
    setOptimisticBasis(blocks);
    setOptimistic(null);
  }
  const orderedItems = useMemo(() => {
    if (!optimistic) return middleItems;
    const byId = new Map(middleItems.map((it) => [it.dragId, it]));
    const ordered = optimistic
      .map((id) => byId.get(id))
      .filter((x): x is MiddleItem => Boolean(x));
    for (const it of middleItems) {
      if (!optimistic.includes(it.dragId)) ordered.push(it);
    }
    return ordered;
  }, [optimistic, middleItems]);

  // --- reorder + insert --------------------------------------------------
  function buildPayload(order: string[], newGenericId?: string) {
    const byId = new Map(orderedItems.map((it) => [it.dragId, it]));
    return order.map((dragId, idx) => {
      const it = byId.get(dragId);
      if (!it) {
        // A freshly-created generic block not yet in orderedItems.
        return {
          id: dragId === newGenericId ? dragId : null,
          kind: "generic" as const,
          letter_group_id: null,
          sort_order: idx,
        };
      }
      return {
        id: it.kind === "generic" ? it.block.id : it.anchorId,
        kind: it.kind,
        letter_group_id:
          it.kind === "letter_group" ? it.letterGroup.id : null,
        sort_order: idx,
      };
    });
  }

  function commitReorder(
    dId: string,
    tgt: { id: string; pos: "before" | "after" }
  ) {
    if (dId === tgt.id) return;
    const order = orderedItems.map((it) => it.dragId);
    const from = order.indexOf(dId);
    if (from < 0) return;
    order.splice(from, 1);
    let to = order.indexOf(tgt.id);
    if (to < 0) return;
    if (tgt.pos === "after") to += 1;
    order.splice(to, 0, dId);
    setOptimistic(order);
    const payload = buildPayload(order);
    startTransition(async () => {
      await reorderDayReportBlocks({ day_id: day.id, blocks: payload });
      router.refresh();
    });
  }

  function handleInsertGeneric(index: number) {
    startTransition(async () => {
      const { id } = await createGenericReportBlock({ day_id: day.id });
      const order = orderedItems.map((it) => it.dragId);
      order.splice(Math.min(index, order.length), 0, id);
      await reorderDayReportBlocks({
        day_id: day.id,
        blocks: buildPayload(order, id),
      });
      router.refresh();
    });
  }

  function handleRenumber() {
    startTransition(async () => {
      await renumberGenericReportBlocks(day.id);
      router.refresh();
    });
  }

  // --- drag (ref-backed so drop reads current values) --------------------
  const draggingIdRef = useRef<string | null>(null);
  const targetRef = useRef<{ id: string; pos: "before" | "after" } | null>(
    null
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);

  function clearDrag() {
    draggingIdRef.current = null;
    targetRef.current = null;
    setDraggingId(null);
    setTarget(null);
  }

  const drag: DragApi = {
    draggingId,
    targetId: target?.id ?? null,
    targetPos: target?.pos ?? null,
    start: (id) => {
      draggingIdRef.current = id;
      setDraggingId(id);
    },
    over: (id, e) => {
      if (!draggingIdRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const rawAfter = e.clientY >= rect.top + rect.height / 2;
      // Normalize "after X" to "before next(X)" so each gap resolves to a
      // single insertion line — dropping into a gap behaves identically
      // whether the cursor is in the upper or lower block.
      let normId = id;
      let normPos: "before" | "after" = rawAfter ? "after" : "before";
      if (rawAfter) {
        const idx = orderedItems.findIndex((it) => it.dragId === id);
        const next = orderedItems[idx + 1];
        if (next) {
          normId = next.dragId;
          normPos = "before";
        }
      }
      if (
        targetRef.current?.id === normId &&
        targetRef.current.pos === normPos
      ) {
        return;
      }
      targetRef.current = { id: normId, pos: normPos };
      setTarget({ id: normId, pos: normPos });
    },
    drop: () => {
      const dId = draggingIdRef.current;
      const tgt = targetRef.current;
      clearDrag();
      if (dId && tgt) commitReorder(dId, tgt);
    },
    end: clearDrag,
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <PanelHeader
        title={
          day.name
            ? `${day.identifier} · ${day.name}`
            : `${day.identifier} report`
        }
        menu={
          <div className="flex items-center gap-1">
            <div className="flex items-center overflow-hidden rounded-md border border-border">
              {COLLAPSE_MODES.map((m, i) => {
                const active = collapseMode === m.mode && overrides.size === 0;
                return (
                  <button
                    key={m.mode}
                    type="button"
                    onClick={() => setMode(m.mode)}
                    aria-label={m.label}
                    title={m.label}
                    className={cn(
                      "inline-flex h-6 w-7 items-center justify-center",
                      i > 0 && "border-l border-border",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <m.Icon size={14} aria-hidden />
                  </button>
                );
              })}
            </div>
            <FlashRing color={flashes["preview-toggle"]}>
              <button
                type="button"
                onClick={() => updateView({ previewOn: !previewOn })}
                aria-label="Toggle preview"
                aria-pressed={previewOn}
                title="Preview morning report"
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                  previewOn
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Eye size={14} aria-hidden />
              </button>
            </FlashRing>
            <OverflowMenu
              items={[
                {
                  label: "Renumber report segments",
                  onClick: handleRenumber,
                },
              ]}
            />
          </div>
        }
      />

      {previewOn ? (
        <PreviewView
          day={day}
          previousDay={previousDay}
          items={orderedItems}
          letters={letters}
          actions={actions}
          templates={templates}
          selectedLetter={selectedLetter}
          selectedAction={selectedAction}
          onSelectionChange={updateView}
          flashes={flashes}
        />
      ) : (
        <MorningCollapseCtx.Provider value={collapseCtx}>
          <div className="flex flex-col gap-1 p-3">
            <PinnedBlock
              dayId={day.id}
              dayNumber={day.number}
              field="base_report"
              value={day.base_report}
              label="Intro"
            />
            {orderedItems.length === 0 ? (
              <InsertZone
                alwaysVisible
                disabled={isPending}
                onAdd={() => handleInsertGeneric(0)}
              />
            ) : (
              <>
                {orderedItems.map((it, i) => (
                  <Fragment key={it.dragId}>
                    <InsertZone
                      disabled={isPending}
                      onAdd={() => handleInsertGeneric(i)}
                    />
                    {it.kind === "generic" ? (
                      <GenericReportBlock
                        dragId={it.dragId}
                        drag={drag}
                        block={it.block}
                        dayNumber={day.number}
                      />
                    ) : (
                      <LetterGroupBlock
                        dragId={it.dragId}
                        drag={drag}
                        letterGroup={it.letterGroup}
                        storyline={it.storyline}
                        segments={it.segments}
                        triggersBySegment={triggersBySegment}
                      />
                    )}
                  </Fragment>
                ))}
                <InsertZone
                  disabled={isPending}
                  onAdd={() => handleInsertGeneric(orderedItems.length)}
                />
              </>
            )}
            <PinnedBlock
              dayId={day.id}
              dayNumber={day.number}
              field="report_sign_off"
              value={day.report_sign_off}
              label="Sign-off"
            />
          </div>
        </MorningCollapseCtx.Provider>
      )}
    </div>
  );
}
