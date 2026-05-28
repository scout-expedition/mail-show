/**
 * Pure helper: given a list of actions and a per-letter action-choice map,
 * returns the set of report_segment_ids that would fire.
 *
 * Extracted from the `firedSegmentIds` memo in
 * `src/app/(authed)/top-of-day/morning-reports/preview-view.tsx` so it can be
 * shared between the interactive editor (via useMemo) and the read-only
 * play-mode MorningReportSummary (direct call with frozen playthrough state).
 *
 * @param actions           All ActionRows available for the relevant letters.
 * @param selectedActionByLetter  Map of inspection_letter_id → chosen_action_id
 *                                (or "" / undefined when nothing is chosen).
 */
export function selectFiredReportSegments(
  actions: { id: string; report_segment_id: string | null }[],
  selectedActionByLetter: Record<string, string | undefined>
): Set<string> {
  const set = new Set<string>();
  for (const actionId of Object.values(selectedActionByLetter)) {
    if (!actionId) continue;
    const act = actions.find((a) => a.id === actionId);
    if (act?.report_segment_id) set.add(act.report_segment_id);
  }
  return set;
}
