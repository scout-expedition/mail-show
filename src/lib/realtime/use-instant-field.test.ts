import { describe, expect, it } from "vitest";
import {
  instantFieldReducer,
  type InstantFieldState,
} from "./use-instant-field";

const idle = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "idle",
  committedAwaitingRemote: null,
  pendingRemote: null,
});
const dirty = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "dirty",
  committedAwaitingRemote: null,
  pendingRemote: null,
});
const saving = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "saving",
  committedAwaitingRemote: null,
  pendingRemote: null,
});
const errored = <T,>(localValue: T): InstantFieldState<T> => ({
  localValue,
  status: "error",
  committedAwaitingRemote: null,
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
      committedAwaitingRemote: null,
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
      committedAwaitingRemote: null,
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
      committedAwaitingRemote: null,
      pendingRemote: { value: "r2" },
    });
  });

  it("returns the same state when a remote repeats the already-stashed value", () => {
    const stashed = instantFieldReducer(saving("local"), {
      type: "remote",
      value: "peer",
    });
    expect(
      instantFieldReducer(stashed, { type: "remote", value: "peer" })
    ).toBe(stashed);
  });

  it("returns the same state when a remote repeats the stashed value while dirty", () => {
    const stashed = instantFieldReducer(dirty("local"), {
      type: "remote",
      value: "peer",
    });
    expect(
      instantFieldReducer(stashed, { type: "remote", value: "peer" })
    ).toBe(stashed);
  });

  it("does not short-circuit on a loose-equals match — keeps the latest value", () => {
    // "abc" is custom-equals "ABC" but not Object.is-equal. The no-op
    // short-circuit must use Object.is, so the stash still updates to the
    // genuinely-latest value (saveError / saveSuccess read it back out).
    const caseInsensitive = (a: string, b: string) =>
      a.toLowerCase() === b.toLowerCase();
    const stashed = instantFieldReducer(
      saving("local"),
      { type: "remote", value: "ABC" },
      caseInsensitive
    );
    const next = instantFieldReducer(
      stashed,
      { type: "remote", value: "abc" },
      caseInsensitive
    );
    expect(next).not.toBe(stashed);
    expect(next.pendingRemote).toEqual({ value: "abc" });
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
    ).toEqual({
      localValue: "b",
      status: "idle",
      committedAwaitingRemote: "b",
      pendingRemote: null,
    });
  });

  it("saveSuccess records the committed value but does not settle status when the user kept typing", () => {
    // User typed past 'b' while the save was in flight; localValue is now 'c'.
    // The newer value must NOT be silently committed — status stays so the
    // hook's next debounced commit can flush 'c'. But the committed 'b' MUST
    // be recorded: its realtime echo is in flight, and the dirty/saving
    // `remote` branch needs to recognise it as ours rather than stash + replay.
    const beforeSuccess: InstantFieldState<string> = {
      localValue: "c",
      status: "saving",
      pendingRemote: null,
    };
    expect(
      instantFieldReducer(beforeSuccess, {
        type: "saveSuccess",
        pendingValue: "b",
      })
    ).toEqual({
      localValue: "c",
      status: "saving",
      pendingRemote: null,
      committedAwaitingRemote: "b",
    });
  });

  it("saveSuccess keeps a stashed pendingRemote (and records the commit) when the user kept typing", () => {
    // localValue diverged from the committed value, so no transition happens —
    // the stashed remote must survive for the next saveSuccess, and the
    // committed value is recorded so its own echo isn't mistaken for a peer write.
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
    ).toEqual({
      localValue: "c",
      status: "saving",
      pendingRemote: { value: "peer" },
      committedAwaitingRemote: "b",
    });
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
    ).toEqual({
      localValue: "b",
      status: "idle",
      committedAwaitingRemote: "b",
      pendingRemote: null,
    });
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

