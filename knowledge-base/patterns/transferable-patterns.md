# Transferable Implementation Patterns — from `mail-show`

A reference for an agent implementing similar features in another project. It documents four patterns built in `mail-show` (a Next.js 16 + React 19 + Supabase narrative-design tool), with the actual code, the design decisions, and — most importantly — the gotchas discovered while building them.

The four patterns:

1. **Instant / autosave** — debounced per-field save with a conflict-aware state machine
2. **Multi-user editing** — Supabase Realtime collaboration (live row sync, presence, focus rings)
3. **Reusable panel system** — a complex multi-panel editor that runs both standalone and embedded inside another page
4. **Graph view** — React Flow visualization where domain rows become nodes/edges and drag gestures dispatch mutations

## Source stack (what `mail-show` assumes)

- **Next.js 16** (App Router, Server Components, Server Actions, `revalidatePath`)
- **React 19.2** — note: none of these patterns use React 19-only APIs (`useOptimistic`, `use`), so they back-port cleanly
- **Supabase** — Postgres + Row-Level Security + Realtime (WebSocket); `@supabase/supabase-js` + `@supabase/ssr`
- **React Flow** — `@xyflow/react` v12 (graph only)
- **Tailwind** for styling

If the target project uses a different backend, the **autosave state machine and the panel system are framework-agnostic** — only the `onCommit` body and the data-fetch layer change. The **multi-user feature is Supabase-specific** in transport but the architecture (separate channels for row-sync vs. presence vs. ephemeral state) transfers to any pub/sub system. The **graph** depends on React Flow but the "props-driven, server-is-truth" approach is the reusable idea.

These four features interlock: autosave is the write path, realtime is the propagation path, the panel system is a consumer of both, and the graph reuses the panel system as an embedded inspector. Read all four even if you only need one — the seams matter.

---

# 1. Instant / Autosave

## The idea

Every editable field saves itself. The user never clicks Save. A change debounces for 400ms, then commits a **narrow patch** (one or a few columns of one row) to the server. The field tracks its own status (`idle | dirty | saving | error`) and resolves conflicts with a peer who edited the same field, via a small **pure state machine**.

This is deliberately **per-field**, not per-form. Two users editing different fields of the same row never conflict. The blast radius of a true conflict is one field.

## The core hook — `useInstantField`

This is the single most directly transferable artifact in the whole document. It has **zero dependencies** beyond React — copy it verbatim. Here is the complete file (`src/lib/realtime/use-instant-field.ts`):

