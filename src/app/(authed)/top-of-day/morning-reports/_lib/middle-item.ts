import type {
  DayReportBlockView,
  LetterGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";

/**
 * One entry in a day's reorderable middle section. Either a stored generic
 * report block, or a derived letter-group block (its `anchorId` is the
 * day_report_blocks anchor row, or null when no anchor exists yet).
 */
export type MiddleItem =
  | {
      kind: "generic";
      dragId: string;
      sortOrder: number;
      block: DayReportBlockView;
    }
  | {
      kind: "letter_group";
      dragId: string;
      sortOrder: number;
      anchorId: string | null;
      letterGroup: LetterGroup;
      storyline: Storyline | undefined;
      segments: ReportSegmentView[];
    };
