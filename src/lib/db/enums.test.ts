import { describe, it, expect } from "vitest";
import {
  formatRandomSubset,
  isRandomSentinel,
  parseRandomSubset,
  RANDOM_ALL_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_SUBSET_SENTINEL_PREFIX,
  RANDOM_TIED_SENTINEL,
} from "./enums";

describe("random sentinels", () => {
  it("isRandomSentinel matches the three plain sentinels", () => {
    expect(isRandomSentinel(RANDOM_RESULT_SENTINEL)).toBe(true);
    expect(isRandomSentinel(RANDOM_TIED_SENTINEL)).toBe(true);
    expect(isRandomSentinel(RANDOM_ALL_SENTINEL)).toBe(true);
  });

  it("isRandomSentinel matches subset values regardless of payload", () => {
    expect(isRandomSentinel(`${RANDOM_SUBSET_SENTINEL_PREFIX}["a"]`)).toBe(
      true
    );
    expect(isRandomSentinel(`${RANDOM_SUBSET_SENTINEL_PREFIX}garbage`)).toBe(
      true
    );
  });

  it("isRandomSentinel rejects null, empty, and arbitrary strings", () => {
    expect(isRandomSentinel(null)).toBe(false);
    expect(isRandomSentinel(undefined)).toBe(false);
    expect(isRandomSentinel("")).toBe(false);
    expect(isRandomSentinel("proletariat")).toBe(false);
  });
});

describe("parseRandomSubset / formatRandomSubset", () => {
  it("round-trips a list of ids", () => {
    const ids = ["fw1", "fw2", "fw3"];
    const formatted = formatRandomSubset(ids);
    expect(formatted.startsWith(RANDOM_SUBSET_SENTINEL_PREFIX)).toBe(true);
    expect(parseRandomSubset(formatted)).toEqual(ids);
  });

  it("rejects values that don't carry the subset prefix", () => {
    expect(parseRandomSubset(RANDOM_ALL_SENTINEL)).toBeNull();
    expect(parseRandomSubset("proletariat")).toBeNull();
    expect(parseRandomSubset(null)).toBeNull();
    expect(parseRandomSubset("")).toBeNull();
  });

  it("rejects malformed JSON payloads", () => {
    expect(
      parseRandomSubset(`${RANDOM_SUBSET_SENTINEL_PREFIX}not-json`)
    ).toBeNull();
    expect(
      parseRandomSubset(`${RANDOM_SUBSET_SENTINEL_PREFIX}{"a":1}`)
    ).toBeNull();
  });

  it("rejects empty arrays and arrays containing non-strings", () => {
    expect(parseRandomSubset(`${RANDOM_SUBSET_SENTINEL_PREFIX}[]`)).toBeNull();
    expect(
      parseRandomSubset(`${RANDOM_SUBSET_SENTINEL_PREFIX}[1,2,3]`)
    ).toBeNull();
    expect(
      parseRandomSubset(`${RANDOM_SUBSET_SENTINEL_PREFIX}["a",2]`)
    ).toBeNull();
  });
});
