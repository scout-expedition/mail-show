import { describe, expect, it } from "vitest";
import {
  colorFromUserId,
  parsePresenceIdentities,
  type RawPresenceState,
} from "./presence";
import { sharesPanel, visibleRecordId } from "./avatar-stack";

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
      profile: null,
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
    expect(out["user-alice"]).toEqual({ ...alice, profile: null });
    expect(out["user-bob"]).toEqual({ ...bob, profile: null });
  });

  it("preserves the peer's profile (display_name/avatar/color) when present", () => {
    const profile = {
      displayName: "Alice Liddell",
      avatarIconType: "tabler" as const,
      avatarIconValue: "user",
      avatarColorHex: "#abcdef",
    };
    const state: RawPresenceState = {
      "user-alice": [
        { userId: "user-alice", email: "alice@x.com", profile },
      ],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(out["user-alice"].profile).toEqual(profile);
  });

  it("returns profile=null when peer hasn't published one (older client)", () => {
    const state: RawPresenceState = {
      "user-alice": [{ userId: "user-alice", email: "alice@x.com" }],
    };
    const out = parsePresenceIdentities(state, "user-self");
    expect(out["user-alice"].profile).toBeNull();
  });
});

describe("sharesPanel — visible-slot overlap", () => {
  const sel = (
    over: Partial<{
      storylineId: string | null;
      groupId: string | null;
      letterId: string | null;
      segmentId: string | null;
      view: string;
      narrow: boolean;
    }> = {}
  ) => ({
    storylineId: null,
    groupId: null,
    letterId: null,
    segmentId: null,
    view: "list",
    ...over,
  });

  it("returns false when either side has no selection", () => {
    expect(sharesPanel(null, sel())).toBe(false);
    expect(sharesPanel(sel(), null)).toBe(false);
    expect(sharesPanel(null, null)).toBe(false);
  });

  it("returns false when neither side has any id at their visible slot", () => {
    // Both wide on view=list; visible slot 1 keys off storylineId which is
    // null on both sides → no record to match against.
    expect(sharesPanel(sel(), sel())).toBe(false);
  });

  it("matches when both wide-view the same letter", () => {
    expect(
      sharesPanel(
        sel({ groupId: "G1", letterId: "L1", view: "main", narrow: false }),
        sel({ groupId: "G1", letterId: "L1", view: "main", narrow: false })
      )
    ).toBe(true);
  });

  it("scenario 1: wide on view=group + narrow on view=list share storyline at slot 1", () => {
    // A wide on view=group: visible slots [1, 2] — sees storyline + group.
    // B narrow on view=list: visible slot [1].
    // Slot 1 records: both storylineId = "S1" → co-located.
    expect(
      sharesPanel(
        sel({
          storylineId: "S1",
          groupId: "G1",
          view: "group",
          narrow: false,
        }),
        sel({ storylineId: "S1", view: "list", narrow: true })
      )
    ).toBe(true);
  });

  it("scenario 2: wide on view=segment vs view=group → NOT same panel", () => {
    // A wide on view=segment: visible slots [4, 5] — actions + segment.
    // B wide on view=group: visible slots [1, 2]. No overlap. Shared
    // groupId in A's chain is irrelevant — A isn't looking at the group
    // panel.
    expect(
      sharesPanel(
        sel({
          groupId: "G1",
          letterId: "L1",
          segmentId: "Seg1",
          view: "segment",
          narrow: false,
        }),
        sel({ groupId: "G1", view: "group", narrow: false })
      )
    ).toBe(false);
  });

  it("narrow on the same visible slot still requires the same record", () => {
    expect(
      sharesPanel(
        sel({ groupId: "G1", view: "group", narrow: true }),
        sel({ groupId: "G2", view: "group", narrow: true })
      )
    ).toBe(false);
  });

  it("narrow + narrow on different slots: never matches", () => {
    expect(
      sharesPanel(
        sel({ storylineId: "S1", view: "list", narrow: true }),
        sel({
          storylineId: "S1",
          groupId: "G1",
          view: "group",
          narrow: true,
        })
      )
    ).toBe(false);
  });

  it("wide view=actions + wide view=main both see slot 3 (letter)", () => {
    // Wide A on view=actions: visible [3, 4]. Wide B on view=main: visible
    // [2, 3]. Slot 3 keys off letterId → same letter → match.
    expect(
      sharesPanel(
        sel({
          groupId: "G1",
          letterId: "L1",
          view: "main",
          narrow: false,
        }),
        sel({
          groupId: "G1",
          letterId: "L1",
          view: "actions",
          narrow: false,
        })
      )
    ).toBe(true);
  });

  it("falls back to false when visible-slot record is null", () => {
    expect(
      sharesPanel(
        sel({ view: "list", narrow: true }),
        sel({ view: "list", narrow: true })
      )
    ).toBe(false);
  });
});

describe("visibleRecordId", () => {
  it("maps each view to the right slot's record", () => {
    expect(
      visibleRecordId({
        storylineId: "S1",
        groupId: "G1",
        letterId: "L1",
        segmentId: null,
        view: "list",
      })
    ).toBe("S1");
    expect(
      visibleRecordId({
        storylineId: null,
        groupId: "G1",
        letterId: null,
        segmentId: null,
        view: "group",
      })
    ).toBe("G1");
    expect(
      visibleRecordId({
        storylineId: null,
        groupId: "G1",
        letterId: "L1",
        segmentId: null,
        view: "main",
      })
    ).toBe("L1");
    expect(
      visibleRecordId({
        storylineId: null,
        groupId: "G1",
        letterId: "L1",
        segmentId: null,
        view: "actions",
      })
    ).toBe("L1");
    expect(
      visibleRecordId({
        storylineId: null,
        groupId: "G1",
        letterId: "L1",
        segmentId: "Seg1",
        view: "segment",
      })
    ).toBe("Seg1");
  });
});