```ts
"use client";

import { useEffect, useRef, useState } from "react";

export type InstantFieldStatus = "idle" | "dirty" | "saving" | "error";

export type InstantFieldState<T> = {
  localValue: T;
  status: InstantFieldStatus;
  /**
   * The value most recently committed to the server, awaiting its realtime
   * echo. Two jobs: (1) in the idle/error `remote` branch, stale upstream
   * values that don't match it are ignored until realtime catches up, so a
   * saveSuccess→idle transition can't snap the field back to the pre-save
   * value while the broadcast is in flight; (2) in the dirty/saving `remote`
   * branch, an incoming value that matches it is recognised as this client's
   * OWN echo and dropped rather than stashed in pendingRemote — otherwise
   * saveSuccess would later replay it and clobber text typed after a pause.
   * Survives `set` (the echo of the just-committed value is still in flight
   * while the user types on). Overwritten by the next commit, cleared once
   * the echo matches, and cleared on `saveError`.
   *
   * Single slot — holds only the latest committed value. If two distinct
   * commits are in flight with neither echo yet returned (heavy realtime lag),
   * the older commit's echo is no longer recognised; a documented, rare
   * residual.
   */
  committedAwaitingRemote?: T | null;
  /** Most recent remote value dropped while the field was dirty/saving.
   *  Replayed on the saving→idle transition so a peer write that landed
   *  inside the save window isn't lost. `null` when nothing is queued. */
  pendingRemote: { value: T } | null;
};

export type InstantFieldAction<T> =
  | { type: "set"; value: T }
  | { type: "remote"; value: T }
  | { type: "saveStart" }
  | { type: "saveSuccess"; pendingValue: T }
  | { type: "settle" }
  | { type: "saveError"; serverValue: T };

/**
 * Pure state machine for a single instant-save field. Exported so the
 * LWW merge rule + status transitions can be unit-tested without React.
 *
 * - `set`     → user typed. localValue := value, status := "dirty",
 *               pendingRemote cleared. committedAwaitingRemote is PRESERVED
 *               (the just-committed value's echo is still in flight).
 *               No-op if `equals(value, localValue)`.
 * - `remote`  → server pushed a new value via postgres_changes. APPLIED
 *               when status is "idle" or "error". When "dirty" or
 *               "saving": a value matching committedAwaitingRemote is this
 *               client's own echo → dropped. Otherwise local typing wins, so
 *               the value is STASHED in pendingRemote (not dropped) and
 *               replayed when the save settles.
 * - `saveStart`   → commit in flight. status := "saving".
 * - `saveSuccess` → commit returned. Always records the committed value in
 *                   committedAwaitingRemote (its realtime echo is in flight).
 *                   Transitions to "idle" only if localValue still equals the
 *                   committed value. On that transition a stashed pendingRemote
 *                   that differs from localValue is applied so a peer write
 *                   during the save window converges.
 * - `settle`      → a debounced commit found nothing to send (localValue
 *                   already equals the server value). Settles status to
 *                   "idle" without recording committedAwaitingRemote — no
 *                   commit happened, so no echo is coming.
 * - `saveError`   → commit threw. Revert localValue to the stashed remote if
 *                   one exists (freshest server truth), else the server value,
 *                   and surface "error" (inline glyph, no toast — caller styles it).
 */
export function instantFieldReducer<T>(
  state: InstantFieldState<T>,
  action: InstantFieldAction<T>,
  equals: (a: T, b: T) => boolean = Object.is
): InstantFieldState<T> {
  switch (action.type) {
    case "set":
      if (equals(action.value, state.localValue)) return state;
      return {
        localValue: action.value,
        status: "dirty",
        // Preserved, NOT cleared: the echo of the value we just committed is
        // still in flight, and the dirty `remote` branch below must recognise
        // it as our own so it isn't stashed and later replayed over this edit.
        committedAwaitingRemote: state.committedAwaitingRemote ?? null,
        pendingRemote: null,
      };
    case "remote":
      if (state.status === "dirty" || state.status === "saving") {
        // The realtime echo of THIS client's own just-committed write also
        // arrives as a `remote`. While dirty/saving it must NOT be stashed:
        // it is stale relative to what the user has since typed, and a stash
        // would later be replayed by saveSuccess and clobber the newer text.
        // Match with the caller's `equals`, not Object.is — an object-typed
        // echo is a fresh value deserialized from the postgres payload and is
        // never Object.is-equal to what we sent. Consume the slot on match.
        if (
          state.committedAwaitingRemote != null &&
          equals(action.value, state.committedAwaitingRemote)
        ) {
          return { ...state, committedAwaitingRemote: null };
        }
        // Local typing wins for now — stash the latest remote instead of
        // dropping it, so it can be replayed once the save settles.
        // Compare with Object.is, NOT the caller's `equals`: a loose
        // predicate could call two distinct values equal, and saveError
        // / saveSuccess read pendingRemote.value back out.
        if (
          state.pendingRemote !== null &&
          Object.is(state.pendingRemote.value, action.value)
        ) {
          return state;
        }
        return { ...state, pendingRemote: { value: action.value } };
      }
      // Idle / error: ignore a stale upstream value still in flight from
      // before our own just-committed write landed its realtime echo.
      if (
        state.committedAwaitingRemote != null &&
        !equals(action.value, state.committedAwaitingRemote)
      ) {
        return state;
      }
      if (equals(action.value, state.localValue)) {
        if (state.committedAwaitingRemote != null) {
          return { ...state, committedAwaitingRemote: null };
        }
        return state;
      }
      return {
        localValue: action.value,
        status: state.status,
        committedAwaitingRemote: null,
        pendingRemote: null,
      };
    case "saveStart":
      return { ...state, status: "saving" };
    case "saveSuccess":
      // localValue still equals the committed value → the field has settled
      // (covers both the user never typing during the save and typing away
      // then back to the committed value, which leaves status "dirty").
      if (
        (state.status === "saving" || state.status === "dirty") &&
        equals(state.localValue, action.pendingValue)
      ) {
        if (
          state.pendingRemote !== null &&
          !equals(state.pendingRemote.value, state.localValue)
        ) {
          // A peer write landed during the save window — replay it now
          // that local typing has settled. It becomes the new truth, so
          // nothing of ours is awaiting a realtime echo.
          return {
            localValue: state.pendingRemote.value,
            status: "idle",
            committedAwaitingRemote: null,
            pendingRemote: null,
          };
        }
        // No peer write queued — our committed value now awaits its own
        // realtime echo (see committedAwaitingRemote).
        return {
          ...state,
          status: "idle",
          committedAwaitingRemote: action.pendingValue,
          pendingRemote: null,
        };
      }
      // The user kept typing a *different* value during the save, so the
      // status can't settle — the next debounced commit will flush it. Still
      // record the committed value: its realtime echo is in flight and must be
      // recognised as our own (see the dirty/saving `remote` branch), not
      // stashed as a peer write and later replayed over the new text.
      if (state.status === "dirty" || state.status === "saving") {
        return { ...state, committedAwaitingRemote: action.pendingValue };
      }
      return state;
    case "settle":
      // A debounced commit found nothing to send (localValue already equals
      // the server value). Settle the status — but leave committedAwaitingRemote
      // untouched: no write happened, so recording a value here would freeze
      // the idle-branch guard waiting on an echo that never comes.
      if (state.status === "idle") return state;
      return { ...state, status: "idle", pendingRemote: null };
    case "saveError":
      return {
        localValue:
          state.pendingRemote !== null
            ? state.pendingRemote.value
            : action.serverValue,
        status: "error",
        committedAwaitingRemote: null,
        pendingRemote: null,
      };
    default:
      return state;
  }
}

export type UseInstantFieldOptions<T> = {
  /** Server-authoritative current value. */
  value: T;
  /** Persist function called after debounce. Throwing => status = "error". */
  onCommit: (next: T) => Promise<void> | void;
  /** Debounce window in ms. Default 400. */
  debounceMs?: number;
  /** Equality predicate. Default Object.is. */
  equals?: (a: T, b: T) => boolean;
  /** Notified `true` on focus, `false` on blur. */
  onFocusChange?: (focused: boolean) => void;
  /** Throttled "still typing" heartbeat (for presence). */
  onActivity?: () => void;
  /** Throttle window for `onActivity` in ms. Default 5000. */
  activityThrottleMs?: number;
};

export type UseInstantFieldReturn<T> = {
  /** The local (possibly unflushed) value. Bind to your input's `value`. */
  value: T;
  /** Imperative setter. Pass the next value (NOT a DOM event). */
  set: (next: T) => void;
  status: InstantFieldStatus;
  onFocus: () => void;
  onBlur: () => void;
};

export function useInstantField<T>(opts: UseInstantFieldOptions<T>): UseInstantFieldReturn<T> {
  const {
    value,
    onCommit,
    debounceMs = 400,
    equals = Object.is,
    onFocusChange,
    onActivity,
    activityThrottleMs = 5000,
  } = opts;

  const [state, setState] = useState<InstantFieldState<T>>({
    localValue: value,
    status: "idle",
    committedAwaitingRemote: null,
    pendingRemote: null,
  });

  // Refs so the debounce callback always reads the latest closures.
  const stateRef = useRef(state);
  stateRef.current = state;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const equalsRef = useRef(equals);
  equalsRef.current = equals;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const activityThrottleMsRef = useRef(activityThrottleMs);
  activityThrottleMsRef.current = activityThrottleMs;
  const lastActivityAtRef = useRef(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dispatch(action: InstantFieldAction<T>) {
    setState((s) => instantFieldReducer(s, action, equalsRef.current));
  }

  // Apply remote updates whenever the upstream `value` prop changes.
  useEffect(() => {
    dispatch({ type: "remote", value });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // On unmount: flush any pending edit synchronously so a card remount
  // within the debounce window doesn't silently drop the typed value.
  useEffect(() => {
    return () => {
      if (stateRef.current.status === "dirty") {
        commitNow();
      } else if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitNow() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = stateRef.current.localValue;
    if (equalsRef.current(pending, valueRef.current)) {
      // Nothing actually changed vs. server; just settle the status. Use
      // `settle`, NOT `saveSuccess` — no write happened, so there is no echo
      // coming and committedAwaitingRemote must not be touched.
      if (stateRef.current.status !== "idle") {
        dispatch({ type: "settle" });
      }
      return;
    }
    dispatch({ type: "saveStart" });
    void (async () => {
      try {
        await onCommitRef.current(pending);
        dispatch({ type: "saveSuccess", pendingValue: pending });
      } catch {
        dispatch({ type: "saveError", serverValue: valueRef.current });
      }
    })();
  }

  function scheduleCommit() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commitNow, debounceMs);
  }

  function pingActivity() {
    const fn = onActivityRef.current;
    if (!fn) return;
    const now = Date.now();
    if (now - lastActivityAtRef.current < activityThrottleMsRef.current) return;
    lastActivityAtRef.current = now;
    fn();
  }

  function set(next: T) {
    dispatch({ type: "set", value: next });
    scheduleCommit();
    if (!equalsRef.current(next, valueRef.current)) {
      pingActivity();
    }
  }

  function onFocus() {
    onFocusChangeRef.current?.(true);
  }

  function onBlur() {
    onFocusChangeRef.current?.(false);
    // Flush any pending edit immediately so leaving the field doesn't hide
    // an unsaved edit behind the debounce.
    if (stateRef.current.status === "dirty") {
      commitNow();
    }
  }

  return { value: state.localValue, set, status: state.status, onFocus, onBlur };
}
```

