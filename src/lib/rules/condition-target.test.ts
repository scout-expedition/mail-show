import { describe, it, expect } from "vitest";
import type { RuleTarget } from "@/lib/db/enums";
import { SELECTABLE_RULE_TARGETS } from "@/lib/db/enums";
import {
  decodeTarget,
  encodeTarget,
  SUBJECT_OPTIONS,
  FIELD_OPTIONS,
} from "./condition-target";
import type { TargetSubject, TargetField } from "./condition-target";

// ---------------------------------------------------------------------------
// decodeTarget
// ---------------------------------------------------------------------------

describe("decodeTarget", () => {
  it("is_counterfeit → counterfeit, null field", () => {
    expect(decodeTarget("is_counterfeit")).toEqual({
      subject: "counterfeit",
      field: null,
    });
  });

  it("current_day_of_week → day, null field", () => {
    expect(decodeTarget("current_day_of_week")).toEqual({
      subject: "day",
      field: null,
    });
  });

  it("sender_nation → sender, nation", () => {
    expect(decodeTarget("sender_nation")).toEqual({
      subject: "sender",
      field: "nation",
    });
  });

  it("recipient_first_name → recipient, first_name", () => {
    expect(decodeTarget("recipient_first_name")).toEqual({
      subject: "recipient",
      field: "first_name",
    });
  });

  it("sender_middle_name → sender, middle_name", () => {
    expect(decodeTarget("sender_middle_name")).toEqual({
      subject: "sender",
      field: "middle_name",
    });
  });

  it("recipient_last_name → recipient, last_name", () => {
    expect(decodeTarget("recipient_last_name")).toEqual({
      subject: "recipient",
      field: "last_name",
    });
  });

  it("sender_citizen_id → sender, citizen_id", () => {
    expect(decodeTarget("sender_citizen_id")).toEqual({
      subject: "sender",
      field: "citizen_id",
    });
  });

  it("recipient_city_name → recipient, city_name", () => {
    expect(decodeTarget("recipient_city_name")).toEqual({
      subject: "recipient",
      field: "city_name",
    });
  });

  it("sender_city_code → sender, city_code", () => {
    expect(decodeTarget("sender_city_code")).toEqual({
      subject: "sender",
      field: "city_code",
    });
  });

  describe("legacy targets decode to first_name (best-effort display)", () => {
    it("sender_name → sender, first_name", () => {
      expect(decodeTarget("sender_name")).toEqual({
        subject: "sender",
        field: "first_name",
      });
    });

    it("recipient_name → recipient, first_name", () => {
      expect(decodeTarget("recipient_name")).toEqual({
        subject: "recipient",
        field: "first_name",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// encodeTarget
// ---------------------------------------------------------------------------

describe("encodeTarget", () => {
  it("counterfeit → is_counterfeit", () => {
    expect(encodeTarget({ subject: "counterfeit", field: null })).toBe(
      "is_counterfeit"
    );
  });

  it("day → current_day_of_week", () => {
    expect(encodeTarget({ subject: "day", field: null })).toBe(
      "current_day_of_week"
    );
  });

  it("sender + nation → sender_nation", () => {
    expect(encodeTarget({ subject: "sender", field: "nation" })).toBe(
      "sender_nation"
    );
  });

  it("sender + first_name → sender_first_name", () => {
    expect(encodeTarget({ subject: "sender", field: "first_name" })).toBe(
      "sender_first_name"
    );
  });

  it("recipient + last_name → recipient_last_name", () => {
    expect(encodeTarget({ subject: "recipient", field: "last_name" })).toBe(
      "recipient_last_name"
    );
  });

  it("sender + null field → defaults to sender_first_name", () => {
    expect(encodeTarget({ subject: "sender", field: null })).toBe(
      "sender_first_name"
    );
  });

  it("recipient + null field → defaults to recipient_first_name", () => {
    expect(encodeTarget({ subject: "recipient", field: null })).toBe(
      "recipient_first_name"
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip: decodeTarget(encodeTarget(c)) deep-equals c for all non-legacy
// ---------------------------------------------------------------------------

describe("round-trip encodeTarget → decodeTarget", () => {
  const nonLegacyTargets = SELECTABLE_RULE_TARGETS;

  it.each(nonLegacyTargets as RuleTarget[])(
    "round-trips %s",
    (target) => {
      const composite = decodeTarget(target);
      const reEncoded = encodeTarget(composite);
      const reDecoded = decodeTarget(reEncoded);
      expect(reDecoded).toEqual(composite);
    }
  );
});

// ---------------------------------------------------------------------------
// SUBJECT_OPTIONS and FIELD_OPTIONS
// ---------------------------------------------------------------------------

describe("SUBJECT_OPTIONS", () => {
  it("contains exactly 4 entries", () => {
    expect(SUBJECT_OPTIONS).toHaveLength(4);
  });

  it("covers all TargetSubject values", () => {
    const subjects: TargetSubject[] = [
      "sender",
      "recipient",
      "day",
      "counterfeit",
    ];
    const values = SUBJECT_OPTIONS.map((o) => o.value);
    for (const s of subjects) {
      expect(values).toContain(s);
    }
  });

  it("has string labels for all entries", () => {
    for (const opt of SUBJECT_OPTIONS) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("FIELD_OPTIONS", () => {
  it("contains exactly 7 entries", () => {
    expect(FIELD_OPTIONS).toHaveLength(7);
  });

  it("covers all TargetField values", () => {
    const fields: TargetField[] = [
      "first_name",
      "middle_name",
      "last_name",
      "citizen_id",
      "city_name",
      "city_code",
      "nation",
    ];
    const values = FIELD_OPTIONS.map((o) => o.value);
    for (const f of fields) {
      expect(values).toContain(f);
    }
  });

  it("has string labels for all entries", () => {
    for (const opt of FIELD_OPTIONS) {
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});
