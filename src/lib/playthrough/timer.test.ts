import { describe, expect, it } from "vitest";
import { gameElapsedMs, phaseElapsedMs, phaseRemainingMs } from "./timer";
import type { Day, Playthrough } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000; // arbitrary epoch anchor (ms)
const T1 = T0 + 60_000; // +1 min
const T2 = T0 + 120_000; // +2 min
const T3 = T0 + 180_000; // +3 min

function makePlaythrough(overrides: Partial<Playthrough> = {}): Playthrough {
  return {
    id: "p1",
    name: "Test",
    notes: null,
    current_day_id: "d1",
    current_phase: "sorting",
    is_active: true,
    started_at: null,
    paused_at: null,
    total_paused_ms: 0,
    phase_started_at: null,
    phase_paused_at: null,
    phase_total_paused_ms: 0,
    phase_allotted_override_ms: null,
    furthest_day_id: null,
    furthest_phase: null,
    started: false,
    ended: false,
    ending_document_id: null,
    ...overrides,
  };
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    id: "d1",
    number: 1,
    identifier: "D1",
    name: "Day One",
    notes: null,
    until_qup: null,
    month: null,
    day_of_month: null,
    year: null,
    day_of_week: null,
    sort_phase_length_seconds: 600, // 10 min
    inspection_phase_length_seconds: 900, // 15 min
    base_report: null,
    report_sign_off: null,
    end_of_day_sign_off: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// gameElapsedMs
// ---------------------------------------------------------------------------

describe("gameElapsedMs", () => {
  describe("when the playthrough has not started", () => {
    it("should return 0", () => {
      const p = makePlaythrough({ started: false, started_at: null });
      expect(gameElapsedMs(p, T3)).toBe(0);
    });

    it("should return 0 even if started_at is null but started flag is false", () => {
      const p = makePlaythrough({ started: false, started_at: new Date(T0).toISOString() });
      expect(gameElapsedMs(p, T3)).toBe(0);
    });
  });

  describe("when the game is running", () => {
    it("should return now - started_at when no pausing has occurred", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        total_paused_ms: 0,
      });
      // 3 minutes since start
      expect(gameElapsedMs(p, T3)).toBe(180_000);
    });

    it("should subtract total_paused_ms from the elapsed time", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        total_paused_ms: 30_000, // 30s were paused
      });
      // 3 min total - 30s paused = 2min 30s
      expect(gameElapsedMs(p, T3)).toBe(150_000);
    });

    it("should never return a negative value", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        total_paused_ms: 999_999_999, // absurdly large
      });
      expect(gameElapsedMs(p, T0 + 1_000)).toBe(0);
    });
  });

  describe("when the game is paused", () => {
    it("should return the frozen elapsed value at paused_at", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        paused_at: new Date(T1).toISOString(), // paused after 1 min
        total_paused_ms: 0,
      });
      // Clock reads 1 min even though we query at T3
      expect(gameElapsedMs(p, T3)).toBe(60_000);
    });

    it("should account for prior pause durations when paused again", () => {
      // Scenario: started T0, paused T1, resumed T2, paused again at T2+30s.
      // The resume-to-repause interval (30s) is what the frozen clock shows.
      const resumeAt = T2;
      const repauseAt = T2 + 30_000;
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        paused_at: new Date(repauseAt).toISOString(),
        total_paused_ms: T2 - T1, // 1 min of paused history recorded at resume
      });
      // Frozen elapsed = (repause - start) - total_paused = (T2+30s - T0) - 60s
      //                = 120_030s - 60s = 60_030ms... wait let me re-calc:
      // repauseAt - T0 = 2min + 30s = 150_000ms
      // total_paused_ms = T2 - T1 = 60_000ms
      // frozen elapsed = 150_000 - 60_000 = 90_000ms
      expect(gameElapsedMs(p, T3)).toBe(90_000);
      void resumeAt; // used for clarity
    });
  });
});

// ---------------------------------------------------------------------------
// phaseElapsedMs
// ---------------------------------------------------------------------------

