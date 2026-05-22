import type { InspectionLetterView } from "@/lib/db/types";

export type PieceGroupKey = string; // `${letter_group_id}:${variant}`

export function pieceGroupKey(
  letter: Pick<InspectionLetterView, "letter_group_id" | "variant" | "piece">
): PieceGroupKey | null {
  if (!letter.variant) return null;
  if (!letter.piece || letter.piece < 1) return null;
  return `${letter.letter_group_id}:${letter.variant}`;
}

export function isInPieceGroup(
  letter: Pick<InspectionLetterView, "piece">
): boolean {
  return (letter.piece ?? 0) >= 1;
}

export type ReorderSlot =
  | { kind: "letter"; letterId: string }
  | { kind: "pieceGroup"; letterGroupId: string; variant: string };

export type LetterSlot<L> =
  | { kind: "letter"; letter: L }
  | {
      kind: "pieceGroup";
      key: PieceGroupKey;
      letterGroupId: string;
      variant: string;
      members: L[];
    };

export function groupLettersByPieceGroup<
  L extends Pick<
    InspectionLetterView,
    "id" | "letter_group_id" | "variant" | "piece" | "sort_order"
  >
>(letters: L[]): LetterSlot<L>[] {
  // Bucket letters by piece-group key; standalone letters are their own slot.
  // Slot rank = min(sort_order) of its members. Sort slots by rank ascending.

  const groupMap = new Map<PieceGroupKey, L[]>();
  const standalones: L[] = [];

  for (const letter of letters) {
    const key = pieceGroupKey(letter);
    if (key !== null) {
      const bucket = groupMap.get(key) ?? [];
      bucket.push(letter);
      groupMap.set(key, bucket);
    } else {
      standalones.push(letter);
    }
  }

  const slots: LetterSlot<L>[] = [];

  // Add piece-group slots, sorting members by sort_order within each bucket.
  for (const [key, members] of groupMap) {
    const sorted = members.slice().sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    const firstMember = sorted[0];
    slots.push({
      kind: "pieceGroup",
      key,
      letterGroupId: firstMember.letter_group_id,
      variant: firstMember.variant as string,
      members: sorted,
    });
  }

  // Add standalone letter slots.
  for (const letter of standalones) {
    slots.push({ kind: "letter", letter });
  }

  // Sort all slots by rank (min sort_order of their members).
  slots.sort((a, b) => {
    const rankA =
      a.kind === "letter"
        ? (a.letter.sort_order ?? 0)
        : Math.min(...a.members.map((m) => m.sort_order ?? 0));
    const rankB =
      b.kind === "letter"
        ? (b.letter.sort_order ?? 0)
        : Math.min(...b.members.map((m) => m.sort_order ?? 0));
    return rankA - rankB;
  });

  return slots;
}

/** Strip trailing digits from a content_id to get the variant-only label.
 *  e.g. "L-W1/a2" -> "L-W1/a" */
export function pieceGroupContentId(
  letter: Pick<InspectionLetterView, "content_id">
): string {
  return letter.content_id.replace(/\d+$/, "");
}

/** Display label for a next-letter reference: collapses piece groups to their
 *  variant-only label; standalone letters keep their full content_id. */
export function displayNextLetterId(
  letter: Pick<InspectionLetterView, "content_id" | "piece">
): string {
  return isInPieceGroup(letter) ? pieceGroupContentId(letter) : letter.content_id;
}