## How to use it

```tsx
const summaryField = useInstantField<string | null>({
  value: serverRow.summary,                       // SERVER value — see gotcha #1
  onCommit: (next) => patchRow(rowId, { summary: next }),
});

<input
  value={summaryField.value ?? ""}
  onChange={(e) => summaryField.set(e.target.value)}
  onFocus={summaryField.onFocus}
  onBlur={summaryField.onBlur}
  className={summaryField.status === "error" ? "ring-2 ring-destructive" : undefined}
/>
```

`onCommit` calls a narrow patch action:

```ts
"use server";
export async function patchRow(id: string, patch: Partial<RowFields>) {
  const supabase = await createServerClient();
  const { error } = await supabase.from("rows").update(patch).eq("id", id);
  if (error) throw new Error(error.message); // throw === the error signal
  // NOTE: no revalidatePath here — see "How it interlocks" below
}
```

## Mechanism, precisely

1. Keystroke → `field.set(value)` → reducer: status `dirty`, `localValue` updated → UI shows it instantly (optimistic).
2. Each `set` resets a **400ms trailing debounce timer**.
3. Timer fires → `commitNow`: status `saving`, `await onCommit(value)`.
4. Success → status `idle`. Throw → status `error`, field reverts to server value.
5. **Blur flushes immediately** — leaving a field never hides an edit behind the timer.
6. **Unmount flushes** — a row-switch within the 400ms window still commits to the right row (the captured `onCommit` closure targets the original id).

There is no explicit `"saved"` state — settled is `"idle"`. Status surfacing is deliberately minimal: most callers only style the **error** case (an inline red ring, no toast). `idle/dirty/saving` are usually not shown — instant-save means the field is effectively always saved, so a static "Saved" label is honest enough.

## Conflict resolution (last-write-wins, favoring the local editor)

The reducer is the whole story. The `value` prop is the **server-authoritative** value; a `useEffect([value])` dispatches `{type: "remote"}` whenever it changes (e.g. a realtime peer edit arrives).

State carries three pieces: `localValue`, `status`, and two transient slots — `pendingRemote` (a peer write parked while the local user is editing) and `committedAwaitingRemote` (a just-committed value parked while we wait for our own realtime echo).