describe("instantFieldReducer — committedAwaitingRemote (post-save flicker guard)", () => {
  const justCommitted = <T,>(value: T): InstantFieldState<T> => ({
    localValue: value,
    status: "idle",
    committedAwaitingRemote: value,
    pendingRemote: null,
  });

  it("ignores a stale remote value after saveSuccess until realtime catches up", () => {
    // Field just saved "b". A remote update with the pre-save "a" arrives
    // (realtime is still in flight). It must be dropped, not snap us back.
    const s = justCommitted("b");
    expect(instantFieldReducer(s, { type: "remote", value: "a" })).toBe(s);
  });

  it("clears the committed flag when remote finally matches", () => {
    const s = justCommitted("b");
    expect(
      instantFieldReducer(s, { type: "remote", value: "b" })
    ).toEqual(idle("b"));
  });

  it("set() preserves committedAwaitingRemote — the echo is still in flight as the user types on", () => {
    // The echo of the just-committed 'b' is still arriving. If `set` dropped
    // the flag, that echo would be stashed mid-edit and later replayed,
    // clobbering text the user typed after a pause.
    const s = justCommitted("b");
    expect(
      instantFieldReducer(s, { type: "set", value: "c" })
    ).toEqual({
      localValue: "c",
      status: "dirty",
      committedAwaitingRemote: "b",
      pendingRemote: null,
    });
  });

  it("saveError clears the committed flag", () => {
    const s: InstantFieldState<string> = {
      localValue: "typed",
      status: "saving",
      committedAwaitingRemote: "b",
      pendingRemote: null,
    };
    expect(
      instantFieldReducer(s, { type: "saveError", serverValue: "server" })
    ).toEqual(errored("server"));
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

describe("instantFieldReducer — settle", () => {
  it("transitions a non-idle status to idle", () => {
    expect(instantFieldReducer(dirty("a"), { type: "settle" })).toEqual(
      idle("a")
    );
    expect(instantFieldReducer(saving("a"), { type: "settle" })).toEqual(
      idle("a")
    );
  });

  it("is a no-op (same reference) when already idle", () => {
    const s = idle("a");
    expect(instantFieldReducer(s, { type: "settle" })).toBe(s);
  });

  it("clears a stashed pendingRemote — settling means the field is caught up", () => {
    const s: InstantFieldState<string> = {
      localValue: "a",
      status: "saving",
      committedAwaitingRemote: null,
      pendingRemote: { value: "stale" },
    };
    expect(instantFieldReducer(s, { type: "settle" })).toEqual(idle("a"));
  });

  it("does NOT record committedAwaitingRemote — a no-op commit has no echo coming", () => {
    // If settle recorded a value, the idle-branch guard would wait forever for
    // an echo that never broadcasts, dropping every genuine peer write.
    const settled = instantFieldReducer(dirty("a"), { type: "settle" });
    expect(settled.committedAwaitingRemote ?? null).toBeNull();
    // A subsequent genuine remote is therefore applied, not dropped.
    expect(
      instantFieldReducer(settled, { type: "remote", value: "peer" })
    ).toEqual(idle("peer"));
  });

  it("settles a field left stuck dirty after a no-op commit (latent-bug regression)", () => {
    // saveStart → set("x") → set back to "a" leaves status "dirty" with
    // localValue == server value. The no-op commitNow dispatches `settle`,
    // which must clear the spurious dirty state.
    let s: InstantFieldState<string> = saving("a");
    s = instantFieldReducer(s, { type: "set", value: "x" });
    s = instantFieldReducer(s, { type: "set", value: "a" });
    expect(s.status).toBe("dirty");
    s = instantFieldReducer(s, { type: "settle" });
    expect(s.status).toBe("idle");
  });
});

describe("instantFieldReducer — self-echo recognition (own committed value)", () => {
  it("drops a self-echo while dirty instead of stashing it", () => {
    // committedAwaitingRemote holds our just-committed "ab"; the user has since
    // typed "abc". The realtime echo of "ab" must be consumed, not stashed —
    // a stash would be replayed by the next saveSuccess and clobber "abc".
    const s: InstantFieldState<string> = {
      localValue: "abc",
      status: "dirty",
      committedAwaitingRemote: "ab",
      pendingRemote: null,
    };
    expect(instantFieldReducer(s, { type: "remote", value: "ab" })).toEqual({
      localValue: "abc",
      status: "dirty",
      committedAwaitingRemote: null,
      pendingRemote: null,
    });
  });

  it("drops a self-echo while saving instead of stashing it", () => {
    const s: InstantFieldState<string> = {
      localValue: "abc",
      status: "saving",
      committedAwaitingRemote: "ab",
      pendingRemote: null,
    };
    expect(instantFieldReducer(s, { type: "remote", value: "ab" })).toEqual({
      localValue: "abc",
      status: "saving",
      committedAwaitingRemote: null,
      pendingRemote: null,
    });
  });

  it("still stashes a genuine peer write — the self-echo check does not over-match", () => {
    const s: InstantFieldState<string> = {
      localValue: "abc",
      status: "dirty",
      committedAwaitingRemote: "ab",
      pendingRemote: null,
    };
    expect(instantFieldReducer(s, { type: "remote", value: "peer" })).toEqual({
      localValue: "abc",
      status: "dirty",
      committedAwaitingRemote: "ab",
      pendingRemote: { value: "peer" },
    });
  });

  it("recognises a structurally-equal object echo via the caller's equals", () => {
    // An object-typed echo is a fresh value from the postgres payload — never
    // Object.is-equal to what we sent. The check must use the caller's equals.
    type Box = { v: number };
    const deepEquals = (a: Box, b: Box) => a.v === b.v;
    const s: InstantFieldState<Box> = {
      localValue: { v: 3 },
      status: "dirty",
      committedAwaitingRemote: { v: 2 },
      pendingRemote: null,
    };
    const echo: Box = { v: 2 }; // distinct object, structurally equal
    expect(
      instantFieldReducer(s, { type: "remote", value: echo }, deepEquals)
    ).toEqual({
      localValue: { v: 3 },
      status: "dirty",
      committedAwaitingRemote: null,
      pendingRemote: null,
    });
  });

  it("regression: text typed after a pause survives the first save's realtime echo", () => {
    // The full reported bug, replayed at the reducer level. Server value "a".
    let s: InstantFieldState<string> = idle("a");
    // 1. type "ab"
    s = instantFieldReducer(s, { type: "set", value: "ab" });
    // 2. debounce fires → commit "ab"
    s = instantFieldReducer(s, { type: "saveStart" });
    // 3. resume typing "abc" while the save is in flight
    s = instantFieldReducer(s, { type: "set", value: "abc" });
    // 4. onCommit("ab") resolves — recorded despite the kept typing
    s = instantFieldReducer(s, { type: "saveSuccess", pendingValue: "ab" });
    expect(s.committedAwaitingRemote).toBe("ab");
    // 5. realtime echo of our own "ab" write arrives → dropped, NOT stashed
    s = instantFieldReducer(s, { type: "remote", value: "ab" });
    expect(s.pendingRemote).toBeNull();
    expect(s.localValue).toBe("abc");
    // 6. debounce fires again → commit "abc"
    s = instantFieldReducer(s, { type: "saveStart" });
    // 7. onCommit("abc") resolves — the text typed after the pause survives
    s = instantFieldReducer(s, { type: "saveSuccess", pendingValue: "abc" });
    expect(s.localValue).toBe("abc");
    expect(s.status).toBe("idle");
  });
});

describe("instantFieldReducer — saveSuccess settles a dirty field on the committed value", () => {
  it("transitions dirty → idle when localValue equals the committed value", () => {
    // User typed away and back to the committed value during the save; status
    // is "dirty" but the field has effectively settled, so it must reach idle.
    expect(
      instantFieldReducer(dirty("b"), {
        type: "saveSuccess",
        pendingValue: "b",
      })
    ).toEqual({
      localValue: "b",
      status: "idle",
      committedAwaitingRemote: "b",
      pendingRemote: null,
    });
  });
});
