"use client";

import { PageHeader } from "@/components/page-header";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  DEFAULT_IMPACT_FILTER,
  type ImpactFilter,
} from "@/lib/graph-overlay";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { GraphView } from "./graph-view";
import { ImpactOverlayControls } from "./impact-overlay-controls";

/**
 * Client wrapper that holds the impact-overlay filter (persisted to
 * localStorage) and wires the PageHeader controls to the GraphView.
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
}) {
  const [filter, setFilter] = useLocalStorage<ImpactFilter>(
    "graph.impactFilter",
    DEFAULT_IMPACT_FILTER
  );

  return (
    <div>
      <PageHeader
        title="Narrative graph"
        description="Columns are days; rows are storylines. Letter groups sit in their delivery day; actions arrow to report segments and the next letter."
        actions={
          <ImpactOverlayControls
            nations={nations}
            filter={filter}
            onFilterChange={setFilter}
          />
        }
      />
      {letterGroups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Create some storylines and letter groups to see the graph.
        </p>
      ) : (
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
        />
      )}
    </div>
  );
}