- Field **idle/error** → remote value is applied directly, **unless** `committedAwaitingRemote` is set and the incoming value doesn't match it — that incoming value is a stale upstream from before our own commit, so it's ignored. Once a remote arrives that *does* match, the guard clears and normal sync resumes.
- Field **dirty/saving** → local typing wins. **Before** stashing in `pendingRemote`, the reducer checks `committedAwaitingRemote`: an incoming value matching it is this client's own echo and is *dropped* (not stashed) — otherwise `saveSuccess` would later replay it and clobber text typed after the commit. Anything else goes into `pendingRemote`. Use the caller's `equals` for the own-echo match, not `Object.is`: an object-typed echo is a fresh deserialized value and is never `Object.is`-equal to what was sent.
- On **saveSuccess**: if `localValue` still equals the committed value (covers "never typed during save" AND "typed away then back to committed"), settle to `idle` — replay a differing `pendingRemote` if one exists; otherwise record the committed value in `committedAwaitingRemote` for the in-flight echo. If the user kept typing a *different* value, status stays `dirty` for the next debounce flush BUT the committed value is still recorded in `committedAwaitingRemote` so the dirty-branch own-echo guard above can recognise it.
- On **`settle`** (a separate action): the debounced commit found `localValue === server`, so nothing actually got sent. Settle status to `idle` but leave `committedAwaitingRemote` *untouched* — no write happened, so recording a value here would freeze the idle-branch guard waiting on an echo that never comes. This is why the hook dispatches `settle` instead of `saveSuccess` for the no-op path.
- On **saveError**, the field reverts to `pendingRemote` (freshest server truth) if present, else the captured server value; both transient slots clear.
- On **`set`** (user typed again), `committedAwaitingRemote` is **PRESERVED** — the echo of the value just committed is still in flight, and the dirty-branch guard must recognise it. `pendingRemote` is cleared.

This is plain LWW at field granularity. There is **no CRDT / operational transform** — two people typing in the *same* free-text field simultaneously will have the last commit win. Field-level granularity keeps that rare.

## Gotchas — read these before implementing

1. **`value` must be the server row, not your local edit state.** If your component also keeps local state for instant rendering (the panel system does — see §3), keep the two separate. Feeding local state into `useInstantField.value` makes `commitNow`'s equality check (`localValue === valueRef.current`) think the save already applied and short-circuit it. The server value is the reconciliation anchor.

2. **Stale closures are killed with refs.** Every option is mirrored into a ref updated on render. The debounce timer is created once but always reads fresh closures. Don't "simplify" this away.

3. **Race: user keeps typing during a save.** `saveStart → set("c") → saveSuccess(pending="b")` — `saveSuccess` only settles to `idle` if `localValue` still equals the committed value; otherwise it's a no-op and the next debounce flushes `"c"`. No value is silently lost.

4. **Race: peer write lands mid-save.** Stashed in `pendingRemote`, replayed on `saveSuccess` / applied on `saveError`. Never dropped.

4a. **Race: our own realtime echo is still in flight after the save.** Discovered the hard way, in two phases. **Phase 1 (idle-branch flicker):** after `onCommit` resolves, the reducer goes idle — but the upstream `value` prop is still the stale pre-commit value, because the postgres_changes broadcast for our own write hasn't echoed back yet. Without a guard, the `remote` effect briefly snaps the field back to that stale value, then flips again when the echo lands — a visible flicker. The fix is the `committedAwaitingRemote` slot: on `saveSuccess` we record the value we committed, and in `remote` (idle/error) we ignore any incoming value that doesn't match it. **Phase 2 (dirty-branch clobber, the deeper bug):** if the user typed during the save and then *paused* but kept typing later, the in-flight echo arrives during `dirty`/`saving` — and the naive reducer stashes it in `pendingRemote`, which then gets replayed on the next `saveSuccess` and *overwrites the freshly-typed text*. The fix is to check `committedAwaitingRemote` in the dirty-branch too: a matching value is this client's own echo and gets dropped (the slot is consumed), only non-matching peer writes get stashed. The slot must therefore be **PRESERVED across `set`** (the user typed again, but the previous commit's echo is still inbound) and **recorded even when `saveSuccess` doesn't settle the status** (the "user kept typing a different value" branch). Use the caller's `equals` for the dirty-branch match — object echoes are deserialized fresh and never `Object.is`-equal. Don't ship the idle-only variant of this guard — the clobber bug bites the moment realtime latency exceeds the user's pause-then-type interval.

5. **`Object.is` vs. custom `equals` subtlety.** The `pendingRemote` no-op check uses `Object.is`, *not* the caller's `equals` — a loose predicate (case-insensitive, say) could treat two genuinely different values as equal, and the stashed value is read back out later. Preserve the truly-latest value.

6. **`onCommit` must `throw` on failure** — that is the error signal. Don't return an error object.

7. **The reducer returns the same object reference for no-ops** so React can bail out of re-rendering. Keep that property if you modify it.

