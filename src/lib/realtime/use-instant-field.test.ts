import { describe, expect, it } from "vitest";
import {
  instantFieldReducer,
  type InstantFieldState,
} from "./use-instant-field";

const idle = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "idle",
  pendingRemote: null,
});
const dirty = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "dirty",
  pendingRemote: null,
});
const saving = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "saving",
  pendingRemote: null,
});
const errored = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "error",
  pendingRemote: null,
});

describe("instantFieldReducer — set", () => {
  it("transitions idle → dirty on a different value", () => {
    expect(
      instantFieldReducer(idle("a"), { type: "set", value: "b" })
    ).toEqual(dirty("b"));
  });

  it("is a no-op when set value equals current local value", () => {
    const s = idle("a");
    expect(instantFieldReducer(s, { type: "set", value: "a" })).toBe(s);
  });

  it("transitions error → dirty when the user resumes typing", () => {
    expect(
      instantFieldReducer(errored("a"), { type: "set", value: "b" })
    ).toEqual(dirty("b"));
  });

  it("clears a stashed pendingRemote — the new keystroke is the latest intent", () => {
    const s: InstantFieldState<string> = {
      localValue: "a",
      status: "saving",
      pendingRemote: { value: "peer" },
    };
    expect(instantFieldReducer(s, { type: "set", value: "b" })).toEqual(
      dirty("b")
    );
  });

  it("respects a custom equals predicate", () => {
    const caseInsensitive = (a: string, b: string) =>
      a.toLowerCase() === b.toLowerCase();
    const s = idle("Hello");
    expect(
      instantFieldReducer(s, { type: "set", value: "HELLO" }, caseInsensitive)
    ).toBe(s);
  });
});

describe("instantFieldReducer — remote (LWW merge rule)", () => {
  it("applies remote update when idle", () => {
    expect(
      instantFieldReducer(idle("a"), { type: "remote", value: "b" })
    ).toEqual(idle("b"));
  });

  it("stashes remote update when dirty (local typing wins for now)", () => {
    const s = dirty("local");
    expect(
      instantFieldReducer(s, { type: "remote", value: "remote" })
    ).toEqual({
      localValue: "local",
      status: "dirty",
      pendingRemote: { value: "remote" },
    });
  });

  it("stashes remote update when saving (commit in flight)", () => {
    const s = saving("local");
    expect(
      instantFieldReducer(s, { type: "remote", value: "remote" })
    ).toEqual({
      localValue: "local",
      status: "saving",
      pendingRemote: { value: "remote" },
    });
  });

  it("keeps only the latest stashed remote when several land during a save", () => {
    const afterFirst = instantFieldReducer(saving("local"), {
      type: "remote",
      value: "r1",
    });
    const afterSecond = instantFieldReducer(afterFirst, {
      type: "remote",
      value: "r2",
    });
    expect(afterSecond).toEqual({
      localValue: "local",
      status: "saving",
      pendingRemote: { value: "r2" },
    });
  });

  it("applies remote update when in error state (field already reverted)", () => {
    expect(
      instantFieldReducer(errored("a"), { type: "remote", value: "b" })
    ).toEqual(errored("b"));
  });

  it("is a no-op when remote value equals local value (preserves identity)", () => {
    const s = idle("a");
    expect(
      instantFieldReducer(s, { type: "remote", value: "a" })
    ).toBe(s);
  });
});

