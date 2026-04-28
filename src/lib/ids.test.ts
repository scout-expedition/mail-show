import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatInspectionLetterId,
  formatReportId,
  formatRfidPayload,
  formatSortingLetterId,
  randomLetterId,
} from "./ids";

describe("formatInspectionLetterId", () => {
  it("should omit variant and piece when both are absent", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
      })
    ).toBe("L-W21");
  });

  it("should include /variant when variant is present and piece is absent", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
        variant: "a",
      })
    ).toBe("L-W21/a");
  });

  it("should include piece when piece is present and variant is absent", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
        piece: 2,
      })
    ).toBe("L-W212");
  });

  it("should include both /variant and piece when both are present", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
        variant: "b",
        piece: 3,
      })
    ).toBe("L-W21/b3");
  });

  it("should treat null variant and null piece as absent", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
        variant: null,
        piece: null,
      })
    ).toBe("L-W21");
  });

  it("should preserve a piece value of 0", () => {
    expect(
      formatInspectionLetterId({
        storylineAbbreviation: "W2",
        groupSequence: 1,
        piece: 0,
      })
    ).toBe("L-W210");
  });
});

describe("formatReportId", () => {
  it("should always include the variant after a slash", () => {
    expect(
      formatReportId({
        storylineAbbreviation: "W2",
        groupSequence: 3,
        variant: "ii",
      })
    ).toBe("R-W23/ii");
  });
});

describe("formatSortingLetterId", () => {
  it("should zero-pad the sortId to 2 digits", () => {
    expect(formatSortingLetterId({ dayNumber: 2, sortId: 9 })).toBe("S2-09");
  });

  it("should not pad when sortId is already 2 digits", () => {
    expect(formatSortingLetterId({ dayNumber: 2, sortId: 42 })).toBe("S2-42");
  });
});

describe("formatRfidPayload", () => {
  it("should zero-pad to 6 digits with the SL prefix", () => {
    expect(formatRfidPayload(7)).toBe("SL000007");
  });

  it("should not pad when value is already 6 digits", () => {
    expect(formatRfidPayload(123456)).toBe("SL123456");
  });
});

describe("randomLetterId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return an integer in [0, 999_999] for any Math.random output", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(randomLetterId()).toBe(0);

    vi.spyOn(Math, "random").mockReturnValue(0.9999999);
    expect(randomLetterId()).toBe(999_999);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(randomLetterId()).toBe(500_000);
  });
});