8. **For a dynamic list of editable rows** (where you can't call a fixed number of hooks), `mail-show` uses a parallel hand-rolled debouncer — a `Map<rowId, pendingPatch>` + `Map<rowId, timer>`, same 400ms, coalescing partial patches per row, flushed on cleanup. Prefer `useInstantField` per-field wherever the field set is static; the Map variant only exists because the actions list is dynamic.

The reducer is exported specifically so it can be unit-tested without React. `mail-show` has ~300 lines of tests for it — port those too; they are the executable spec for the merge rules.

---

# 2. Multi-User Editing (Supabase Realtime)

## What this actually is

A genuine real-time collaborative system — **not** a `revalidatePath`/refresh fake. Three transport mechanisms ride one Supabase Realtime WebSocket connection:

| Mechanism | Carries | Persisted? |
|---|---|---|
| **postgres_changes** | Real DB row edits (INSERT/UPDATE/DELETE) fanned to peers | Yes (Postgres WAL) |
| **broadcast** | Field focus, panel selection, activity heartbeats, ephemeral shared view state | No (fire-and-forget) |
| **presence** | Stable identity — who's online, join/leave | No |

Concretely: User A edits a field; User B on the same page sees the value update in their input within ~1s, no refresh, plus a colored ring around the field A has focused and A's avatar in a stack.

The **key architectural decision**: identity is *stable* and goes via Phoenix presence (`track()`); focus/selection are *high-frequency* and go via `broadcast` (presence coalesces and drops repeat payloads, making it unreliable for rapid updates). Don't put focus state in presence.

## The write path: no `revalidatePath` for column edits

This is the crucial integration point with autosave. Narrow patch actions (the ones `useInstantField.onCommit` calls) **deliberately do NOT call `revalidatePath`**. The Supabase Realtime `postgres_changes` fan-out *is* the propagation mechanism — the editing user already sees their change optimistically, and peers receive it via the WAL stream.

`revalidatePath` is still used — but only for **structural** mutations (create / delete / move), where server-derived joins and computed columns must recompute. So the rule is:

- **Column edit** (patch one row's fields) → mutate, no revalidate → realtime fans out.
- **Structural change** (insert/delete/reparent) → mutate, `revalidatePath` → full re-fetch.

## The foundational hook — `useRealtimeChannel`

One `supabase.channel(name)` per top-level surface, created on mount, removed on unmount. The complete file is `src/lib/realtime/channel.ts`; the load-bearing details:

```ts
// Postgres_changes subscriptions are RLS-gated server-side, so the channel
// needs the user's JWT attached BEFORE subscribe() sends the phx_join.
let cancelled = false;
void supabase.auth.getSession().then(({ data }) => {
  if (cancelled) return;
  const token = data.session?.access_token;
  if (token) supabase.realtime.setAuth(token);   // <-- without this, postgres_changes
  ch.subscribe((status) => {                      //     are silently denied
    setSubscribed(status === "SUBSCRIBED");
  });
});
return () => {
  cancelled = true;
  setSubscribed(false);
  void supabase.removeChannel(ch);                // cleanup
  setChannel(null);
};
```

- Callbacks are held in refs (`useLatest`) so fresh closures each render don't trigger re-subscription. Only `name`, `presenceKey`, and **JSON-serialized** subscription shapes drive re-subscription — array props must be serialized into the dep key or the channel thrashes.
- Returns `{ channel, subscribed }`. `subscribed` gates `channel.track()` — Supabase silently drops `track()` calls made before the channel reaches `SUBSCRIBED`.

## Presence layer

`usePresence` builds on `useRealtimeChannel`:

```
Identity   → channel.track({ userId, email, profile })   // once, on subscribe
Focus      → broadcast "presence-focus"      // every change
Selection  → broadcast "presence-selection"  // every panel change
Activity   → broadcast "presence-activity"   // throttled heartbeat (5s buckets)
```

On `presence-sync`, the client **re-broadcasts its own focus + selection** so a freshly-joined peer catches up. Peer colors are deterministic from `userId` (a djb2 hash into an 8-color palette) so the same peer is always the same color without coordination.

A `WorkspacePresenceProvider` wraps each surface and exposes `peers`, `focus`/`setFocus`, `selection`/`setSelection`, `pingActivity`, and `onPostgresChanges(handler)` — a registration system where multiple handlers stack (kept in a ref so registering doesn't re-subscribe).

UI layers built on this: a global online stack (everyone, anywhere, click-to-jump-to-their-page), per-surface avatar stacks (idle >120s → grayscale), field-level focus rings, row-level colored dots, and transient "peer just changed this" flash rings.

## Ephemeral shared state — `useSharedViewState`

For state that should sync between peers but **not** persist (preview toggles, simulation picks): pure broadcast over a per-record channel, protocol `view-patch` / `view-full` / `view-request`. Patches **merge recursively** (`deepMerge`) so two peers editing different keys both survive — better than LWW for non-conflicting structured state. A monotonic `ts` orders catch-up snapshots so an established client isn't reset by a new joiner's reply.

## Database / backend requirements

For every collaboratively-edited table:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE my_table;   -- enables postgres_changes
ALTER TABLE my_table REPLICA IDENTITY FULL;               -- UPDATE/DELETE payloads carry the OLD row
```

`REPLICA IDENTITY FULL` is **required**, not optional — the prior row (`change.old`) is needed for column-level diffing and delete attribution. It costs WAL bloat; acceptable at small-team scale, revisit if usage spikes.

RLS: every table has RLS enabled with a SELECT policy the editing user passes — realtime gates `postgres_changes` delivery on that exact policy server-side. In `mail-show` the policies are uniformly permissive (`auth.role() = 'authenticated'` for all CRUD) — RLS here is an auth gate, not data isolation. If your project needs per-row ownership, the realtime fan-out will respect it automatically (peers only get rows they can SELECT).

## Concurrency model

**Last-write-wins, no version columns, no locking.** No optimistic-concurrency `version` column, no `updated_at` conflict check, no row locks. `updated_at`/`updated_by` exist purely for display ("last edited by X"). All conflict handling is the client-side, per-field `instantFieldReducer` from §1. Same-field simultaneous edits clobber; field granularity makes that rare. If your domain needs true conflict-free text co-editing, you'd add Yjs/Liveblocks — `mail-show` deliberately did not.

## Gotchas — the expensive ones

1. **The browser Supabase client MUST be a module-level singleton.** A fresh client per call resets the realtime client's `accessToken` and silently breaks RLS-gated `postgres_changes`.
2. **Call `supabase.realtime.setAuth(token)` before `subscribe()`.** Without it: broadcast + presence work, but `postgres_changes` are denied. The user-visible signature is *"focus rings work, content doesn't propagate until refresh."* This is the #1 time-sink bug.
3. **Add tables to the `supabase_realtime` publication.** Forgetting = writes succeed, peers see nothing.
4. **`REPLICA IDENTITY FULL`** — see above; required for diffing.
5. **`.track()` before `SUBSCRIBED` is silently dropped** — gate on the `subscribed` flag.
6. **Focus/selection via broadcast, not presence** — presence coalesces high-frequency payloads.
7. **Serialize array subscription props into the channel's effect dep key**, or a new-reference-every-render array re-subscribes the channel constantly.
8. **INSERT events can't be column-merged** into local state (view-derived columns aren't in the raw payload) — coalesce them into a debounced `router.refresh()`. UPDATE events *can* be merged column-wise into a local mirror array.
9. **Two propagation strategies coexist** and you should pick one deliberately per surface: (a) merge `postgres_changes` into a local mirror of server state (fast, surgical — used for structured editors), or (b) coalesce changes into a debounced `router.refresh()` (simple — used for join-heavy document editors).

The transferable core is the `src/lib/realtime/` directory (~14 files): `channel.ts`, `presence.ts`, `presence-context.tsx`, `use-instant-field.ts`, `use-shared-view-state.ts`, plus the UI bits (`avatar-stack`, `field-highlight`, `flash-ring`, `record-presence`). It is dependency-light — only `@supabase/supabase-js` + `@supabase/ssr` + React. No Yjs, no Liveblocks.

---

# 3. Reusable Panel System (embeddable across pages)

## The problem it solves

`mail-show` has a complex multi-panel editor (`LettersWorkspace`) — a horizontal filmstrip of 6 panels you slide through as you drill down (list → group → item → sub-editors). The same editor must run **standalone** as its own page *and* **embedded** inside a different page (the graph view) as an inline inspector, in a narrow column.

The reusable lesson is **how to parameterize one complex stateful component to behave correctly in both modes** — not the specific letter-editing domain.

## The slide mechanic

One flex track, N× viewport wide, holding N fixed-width panel slots; a CSS `translateX` shifts it.

```tsx
<div className="relative overflow-hidden">        {/* viewport — clips */}
  <div
    className={cn("flex", forceNarrow ? null : "transition-transform duration-150 ease-out",
                  narrow ? "w-[600%]" : "w-[600%] lg:w-[300%]")}
    style={{ transform: `translateX(${slideOffset}%)` }}
  >
    <div className="flex w-1/6 shrink-0 flex-col">{/* slot 0 */}</div>
    {/* ... slots 1..5 ... */}
  </div>
</div>
```

- Outer `overflow-hidden` = viewport (fixed at host width, clips).
- Inner `flex` = track, width `w-[600%]` so each `w-1/6` slot is exactly one viewport wide (`600%/6 = 100%`).
- Wide screens use `lg:w-[300%]` instead → each slot is `50%` → **two panels show side-by-side**. Narrow shows one.
- `translateX` is a percentage of the *element's own width* (the 600% track), so each step of `-(100/6)%` shifts exactly one viewport.

`slideOffset` is **derived purely from a `view` enum** (`"list" | "group" | "main" | ...`) — there is no integer step counter. Every navigation helper just calls `setView(...)`; the transform recomputes via `useMemo`. Keep panel count, track width, slot width, and the step divisor in lockstep — they desync easily (the in-repo doc already drifted from "5 panels / 250%" to "6 / 600%").

## The standalone-vs-embedded parameterization

Five props, all omitted in standalone mode, switch the component into embedded mode:

```ts
type WorkspaceProps = {
  // ...data + initial-selection ids...
  controlledSelection?: ControlledSelection | null;  // parent pushes selection in
  onSelectionChange?: (sel: ControlledSelection | null) => void; // child bubbles selection out
  onClose?: () => void;
  forceNarrow?: boolean;        // force single-panel layout regardless of viewport
  presenceProvided?: boolean;   // parent already mounted the realtime presence provider
};
```

### Controlled-via-mirroring (the key pattern)

The component is **not purely controlled**. It *always* keeps its own internal selection state. When a parent supplies `onSelectionChange`, the component **mirrors** the parent's selection into its internal state and **bubbles** internal changes back out. Pure-controlled would force the parent to replicate all the drill-down/back-button logic — mirroring keeps that logic in one place.

```ts
const isControlled = !!onSelectionChange;  // keyed off the CALLBACK, not the value
```

Two effects keep parent and internal state in sync, with a ref to break the feedback loop:

```ts
const controlledApplyRef = useRef(false);

// Apply effect: parent → internal
useEffect(() => {
  if (!onSelectionChange) return;
  controlledApplyRef.current = true;          // arm loop-suppression
  // ...setSelectedGroupId / setView / hydrate derived state synchronously...
}, [controlledSelection]);                    // deliberately NOT depending on onSelectionChange

// Bubble effect: internal → parent
useEffect(() => {
  if (!onSelectionChange) return;
  if (controlledApplyRef.current) {           // this change came from an apply — don't echo
    controlledApplyRef.current = false;
    return;
  }
  onSelectionChange(deriveSelection(/* internal state */));
}, [selectedGroupId, selectedId, view /* ...values only... */]);
```

## Gotchas — for any embeddable complex component

1. **Mirror, don't pure-control.** Internal selection state always exists; the parent gets a copy and pushes updates. The drill-down logic lives once, in the child.
2. **The loop-breaker ref is essential.** A bidirectional apply↔bubble effect pair infinite-loops without it. The apply effect sets the ref; the bubble effect consumes it (skip-once) on the same commit.
3. **Omit the callback from effect deps.** Parents recreate `onSelectionChange` every render. If the apply effect depended on it, every parent render would re-run the effect and clobber the user's in-flight edits. Depend on *values* only; add an eslint-disable with a comment explaining why.
4. **Hydrate derived state synchronously inside the apply effect.** When the parent switches the selected entity, any derived local state (e.g. an editable form mirror keyed on the old id) is momentarily stale → the panel flashes an empty/wrong state. Re-derive it in the same effect tick.
5. **Resolve stable keys to concrete ids at mount.** The parent may track selection by a stable logical key while the child keys on a database id — resolve key→id at mount so the first render isn't an empty state.
6. **Disable the slide transition when embedded.** Animating across N intermediate slots flashes their empty-state placeholders in a narrow embed. Turn off `transition-transform` when `forceNarrow`.
7. **Force layout mode; don't trust the viewport.** A 380px embed column is "narrow" regardless of window size. `const narrow = forceNarrow ?? viewportNarrow` lets the prop override `matchMedia`.
8. **Guard every side effect that assumes standalone ownership.** The component writes the URL (`router.replace`) to deep-link its selection — that effect early-returns when `isControlled`, because the host page owns the URL. Anything touching a global/shared resource (URL, document title, a presence channel) needs an "am I embedded?" guard.
9. **Hoist shared singletons; let the child detect.** Realtime presence runs on a *named* channel — two providers with the same name = two channels = doubled events. `presenceProvided` tells the child "the parent already mounted the provider, skip yours" (and skip the chrome the parent renders itself).
10. **Clear broadcast state on unmount.** If the parent keeps the presence provider alive after the embed closes, the child must clear its broadcast selection on unmount or peers keep seeing a stale "viewing X" location.
11. **Keep "what's in this slot" derived, not stored.** The contents of each panel are `useMemo`/inline-derived from `(selection ids + view)`. One source of truth; everything else computed.

## Deep-linking (standalone only)

Standalone resolves URL params (`?group=...&letter=...`) **server-side** in the RSC into flat `initial*` props, and the client writes the URL via `router.replace` on selection change. In embedded mode the URL belongs to the host page, so both the read (host passes `initial*`) and the write (`router.replace` guarded by `isControlled`) defer to the parent. `initial*` props are a *mount-time seed only*; ongoing updates come from URL→remount (standalone) or the `controlledSelection` effect (embedded).

---

# 4. Graph View (React Flow — visualize & connect objects)

## The pattern in one sentence

Domain rows are transformed into React Flow `nodes`/`edges` by a single `useMemo`; the graph holds **no xyflow state of its own**; drag gestures resolve a drop target, dispatch a server mutation, and the next prop-driven render snaps everything into place.

## Architecture

A server component fetches all domain data in parallel and hands typed arrays to a client graph component. The client component's heart is one big `useMemo` that produces `{ nodes, edges }`. There is **no `useNodesState`, no `onNodesChange`, no `applyNodeChanges`** — `nodes` and `edges` are passed straight from the memo to `<ReactFlow>`.

```ts
const { nodes, edges } = useMemo(() => computeLayout(domainData, selection), [domainData, selection]);
// <ReactFlow nodes={nodes} edges={edges} ... />  — fully controlled by props, no internal state
```

xyflow tolerates this: during a drag the node moves visually, but the delta is **discarded** when props don't change. This is the cleanest model for a "snap-to-grid, server-is-truth" graph — but it means *never rely on xyflow to remember anything*. Every position, edge, and selection is recomputed each render.

## Domain → nodes/edges

- **Custom node types** registered in a `nodeTypes` map; each is a `memo`-wrapped component.
- **IDs encode the domain entity**: `group:<id>`, `letter:<groupId>:<variantKey>`, `report:<segmentId>`, etc. Every drag handler regex-parses the id back to a domain reference. This is the glue — it avoids threading lookup maps through xyflow's loosely-typed `data` and makes `getIntersectingNodes()` results directly actionable.
- Parent/child nesting uses xyflow `parentId` (child `position` is relative to the parent). Note: `parentId` *without* `extent: "parent"` lets a child be dragged out of its parent onto another — deliberate.
- Node `data` carries the display payload plus an `onSelect` closure wired straight to selection dispatch. Nodes are `selectable: false / focusable: false` — selection is the app's own state, not xyflow's.

## Layout: manual coordinate computation

No dagre, no elk, no built-in layout. A grid (column = category, row = time bucket) computed inside the `useMemo`: size each cell to its content, compute row heights and column widths as prefix sums, position nodes absolutely. Manual layout is the right call when the structure is a known grid — it's deterministic, fast, and gives exact control.

**Performance:** the layout memo is O(nodes) and depends on all domain data — so per-frame drag-hover highlight is kept in a *separate, thin* `useMemo` (`decoratedNodes`) that just `.map()`s hover flags onto the already-computed nodes. Never put per-frame UI state in the heavy layout memo.

## Drag-and-drop → server actions

One `onNodeDragStop` dispatcher:

```ts
function onNodeDragStop(e, node) {
  // resolve the drop target:
  const flowPt = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const targetRow = rowAtFlowY(flowPt.y);              // manual hit-test against row bands
  // or: rf.getIntersectingNodes(node) for node-on-node drops
  if (!targetRow || targetRow === node's current row) return;  // no-op → snaps back
  recordUndo({ /* inverse mutation */ });               // capture undo BEFORE dispatch
  void moveEntityToRow(parseId(node.id), targetRow);     // server action
}
```

- **Invalid drop → snap back, free.** No action fires; since `nodes` is prop-derived, the next render leaves the node where the layout puts it; xyflow's drag delta is discarded.
- **Valid drop:** server action mutates → `revalidatePath` → RSC re-fetches → layout memo recomputes → node lands at the new grid coordinate.
- Use `rf.getIntersectingNodes(node)` for "which node am I over"; use `screenToFlowPosition` + manual band hit-testing for "which row am I over" (background bands aren't interactive nodes).
- `onNodeDragStart`/`onNodeDrag` drive cheap state slices (`hoveredRowId`, `hoveredGroupId`) for visual drop-target feedback.

## User-created connections (edges)

Two flows:

1. **Reconnect an existing edge** — mark edges `reconnectable: "target"`; `onReconnect` (valid drop) retargets, `onReconnectEnd` with an `edgeReconnectSuccessful` ref still false means "dropped on empty space" → clear the link.
2. **Create a new link** — in edit mode the layout mints tiny `connectionSource` handle-nodes next to entities that lack a connection; `onConnect` parses the source id and dispatches the link mutation. `isValidConnection` filters drop targets live; target handles are drop-only (`isConnectableStart={false}`) so users can't draw meaningless edges.

**Optimistic edge override:** an edge change would visibly flicker (jump to old target) for the ~100ms between drop and `revalidatePath`. Fix: keep an `optimisticOverride` map (`Record<actionId, newTarget>`); the layout memo reads it *before* the server field; clear the entry in a `finally{}` once the server confirms.

## Gotchas

1. **Controlled without `useNodesState`** — pass `nodes`/`edges` straight from a memo, no change handlers. Drag deltas are visual-only and discarded. Server is the only truth.
2. **`nodesConnectable` must be `true` for reconnect drags to even render** — even if you don't want free-form connections. Then make every handle drop-only or unconnectable so no rogue edges can be drawn.
3. **Stable callback identity matters.** A real bug here: the graph recreated an `onSelectionChange` callback every render; the embedded panel had it in an effect's deps → fired on every keystroke. Wrap callbacks passed to embedded children in `useCallback`.
4. **Optimistic override map** prevents reconnect flicker (see above).
5. **Split the heavy layout memo from per-frame state** — see Performance above.
6. **All custom node components `memo`-wrapped**; xyflow v12 types `NodeProps.data` loosely, so each re-asserts its own data shape with a cast.
7. **Encode domain refs into node/edge ids** — the single most useful convention; handlers parse ids instead of carrying lookup maps.
8. **Sticky labels (axis headers) are HTML overlays, not nodes** — absolutely-positioned divs that read viewport state via `onMove`/`onMoveEnd` and stay pinned through pan/zoom. Don't make axis labels into nodes.
9. **Edit-lock toggle** — `mail-show` defaults the graph to read-only (`nodesDraggable`/`nodesConnectable` false, `panOnDrag` true) so it reads as a static map until explicitly unlocked. An undo stack (capped, `Cmd/Ctrl+Z`) records an inverse mutation before each dispatch.

The reusable kernel: (1) one memo mapping rows → `nodes`/`edges` with computed coords and encoded ids, (2) drag handlers that resolve a drop target and dispatch a mutation, (3) server actions that validate + `revalidatePath`, (4) props-driven re-render with zero xyflow state, (5) an optimistic override map for any change that would otherwise flicker.

---

# How the four features interlock

Implementing them in isolation misses the seams. The wiring:

- **Autosave is the write path.** A field commits a narrow patch.
- **The patch action does NOT `revalidatePath`** — that's what lets realtime, not a full re-fetch, be the propagation path. Only structural changes revalidate.
- **Realtime is the read/propagation path.** `postgres_changes` delivers a peer's column edit; it arrives as a new `value` prop into the peer's `useInstantField`, whose reducer applies it (idle) or stashes it (mid-edit).
- **The panel system consumes both** — its fields are `useInstantField` instances; it mirrors realtime changes into local state.
- **The graph reuses the panel system** as an embedded inspector, and its own drag mutations *are* structural changes, so they *do* `revalidatePath`.

So the same `useInstantField` reducer that debounces your keystrokes also resolves the conflict when a realtime peer edit lands mid-save. Autosave and multi-user editing are not two features — they are two halves of one loop.

## Suggested adoption order

1. **`useInstantField`** first — it is standalone, dependency-free, unit-testable, and useful even single-user. Port it + its tests verbatim.
2. **Realtime** second — `useRealtimeChannel` + presence. This is where the Supabase-specific gotchas live (singleton client, `setAuth` before `subscribe`, publication, `REPLICA IDENTITY FULL`). Wire `postgres_changes` into the `value` prop of step 1.
3. **The panel system** third — only if you have a genuinely multi-panel drill-down editor. The controlled-via-mirroring pattern is the transferable part; the slide CSS is cosmetic.
4. **The graph** last — it depends on React Flow and reuses the panel system as an inspector. The "props-driven, server-is-truth, ids encode domain" approach is the lesson.

If the target project uses a non-Supabase backend: steps 1 and 3 transfer unchanged (swap the `onCommit` body and the data layer). Step 2's *architecture* transfers (separate channels for durable row-sync vs. ephemeral presence vs. ephemeral shared-state; LWW at field granularity) but the transport code is Supabase-specific. Step 4 needs React Flow regardless.
