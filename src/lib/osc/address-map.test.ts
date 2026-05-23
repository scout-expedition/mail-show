import { describe, expect, it } from "vitest";
import {
  type InboundMessage,
  type OscPacket,
  type OutboundMessage,
  parse,
  serialize,
  tryParse,
} from "./address-map";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkt(address: string, ...args: Array<string | number | boolean>): OscPacket {
  return { address, args };
}

// ---------------------------------------------------------------------------
// Outbound: serialize()
// ---------------------------------------------------------------------------

describe("serialize — outbound messages", () => {
  it("day_set produces /show/day/set with int arg", () => {
    const msg: OutboundMessage = { kind: "day_set", day: 3 };
    expect(serialize(msg)).toEqual({ address: "/show/day/set", args: [3] });
  });

  it("phase_set produces /show/phase/set with phase string", () => {
    const msg: OutboundMessage = { kind: "phase_set", phase: "sorting" };
    expect(serialize(msg)).toEqual({
      address: "/show/phase/set",
      args: ["sorting"],
    });
  });

  it("phase_set accepts all four phase values", () => {
    const phases = [
      "top_of_day",
      "sorting",
      "inspection",
      "end_of_day",
    ] as const;
    for (const phase of phases) {
      expect(serialize({ kind: "phase_set", phase })).toEqual({
        address: "/show/phase/set",
        args: [phase],
      });
    }
  });

  it("phase_start produces /show/phase/start with no args", () => {
    expect(serialize({ kind: "phase_start" })).toEqual({
      address: "/show/phase/start",
      args: [],
    });
  });

  it("phase_pause produces /show/phase/pause with no args", () => {
    expect(serialize({ kind: "phase_pause" })).toEqual({
      address: "/show/phase/pause",
      args: [],
    });
  });

  it("phase_resume produces /show/phase/resume with no args", () => {
    expect(serialize({ kind: "phase_resume" })).toEqual({
      address: "/show/phase/resume",
      args: [],
    });
  });

  it("phase_next produces /show/phase/next with no args", () => {
    expect(serialize({ kind: "phase_next" })).toEqual({
      address: "/show/phase/next",
      args: [],
    });
  });

  it("phase_timer_end produces /show/phase/timer/end with no args", () => {
    expect(serialize({ kind: "phase_timer_end" })).toEqual({
      address: "/show/phase/timer/end",
      args: [],
    });
  });

  it("report_segment produces /show/report/segment with report ID arg", () => {
    expect(serialize({ kind: "report_segment", reportId: "R-W2/ii" })).toEqual(
      { address: "/show/report/segment", args: ["R-W2/ii"] }
    );
  });

  it("status_day produces /show/status/day with int arg", () => {
    expect(serialize({ kind: "status_day", day: 1 })).toEqual({
      address: "/show/status/day",
      args: [1],
    });
  });

  it("status_phase produces /show/status/phase with phase string", () => {
    expect(
      serialize({ kind: "status_phase", phase: "inspection" })
    ).toEqual({ address: "/show/status/phase", args: ["inspection"] });
  });

  it("status_timer produces /show/status/timer with remainingMs and running bool", () => {
    expect(
      serialize({ kind: "status_timer", remainingMs: 30000, running: true })
    ).toEqual({ address: "/show/status/timer", args: [30000, true] });
  });

  it("status_timer running=false", () => {
    expect(
      serialize({ kind: "status_timer", remainingMs: 0, running: false })
    ).toEqual({ address: "/show/status/timer", args: [0, false] });
  });

  it("status_letter produces /show/status/letter with contentId and state", () => {
    expect(
      serialize({
        kind: "status_letter",
        contentId: "L-W2/b3",
        state: "delivered",
      })
    ).toEqual({
      address: "/show/status/letter",
      args: ["L-W2/b3", "delivered"],
    });
  });

  it("status_letter supports flagged and choice states", () => {
    expect(
      serialize({ kind: "status_letter", contentId: "L-W2/b3", state: "flagged" })
    ).toEqual({ address: "/show/status/letter", args: ["L-W2/b3", "flagged"] });

    expect(
      serialize({ kind: "status_letter", contentId: "L-W2/b3", state: "choice" })
    ).toEqual({ address: "/show/status/letter", args: ["L-W2/b3", "choice"] });
  });

  it("status_slot produces /show/status/slot with slotId and outcome", () => {
    expect(
      serialize({ kind: "status_slot", slotId: 3, outcome: "pass" })
    ).toEqual({ address: "/show/status/slot", args: [3, "pass"] });
  });

  it("status_slot supports fail and error outcomes", () => {
    expect(serialize({ kind: "status_slot", slotId: 1, outcome: "fail" })).toEqual(
      { address: "/show/status/slot", args: [1, "fail"] }
    );
    expect(serialize({ kind: "status_slot", slotId: 2, outcome: "error" })).toEqual(
      { address: "/show/status/slot", args: [2, "error"] }
    );
  });
});

// ---------------------------------------------------------------------------
// Inbound: parse() round-trips
// ---------------------------------------------------------------------------

