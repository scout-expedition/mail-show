import { lpad } from "@/lib/utils";

/** Format an inspection-letter content id: L-[storyline.abbr][group.seq][/variant][piece]. */
export function formatInspectionLetterId(params: {
  storylineAbbreviation: string;
  groupSequence: number;
  variant?: string | null;
  piece?: number | null;
}): string {
  const { storylineAbbreviation, groupSequence, variant, piece } = params;
  const v = variant ? `/${variant}` : "";
  const p = piece != null ? String(piece) : "";
  return `L-${storylineAbbreviation}${groupSequence}${v}${p}`;
}

/** Format a report id: R-[storyline.abbr][group.seq]/[variant]. */
export function formatReportId(params: {
  storylineAbbreviation: string;
  groupSequence: number;
  variant: string;
}): string {
  const { storylineAbbreviation, groupSequence, variant } = params;
  return `R-${storylineAbbreviation}${groupSequence}/${variant}`;
}

/** Format a sorting-letter content id: S#-##. */
export function formatSortingLetterId(params: {
  dayNumber: number;
  sortId: number;
}): string {
  return `S${params.dayNumber}-${lpad(params.sortId, 2)}`;
}

/** Format an RFID payload from a physical letter's numeric letter_id. */
export function formatRfidPayload(letterId: number): string {
  return `SL${lpad(letterId, 6)}`;
}

/** Random 6-digit integer for physical letter IDs. */
export function randomLetterId(): number {
  return Math.floor(Math.random() * 1_000_000);
}
