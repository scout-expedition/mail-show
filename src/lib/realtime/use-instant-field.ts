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
 *               when status is "idle" or "error" (caller would have already
 *               filtered if the row is otherwise stale). When "dirty" or
 *               "saving": a value matching committedAwaitingRemote is this
 *               client's own echo → dropped. Otherwise local typing wins, so
 *               the value is STASHED in pendingRemote (not dropped) and
 *               replayed when the save settles.
 * - `saveStart`   → commit in flight. status := "saving".
 * - `saveSuccess` → commit returned. Always records the committed value in
 *                   committedAwaitingRemote (its realtime echo is in flight).
 *                   Transitions to "idle" only if localValue still equals the
 *                   committed value (the user didn't keep typing a different
 *                   value during the save). On that transition a stashed
 *                   pendingRemote that differs from localValue is applied so a
 *                   peer write during the save window converges.
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
        // dropping it, so it can be replayed once the save settles. A
        // remote that repeats the exact value already stashed is a true
        // no-op; return the same state so React skips the re-render.
        // Compare with Object.is, NOT the caller's `equals`: a loose
        // predicate could call two distinct values equal, and saveError
        // / saveSuccess read pendingRemote.value back out — so we must
        // keep the genuinely-latest value unless it is truly identical.
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
  /** Server-authoritative current value (typically passed from the workspace's row state). */
  value: T;
  /** Persist function called after debounce. Throwing => status = "error" and the field reverts to `value`. */
  onCommit: (next: T) => Promise<void> | void;
  /** Debounce window in ms. Default 400. */
  debounceMs?: number;
  /** Equality predicate. Default Object.is. */
  equals?: (a: T, b: T) => boolean;
  /** Notified `true` on focus, `false` on blur. */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Throttled "still typing" heartbeat. Fired at most once per
   * `activityThrottleMs` while the field is in `dirty` status (i.e. the user
   * has typed since the last commit). Lets presence-aware consumers keep the
   * peer marked active without re-firing focus events.
   */
  onActivity?: () => void;
  /** Throttle window for `onActivity` in ms. Default 5000 — aligned with
   *  the 5s lastActiveAt bucketing in usePresence; broadcasting more often
   *  yields no extra precision and just inflates channel traffic. */
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

/**
 * Debounced per-field instant-save with LWW conflict handling. The local
 * value is the source of truth while editing; remote updates to the `value`
 * prop are accepted only when the field is idle (or in error state).
 *
 * Blur flushes any pending debounce immediately so leaving the field
 * doesn't hide an unsaved edit behind the timer.
 */
export function useInstantField<T>(
  opts: UseInstantFieldOptions<T>
): UseInstantFieldReturn<T> {
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
  // The reducer enforces the LWW rule (drops when dirty/saving).
  useEffect(() => {
    dispatch({ type: "remote", value });
  }, [value]);

  // On unmount: flush any pending edit synchronously so a card remount
  // (e.g. `key={letterState.id}` switching between rows within the debounce
  // window) doesn't silently drop the typed-but-unsaved value. The captured
  // `onCommit` closure still points at the row this hook was instantiated
  // for, so the edit lands on the right id even though the new instance has
  // already taken over the DOM. Status transitions from this commit go to
  // the unmounted state and are discarded, which is fine — the await
  // chain still runs to completion.
  useEffect(() => {
    return () => {
      if (stateRef.current.status === "dirty") {
        // commitNow clears the timer + dispatches saveStart/saveSuccess;
        // setState after unmount is a no-op + safe.
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
    // Throttled "still typing" signal. Skipped when the value didn't actually
    // change (reducer's no-op) — we still attempt because the input event
    // fired, but the dirty status check below filters re-emits during a
    // saving window where local === server.
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

  return {
    value: state.localValue,
    set,
    status: state.status,
    onFocus,
    onBlur,
  };
}
