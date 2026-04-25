"use client";

import { useState } from "react";
import {
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
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

  const initial = selectionToInitial(selection);

  // Any node click opens the inspector; explicit toggle lets the user
  // collapse it without losing their selection.
  const handleSelectionChange = (sel: GraphSelection | null) => {
    setSelection(sel);
    if (sel) setInspectorOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Narrative graph"
        description="Rows are days; columns are storylines. Letter groups sit in their delivery day; actions arrow downward to report segments and the next letter."
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
              onClick={() => setInspectorOpen((v) => !v)}
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
                onSelectionChange={(sel) =>
                  setSelection(sel as GraphSelection | null)
                }
                onClose={() => setInspectorOpen(false)}
                forceNarrow
              />
            </aside>
          ) : null}
        </div>
      )}
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
