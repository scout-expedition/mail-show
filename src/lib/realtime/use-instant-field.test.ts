import { describe, expect, it } from "vitest";
import {
  instantFieldReducer,
  type InstantFieldState,
} from "./use-instant-field";

const idle = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "idle",
});
const dirty = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "dirty",
});
const saving = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "saving",
});
const errored = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "error",
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

  it("drops remote update when dirty (local typing wins)", () => {
    const s = dirty("local");
    expect(
      instantFieldReducer(s, { type: "remote", value: "remote" })
    ).toBe(s);
  });

  it("drops remote update when saving (commit in flight)", () => {
    const s = saving("local");
    expect(
      instantFieldReducer(s, { type: "remote", value: "remote" })
    ).toBe(s);
  });

  it("applies remote update when in error state (field already reverted)", () => {
    expect(
      instantFieldReducer(errored("a"), { type: "remote", value: "b" })
    ).toEqual({ localValue: "b", status: "error" });
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
    };
    const result = instantFieldReducer(beforeSuccess, {
      type: "saveSuccess",
      pendingValue: "b",
    });
    expect(result).toBe(beforeSuccess);
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
});

describe("instantFieldReducer — value identity", () => {
  it("preserves object identity for no-op transitions", () => {
    // Important for React: returning the same state reference lets bail-out
    // optimizations skip a re-render.
    const s = idle("a");
    expect(instantFieldReducer(s, { type: "set", value: "a" })).toBe(s);
    expect(instantFieldReducer(s, { type: "remote", value: "a" })).toBe(s);
    const sav = saving("a");
    expect(
      instantFieldReducer(sav, { type: "remote", value: "x" })
    ).toBe(sav);
  });

  it("returns a new object when state actually changes", () => {
    const s = idle("a");
    const next = instantFieldReducer(s, { type: "set", value: "b" });
    expect(next).not.toBe(s);
  });
});
