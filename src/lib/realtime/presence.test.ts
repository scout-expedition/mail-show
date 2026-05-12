import { describe, expect, it } from "vitest";
import {
  colorFromUserId,
  parsePresenceIdentities,
  type RawPresenceState,
} from "./presence";

describe("colorFromUserId", () => {
  it("is deterministic — same input yields same color", () => {
    expect(colorFromUserId("user-abc")).toBe(colorFromUserId("user-abc"));
  });

  it("returns a 6-digit hex from the palette", () => {
    expect(colorFromUserId("user-x")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("differentiates across realistic userIds", () => {
    const uuids = [
      "8c2f8b6e-1d7b-4b9f-8b9a-3e2c1d0f1a2b",
      "f7a1e9d3-6c4b-4a7e-9d8f-2b1a3c4d5e6f",
      "1234abcd-ef12-3456-7890-abcdef123456",
      "0fedcba9-8765-4321-0fed-cba987654321",
      "11111111-2222-3333-4444-555555555555",
    ];
    const colors = new Set(uuids.map((id) => colorFromUserId(id)));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("parsePresenceIdentities", () => {
  const alice = { userId: "user-alice", email: "alice@x.com" };
  const bob = { userId: "user-bob", email: "bob@x.com" };

  it("excludes the local user", () => {
    const state: RawPresenceState = {
      "user-self": [{ userId: "user-self", email: "me@x.com" }],
      "user-alice": [alice],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(Object.keys(out)).toEqual(["user-alice"]);
    expect(out["user-alice"]).toEqual({
      userId: "user-alice",
      email: "alice@x.com",
    });
  });

  it("uses the LAST entry — Phoenix prepends stale metas on track update", () => {
    // When the same user calls track() a second time (e.g. identity refresh),
    // Phoenix Presence's syncDiff unshifts the prior meta onto the front of
    // the array. So entries = [stale, fresh] and we need entries[last].
    const state: RawPresenceState = {
      "user-alice": [
        { userId: "user-alice", email: "old@x.com" },
        { userId: "user-alice", email: "alice@x.com" },
      ],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(out["user-alice"].email).toBe("alice@x.com");
  });

  it("drops entries missing userId or email", () => {
    const state: RawPresenceState = {
      "user-empty": [{}],
      "user-alice": [alice],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(Object.keys(out)).toEqual(["user-alice"]);
  });

  it("returns an empty object when only self is present", () => {
    const state: RawPresenceState = {
      "user-self": [{ userId: "user-self", email: "me@x.com" }],
    };
    expect(parsePresenceIdentities(state, "user-self")).toEqual({});
  });

  it("returns identities keyed by userId, sorted only at the consumer", () => {
    const state: RawPresenceState = {
      "user-z": [{ userId: "user-z", email: "z@x.com" }],
      "user-a": [{ userId: "user-a", email: "a@x.com" }],
      "user-m": [{ userId: "user-m", email: "m@x.com" }],
    };
    const out = parsePresenceIdentities(state, "user-self");
    // Identities are a Record — ordering happens when peers are built.
    expect(new Set(Object.keys(out))).toEqual(
      new Set(["user-a", "user-m", "user-z"])
    );
  });

  it("supports multiple peers in addition to self", () => {
    const state: RawPresenceState = {
      "user-self": [{ userId: "user-self", email: "me@x.com" }],
      "user-alice": [alice],
      "user-bob": [bob],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(Object.keys(out).length).toBe(2);
    expect(out["user-alice"]).toEqual(alice);
    expect(out["user-bob"]).toEqual(bob);
  });
});