describe("instantFieldReducer — save lifecycle", () => {
  it("saveStart → status saving", () => {
    expect(instantFieldReducer(dirty("b"), { type: "saveStart" })).toEqual(
      saving("b")
    );
  });

  it("saveStart carries a stashed pendingRemote through", () => {
    const s: InstantFieldState<string> = {
      localValue: "b",
      status: "dirty",
      pendingRemote: { value: "peer" },
    };
    expect(instantFieldReducer(s, { type: "saveStart" })).toEqual({
      localValue: "b",
      status: "saving",
      pendingRemote: { value: "peer" },
    });
  });

  it("saveSuccess returns to idle when localValue matches pendingValue", () => {
    expect(
      instantFieldReducer(saving("b"), {
        type: "saveSuccess",
        pendingValue: "b",
      })
    ).toEqual(idle("b"));
  });

  it("saveSuccess leaves state alone if user kept typing during the save", () => {
    // User typed past 'b' while the save was in flight; localValue is now 'c'
    // but status is still 'saving' because the dispatch order was:
    //   saveStart → set("c") → saveSuccess(pending="b"). The user's newer
    //   value must NOT be silently committed; status stays as-is so the
    //   hook's next debounced commit can flush 'c'.
    const beforeSuccess: InstantFieldState<string> = {
      localValue: "c",
      status: "saving",
      pendingRemote: null,
    };
    const result = instantFieldReducer(beforeSuccess, {
      type: "saveSuccess",
      pendingValue: "b",
    });
    expect(result).toBe(beforeSuccess);
  });

  it("saveSuccess keeps a stashed pendingRemote when the user kept typing", () => {
    // localValue diverged from the committed value, so no transition happens —
    // the stashed remote must survive for the next saveSuccess.
    const beforeSuccess: InstantFieldState<string> = {
      localValue: "c",
      status: "saving",
      pendingRemote: { value: "peer" },
    };
    expect(
      instantFieldReducer(beforeSuccess, {
        type: "saveSuccess",
        pendingValue: "b",
      })
    ).toBe(beforeSuccess);
  });

  it("saveSuccess replays a differing stashed remote on the saving→idle transition", () => {
    const s: InstantFieldState<string> = {
      localValue: "b",
      status: "saving",
      pendingRemote: { value: "peer" },
    };
    expect(
      instantFieldReducer(s, { type: "saveSuccess", pendingValue: "b" })
    ).toEqual(idle("peer"));
  });

  it("saveSuccess clears a stashed remote that equals the committed value (no replay)", () => {
    const s: InstantFieldState<string> = {
      localValue: "b",
      status: "saving",
      pendingRemote: { value: "b" },
    };
    expect(
      instantFieldReducer(s, { type: "saveSuccess", pendingValue: "b" })
    ).toEqual(idle("b"));
  });

  it("saveError reverts localValue to the server value and surfaces error", () => {
    expect(
      instantFieldReducer(saving("typed-but-failed"), {
        type: "saveError",
        serverValue: "server-truth",
      })
    ).toEqual(errored("server-truth"));
  });

  it("saveError reverts even when no commit was in flight (defensive)", () => {
    expect(
      instantFieldReducer(dirty("anything"), {
        type: "saveError",
        serverValue: "server-truth",
      })
    ).toEqual(errored("server-truth"));
  });

  it("saveError prefers a stashed remote over the server value (don't lose a peer write)", () => {
    // A peer write landed while the save was in flight; the save then failed.
    // The stashed remote is the freshest server truth — apply it, not the
    // stale serverValue captured at saveStart.
    const stashed = instantFieldReducer(saving("local"), {
      type: "remote",
      value: "peer",
    });
    expect(
      instantFieldReducer(stashed, {
        type: "saveError",
        serverValue: "stale-server",
      })
    ).toEqual(errored("peer"));
  });
});

describe("instantFieldReducer — value identity", () => {
  it("preserves object identity for no-op transitions", () => {
    // Important for React: returning the same state reference lets bail-out
    // optimizations skip a re-render.
    const s = idle("a");
    expect(instantFieldReducer(s, { type: "set", value: "a" })).toBe(s);
    expect(instantFieldReducer(s, { type: "remote", value: "a" })).toBe(s);
  });

  it("returns a new object when state actually changes", () => {
    const s = idle("a");
    expect(instantFieldReducer(s, { type: "set", value: "b" })).not.toBe(s);
    // Stashing a remote during a save is a real state change (new object).
    const sav = saving("a");
    expect(
      instantFieldReducer(sav, { type: "remote", value: "x" })
    ).not.toBe(sav);
  });
});
