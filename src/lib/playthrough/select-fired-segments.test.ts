import { describe, expect, it } from "vitest";
import { selectFiredReportSegments } from "./select-fired-segments";

// Minimal action stub type — only the fields the helper reads.
type StubAction = { id: string; report_segment_id: string | null };

function makeAction(
  id: string,
  report_segment_id: string | null = null
): StubAction {
  return { id, report_segment_id };
}

describe("selectFiredReportSegments", () => {
  it("returns an empty set when no actions are chosen", () => {
    const actions = [makeAction("a1", "seg-1"), makeAction("a2", "seg-2")];
    const result = selectFiredReportSegments(actions, {});
    expect(result.size).toBe(0);
  });

  it("returns an empty set when the action map contains only empty strings", () => {
    const actions = [makeAction("a1", "seg-1")];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "",
    });
    expect(result.size).toBe(0);
  });

  it("collects the report_segment_id for a single chosen action", () => {
    const actions = [makeAction("a1", "seg-1"), makeAction("a2", "seg-2")];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "a1",
    });
    expect(result).toEqual(new Set(["seg-1"]));
  });

  it("collects segment ids across multiple letter choices", () => {
    const actions = [
      makeAction("a1", "seg-A"),
      makeAction("a2", "seg-B"),
      makeAction("a3", "seg-C"),
    ];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "a1",
      "letter-2": "a3",
    });
    expect(result).toEqual(new Set(["seg-A", "seg-C"]));
  });

  it("ignores chosen actions whose report_segment_id is null", () => {
    const actions = [
      makeAction("a1", null),   // no report segment
      makeAction("a2", "seg-B"),
    ];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "a1",
      "letter-2": "a2",
    });
    expect(result).toEqual(new Set(["seg-B"]));
  });

  it("does not duplicate a segment id when two letters fire the same action", () => {
    const actions = [makeAction("a1", "seg-shared")];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "a1",
      "letter-2": "a1",
    });
    expect(result.size).toBe(1);
    expect(result.has("seg-shared")).toBe(true);
  });

  it("skips chosen_action_id values not present in the actions list", () => {
    const actions = [makeAction("a1", "seg-1")];
    const result = selectFiredReportSegments(actions, {
      "letter-1": "unknown-id",
    });
    expect(result.size).toBe(0);
  });

  it("handles undefined values in the selection map gracefully", () => {
    const actions = [makeAction("a1", "seg-1")];
    const result = selectFiredReportSegments(actions, {
      "letter-1": undefined,
    });
    expect(result.size).toBe(0);
  });
});
