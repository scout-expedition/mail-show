// Pure helpers for the graph layout's group-instance partitioning.
//
// The `useMemo` inside `graph-view.tsx` builds one "group instance" per
// (letter group × effective day) pair: the primary instance sits on the
// group's home delivery day, and a secondary "faux" instance is minted for
// every override day a letter from the group lands on. This file extracts
// the day-bucketing logic so it can be unit-tested without spinning up
// ReactFlow.

/** Minimal letter shape the partition needs. */
export type PartitionLetter = {
  id: string;
  variant: string | null;
  piece: number | null;
  /** Resolved by the view (override → offset → group default). May be
   *  null when neither the letter nor its group has a delivery day. */
  effective_day_id: string | null;
};

/** Minimal group shape the partition needs. */
export type PartitionGroup = {
  id: string;
  /** The group's home delivery day. null = unscheduled. */
  delivery_day_id: string | null;
};

/**
 * A single (group × day) instance. `dayKey` is null on the primary
 * instance (the group's own delivery day), and the override-day id on
 * each secondary instance.
 *   - rowId: the day bucket key ("unscheduled" or a day id). Used by the
 *     graph's cell map to place the instance in the right row.
 *   - variants: the variant keys that land on this day. May be empty for
 *     the primary instance when every variant has been pulled away by an
 *     override.
 */
export type GroupInstancePartition = {
  rowId: string;
  dayKey: string | null;
  variants: string[];
};

/** Normalize a nullable variant string the same way the graph does. */
export function variantKey(v: string | null): string {
  return v ?? "";
}

/**
 * Bucket a group's letters by their effective day so each (group × day)
 * pair becomes one render-time instance. Drives the "letter with an
 * override pin appears on the override day, not the group's home day"
 * behavior.
 *
 * Bucketing rules:
 *   - A variant's day is the LETTER row's `effective_day_id` (the view
 *     already resolves override → offset → group default).
 *   - When a variant has multiple letter rows (different `piece`s), use
 *     the lowest piece — that's the primary letter for the variant and
 *     the override is set per-letter, so all pieces should agree.
 *   - The primary instance for the group's home day always renders, even
 *     if every variant has been pulled away by an override (so the
 *     group's "home" pill still has a card on the canvas).
 */
export function partitionGroupInstances(
  group: PartitionGroup,
  groupLetters: PartitionLetter[]
): GroupInstancePartition[] {
  const gDayKey = group.delivery_day_id ?? "unscheduled";

  // Lowest-piece letter wins as the "primary" for each variant. Sort by
  // variant first, then piece ascending; the first occurrence of each
  // variant in the sorted order is the primary.
  const sorted = groupLetters.slice().sort((a, b) => {
    const va = a.variant ?? "";
    const vb = b.variant ?? "";
    if (va !== vb) return va.localeCompare(vb);
    return (a.piece ?? 0) - (b.piece ?? 0);
  });

  const variantByLetter: Array<{ variant: string; dayKey: string }> = [];
  const seen = new Set<string>();
  for (const l of sorted) {
    const vk = variantKey(l.variant);
    if (seen.has(vk)) continue;
    seen.add(vk);
    variantByLetter.push({
      variant: vk,
      dayKey: l.effective_day_id ?? "unscheduled",
    });
  }

  // Always include the home-day bucket, even if empty, so the group's
  // primary pill renders.
  const variantsByDay = new Map<string, string[]>();
  variantsByDay.set(gDayKey, []);
  for (const { variant, dayKey } of variantByLetter) {
    const list = variantsByDay.get(dayKey) ?? [];
    list.push(variant);
    variantsByDay.set(dayKey, list);
  }

  const instances: GroupInstancePartition[] = [];
  for (const [dayKey, vs] of variantsByDay) {
    const isPrimary = dayKey === gDayKey;
    instances.push({
      rowId: dayKey,
      dayKey: isPrimary ? null : dayKey,
      variants: vs,
    });
  }
  return instances;
}
