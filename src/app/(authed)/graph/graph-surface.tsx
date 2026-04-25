"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useUnsavedDialog } from "@/components/unsaved-dialog";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  DEFAULT_IMPACT_FILTER,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import type {
  ActionRow,
  ActionTemplate,
  Citizen,
  City,
  Day,
  EndingVariable,
  EndingVariableValue,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { GraphView, type GraphSelection } from "./graph-view";
import { ImpactOverlayControls } from "./impact-overlay-controls";
import {
  LettersWorkspace,
  type ControlledSelection,
} from "../inspection/letters/workspace";

/**
 * Client wrapper that holds the impact-overlay filter (persisted to
 * localStorage), the inspector selection (graph node click → panel state),
 * and renders the graph next to the inspector panel when a node is selected.
 */
export function GraphSurface({
  storylines,
  letterGroups,
  letters,
  actions,
  actionTemplates,
  days,
  segments,
  nations,
  endingAssignments,
  heroes,
  allCitizenIds,
  cities,
  endingVariables,
  endingValues,
}: {
  storylines: Storyline[];
  letterGroups: LetterGroup[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  actionTemplates: ActionTemplate[];
  days: Day[];
  segments: ReportSegmentView[];
  nations: Nation[];
  endingAssignments: InspectionActionEndingAssignment[];
  heroes: Citizen[];
  allCitizenIds: string[];
  cities: City[];
  endingVariables: EndingVariable[];
  endingValues: EndingVariableValue[];
}) {
  const [filter, setFilter] = useLocalStorage<ImpactFilter>(
    "graph.impactFilter",
    DEFAULT_IMPACT_FILTER
  );
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorDirtyKind, setInspectorDirtyKind] = useState<string | null>(
    null
  );
  const inspectorDirty = inspectorDirtyKind !== null;
  const { ask: askUnsaved, dialog: unsavedDialogEl } = useUnsavedDialog();
  const saveAllRef = useRef<(() => Promise<void>) | null>(null);
  const router = useRouter();

  const initial = selectionToInitial(selection);

  // Resolve the unsaved-changes dialog by invoking the workspace's
  // saveAll, dropping the dirty flag, or aborting per the user's pick.
  // Returns true when the caller may proceed with its navigation.
  const resolveUnsavedDirty = useCallback(async () => {
    if (!(inspectorOpen && inspectorDirty)) return true;
    const outcome = await askUnsaved(`Unsaved ${inspectorDirtyKind}`);
    if (outcome === "cancel") return false;
    if (outcome === "save") {
      try {
        await saveAllRef.current?.();
      } catch {
        return false;
      }
    }
    setInspectorDirtyKind(null);
    return true;
  }, [askUnsaved, inspectorDirty, inspectorDirtyKind, inspectorOpen]);

  // Any node click (or panel-driven selection change) opens the
  // inspector. When the panel has unsaved changes, gate cross-selection
  // navigation behind the unsaved-changes dialog.
  const handleSelectionChange = useCallback(
    async (sel: GraphSelection | null) => {
      const ok = await resolveUnsavedDirty();
      if (!ok) return;
      setSelection(sel);
      if (sel) setInspectorOpen(true);
    },
    [resolveUnsavedDirty]
  );

  const handleInspectorToggle = useCallback(async () => {
    if (inspectorOpen) {
      const ok = await resolveUnsavedDirty();
      if (!ok) return;
    }
    setInspectorOpen((v) => !v);
  }, [inspectorOpen, resolveUnsavedDirty]);

  // Block leaving the page (browser nav / refresh) while there are
  // unsaved inspector changes.
  useEffect(() => {
    if (!inspectorDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [inspectorDirty]);

  // Intercept in-app link clicks (Next.js <Link> renders an <a>) so the
  // unsaved-changes dialog also gates client-side navigation. We attach
  // in the capture phase so we can preventDefault before Next.js's own
  // click handler kicks off the route push. After the user resolves the
  // prompt, we replay the navigation manually via router.push.
  useEffect(() => {
    if (!inspectorDirty) return;
    function onClickCapture(e: MouseEvent) {
      // Let modifier-clicks (open in new tab) through.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Skip in-page anchors and explicit new-tab targets.
      if (href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self")
        return;
      const url = new URL(anchor.href, window.location.href);
      const samePath =
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash;
      if (samePath) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const ok = await resolveUnsavedDirty();
        if (!ok) return;
        const sameOrigin = url.origin === window.location.origin;
        if (sameOrigin) {
          router.push(url.pathname + url.search + url.hash);
        } else {
          window.location.href = anchor.href;
        }
      })();
    }
    document.addEventListener("click", onClickCapture, true);
    return () =>
      document.removeEventListener("click", onClickCapture, true);
  }, [inspectorDirty, resolveUnsavedDirty, router]);

  return (
    <div>
      <PageHeader
        title="Narrative Graph"
        actions={
          <div className="flex items-center gap-2">
            <ImpactOverlayControls
              nations={nations}
              filter={filter}
              onFilterChange={setFilter}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={inspectorOpen}
              aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
              title={inspectorOpen ? "Close inspector" : "Open inspector"}
              onClick={handleInspectorToggle}
            >
              {inspectorOpen ? (
                <IconLayoutSidebarLeftExpand size={16} />
              ) : (
                <IconLayoutSidebarRightExpand size={16} />
              )}
            </Button>
          </div>
        }
      />
      {letterGroups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Create some storylines and letter groups to see the graph.
        </p>
      ) : (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <GraphView
              storylines={storylines}
              letterGroups={letterGroups}
              letters={letters}
              actions={actions}
              actionTemplates={actionTemplates}
              days={days}
              segments={segments}
              nations={nations}
              endingAssignments={endingAssignments}
              impactFilter={filter}
              selection={inspectorOpen ? selection : null}
              onSelectionChange={handleSelectionChange}
            />
          </div>
          {inspectorOpen ? (
            <aside className="w-[380px] shrink-0 lg:w-[420px]">
              <LettersWorkspace
                storylines={storylines}
                groups={letterGroups}
                days={days}
                letters={letters}
                actions={actions}
                templates={actionTemplates}
                heroes={heroes}
                allCitizenIds={allCitizenIds}
                cities={cities}
                nations={nations}
                segments={segments}
                endingVariables={endingVariables}
                endingValues={endingValues}
                endingAssignments={endingAssignments}
                initialGroupId={initial.groupId}
                initialLetterId={initial.letterId}
                initialSegmentId={initial.segmentId}
                controlledSelection={selection as ControlledSelection}
                onSelectionChange={(sel) => {
                  // Panel-driven selection changes (user clicking within
                  // the inspector list) are already dirty-guarded inside
                  // the workspace itself, so we mirror without
                  // re-prompting from here.
                  setSelection(sel as GraphSelection | null);
                }}
                onClose={() => {
                  void handleInspectorToggle();
                }}
                forceNarrow
                onDirtyChange={setInspectorDirtyKind}
                saveAllRef={saveAllRef}
              />
            </aside>
          ) : null}
        </div>
      )}
      {unsavedDialogEl}
    </div>
  );
}

function selectionToInitial(sel: GraphSelection | null): {
  groupId: string | null;
  letterId: string | null;
  segmentId: string | null;
} {
  if (!sel) return { groupId: null, letterId: null, segmentId: null };
  if (sel.kind === "group") {
    return { groupId: sel.groupId, letterId: null, segmentId: null };
  }
  if (sel.kind === "letter" || sel.kind === "actions") {
    return { groupId: sel.groupId, letterId: null, segmentId: null };
  }
  return { groupId: null, letterId: null, segmentId: sel.segmentId };
}