describe("parse — inbound messages", () => {
  it("parses /show/status/day/get with no args", () => {
    const result = parse(pkt("/show/status/day/get"));
    const expected: InboundMessage = { kind: "status_day_get" };
    expect(result).toEqual(expected);
  });

  it("parses /show/status/phase/get with no args", () => {
    expect(parse(pkt("/show/status/phase/get"))).toEqual({
      kind: "status_phase_get",
    });
  });

  it("parses /show/status/timer/get with no args", () => {
    expect(parse(pkt("/show/status/timer/get"))).toEqual({
      kind: "status_timer_get",
    });
  });

  it("parses /show/status/letter/get with a content ID arg", () => {
    expect(parse(pkt("/show/status/letter/get", "L-W2/b3"))).toEqual({
      kind: "status_letter_get",
      contentId: "L-W2/b3",
    });
  });

  it("parses /rfid/slot with slotId and RFID payload", () => {
    expect(parse(pkt("/rfid/slot", 3, "SL000042"))).toEqual({
      kind: "rfid_slot",
      slotId: 3,
      payload: "SL000042",
    });
  });

  it("parses /rfid/slot/clear with slotId", () => {
    expect(parse(pkt("/rfid/slot/clear", 7))).toEqual({
      kind: "rfid_slot_clear",
      slotId: 7,
    });
  });

  it("parses slotId 0 (boundary)", () => {
    expect(parse(pkt("/rfid/slot/clear", 0))).toEqual({
      kind: "rfid_slot_clear",
      slotId: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Content-ID slash preservation
// ---------------------------------------------------------------------------

describe("content ID slash round-trip", () => {
  it("L-W2/b3 survives as a serialize argument", () => {
    const msg: OutboundMessage = {
      kind: "status_letter",
      contentId: "L-W2/b3",
      state: "delivered",
    };
    const { address, args } = serialize(msg);
    expect(address).toBe("/show/status/letter");
    expect(args[0]).toBe("L-W2/b3"); // slash in arg, not mangled into the path
  });

  it("R-W2/ii survives as a report_segment arg", () => {
    const { address, args } = serialize({
      kind: "report_segment",
      reportId: "R-W2/ii",
    });
    expect(address).toBe("/show/report/segment");
    expect(args[0]).toBe("R-W2/ii");
  });

  it("R-W2/ii survives parse round-trip via /show/status/letter/get", () => {
    const result = parse(pkt("/show/status/letter/get", "R-W2/ii"));
    expect(result).toEqual({ kind: "status_letter_get", contentId: "R-W2/ii" });
  });

  it("SL000042 survives as a payload arg in /rfid/slot", () => {
    const result = parse(pkt("/rfid/slot", 1, "SL000042"));
    expect((result as { payload: string }).payload).toBe("SL000042");
  });
});

// ---------------------------------------------------------------------------
// Malformed inbound — parse() throws, tryParse() returns null
// ---------------------------------------------------------------------------

describe("parse — malformed packets", () => {
  it("throws on unknown address", () => {
    expect(() => parse(pkt("/unknown/path"))).toThrow(/Unknown OSC address/);
  });

  it("tryParse returns null for unknown address", () => {
    expect(tryParse(pkt("/unknown/path"))).toBeNull();
  });

  it("throws when /show/status/letter/get is missing the contentId arg", () => {
    expect(() => parse(pkt("/show/status/letter/get"))).toThrow(/Malformed OSC/);
  });

  it("tryParse returns null when /show/status/letter/get is missing contentId", () => {
    expect(tryParse(pkt("/show/status/letter/get"))).toBeNull();
  });

  it("throws when /rfid/slot is missing payload arg", () => {
    expect(() => parse(pkt("/rfid/slot", 3))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot payload has wrong format (not SL######)", () => {
    // Plain string that doesn't match SL\d{6}
    expect(() => parse(pkt("/rfid/slot", 3, "RFID-XYZ"))).toThrow(/Malformed OSC/);
    expect(() => parse(pkt("/rfid/slot", 3, "SL12345"))).toThrow(/Malformed OSC/); // 5 digits only
    expect(() => parse(pkt("/rfid/slot", 3, "sl000042"))).toThrow(/Malformed OSC/); // lowercase
  });

  it("throws when /rfid/slot slotId is a float", () => {
    expect(() => parse(pkt("/rfid/slot", 1.5, "SL000042"))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot slotId is negative", () => {
    expect(() => parse(pkt("/rfid/slot", -1, "SL000042"))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot slotId is a string instead of a number", () => {
    expect(() => parse(pkt("/rfid/slot", "3", "SL000042"))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot/clear slotId is -1", () => {
    expect(() => parse(pkt("/rfid/slot/clear", -1))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot/clear slotId is 1.5", () => {
    expect(() => parse(pkt("/rfid/slot/clear", 1.5))).toThrow(/Malformed OSC/);
  });

  it("throws when /rfid/slot/clear slotId is the string '3'", () => {
    expect(() => parse(pkt("/rfid/slot/clear", "3"))).toThrow(/Malformed OSC/);
  });

  it("tryParse returns null for negative slotId", () => {
    expect(tryParse(pkt("/rfid/slot/clear", -1))).toBeNull();
  });

  it("tryParse returns null for fractional slotId", () => {
    expect(tryParse(pkt("/rfid/slot", 1.5, "SL000042"))).toBeNull();
  });

  it("throws when contentId arg is missing the slash separator", () => {
    // "LW2b3" has no slash — does not match the contentId pattern
    expect(() =>
      parse(pkt("/show/status/letter/get", "LW2b3"))
    ).toThrow(/Malformed OSC/);
  });
});

// ---------------------------------------------------------------------------
// tryParse — happy path (mirrors parse, for coverage of the safe wrapper)
// ---------------------------------------------------------------------------

describe("tryParse — happy path", () => {
  it("returns a parsed message when the packet is valid", () => {
    expect(tryParse(pkt("/show/status/day/get"))).toEqual({
      kind: "status_day_get",
    });
    expect(tryParse(pkt("/rfid/slot", 5, "SL000001"))).toEqual({
      kind: "rfid_slot",
      slotId: 5,
      payload: "SL000001",
    });
  });
});