describe("phaseElapsedMs", () => {
  describe("when phase_started_at is null", () => {
    it("should return 0", () => {
      const p = makePlaythrough({ phase_started_at: null });
      expect(phaseElapsedMs(p, T3)).toBe(0);
    });
  });

  describe("when the phase is running", () => {
    it("should return now - phase_started_at when no phase pausing occurred", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        phase_started_at: new Date(T1).toISOString(), // phase started at T1
        phase_total_paused_ms: 0,
      });
      // At T3, phase has been running 2min
      expect(phaseElapsedMs(p, T3)).toBe(120_000);
    });

    it("should subtract phase_total_paused_ms", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        phase_started_at: new Date(T1).toISOString(),
        phase_total_paused_ms: 10_000,
      });
      expect(phaseElapsedMs(p, T3)).toBe(110_000);
    });
  });

  describe("when the game is paused", () => {
    it("should read the frozen value at phase_paused_at", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        paused_at: new Date(T2).toISOString(),
        phase_started_at: new Date(T1).toISOString(),
        phase_paused_at: new Date(T2).toISOString(), // paused at T2
        phase_total_paused_ms: 0,
      });
      // Phase ran T1→T2 = 1 min
      expect(phaseElapsedMs(p, T3)).toBe(60_000);
    });

    it("should account for phase_total_paused_ms when frozen", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        paused_at: new Date(T2).toISOString(),
        phase_started_at: new Date(T0).toISOString(), // phase started at T0
        phase_paused_at: new Date(T2).toISOString(), // frozen at T2
        phase_total_paused_ms: 20_000,
      });
      // Frozen phase elapsed = (T2 - T0) - 20s = 120_000 - 20_000 = 100_000
      expect(phaseElapsedMs(p, T3)).toBe(100_000);
    });
  });
});

// ---------------------------------------------------------------------------
// phaseRemainingMs
// ---------------------------------------------------------------------------

describe("phaseRemainingMs", () => {
  describe("for untimed phases", () => {
    it("should return null for top_of_day", () => {
      const p = makePlaythrough({ current_phase: "top_of_day" });
      expect(phaseRemainingMs(p, makeDay(), T3)).toBeNull();
    });

    it("should return null for end_of_day", () => {
      const p = makePlaythrough({ current_phase: "end_of_day" });
      expect(phaseRemainingMs(p, makeDay(), T3)).toBeNull();
    });
  });

  describe("for the sorting phase", () => {
    it("should return allotted - elapsed using the day's sort_phase_length_seconds", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "sorting",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
      });
      const day = makeDay({ sort_phase_length_seconds: 600 }); // 10 min allotted
      // After 3 min elapsed, 7 min remain
      expect(phaseRemainingMs(p, day, T3)).toBe(420_000);
    });

    it("should return a negative value when in overtime", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "sorting",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
      });
      const day = makeDay({ sort_phase_length_seconds: 60 }); // 1 min allotted
      // After 3 min, 2 min overtime
      expect(phaseRemainingMs(p, day, T3)).toBe(-120_000);
    });

    it("should return null when sort_phase_length_seconds is null and no override", () => {
      const p = makePlaythrough({ current_phase: "sorting" });
      const day = makeDay({ sort_phase_length_seconds: null });
      expect(phaseRemainingMs(p, day, T3)).toBeNull();
    });
  });

  describe("for the inspection phase", () => {
    it("should return allotted - elapsed using the day's inspection_phase_length_seconds", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "inspection",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
      });
      const day = makeDay({ inspection_phase_length_seconds: 900 }); // 15 min
      // After 3 min, 12 min remain
      expect(phaseRemainingMs(p, day, T3)).toBe(720_000);
    });
  });

  describe("phase_allotted_override_ms", () => {
    it("should take precedence over the day's default for sorting", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "sorting",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
        phase_allotted_override_ms: 300_000, // 5 min override (day says 10 min)
      });
      const day = makeDay({ sort_phase_length_seconds: 600 });
      // After 3 min, 2 min remain (vs 7 min with day default)
      expect(phaseRemainingMs(p, day, T3)).toBe(120_000);
    });

    it("should take precedence over the day's default for inspection", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "inspection",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
        phase_allotted_override_ms: 120_000, // 2 min override
      });
      const day = makeDay({ inspection_phase_length_seconds: 900 });
      // After 3 min, overtime by 1 min
      expect(phaseRemainingMs(p, day, T3)).toBe(-60_000);
    });

    it("should apply override of 0 (fully consumed)", () => {
      const p = makePlaythrough({
        started: true,
        started_at: new Date(T0).toISOString(),
        current_phase: "sorting",
        phase_started_at: new Date(T0).toISOString(),
        phase_total_paused_ms: 0,
        phase_allotted_override_ms: 0,
      });
      const day = makeDay({ sort_phase_length_seconds: 600 });
      // 0ms allotted - 3min elapsed = -3min overtime
      expect(phaseRemainingMs(p, day, T3)).toBe(-180_000);
    });
  });
});
