"use client";

import { useEffect, useRef, useState } from "react";

export type InstantFieldStatus = "idle" | "dirty" | "saving" | "error";

export type InstantFieldState<T> = {
  localValue: T;
  status: InstantFieldStatus;
  /**
   * After a successful commit, the value we just sent to the server. Remote
   * updates that don't match this are ignored until realtime catches up to it,
   * so a saveSuccess→idle transition can't briefly snap the field back to the
   * stale upstream value while the realtime broadcast is in flight.
   * Cleared on `set` (user typed again) and on `remote` once it matches.
   */
  committedAwaitingRemote?: T | null;
};

export type InstantFieldAction<T> =
  | { type: "set"; value: T }
  | { type: "remote"; value: T }
  | { type: "saveStart" }
  | { type: "saveSuccess"; pendingValue: T }
  | { type: "saveError"; serverValue: T };

/**
 * Pure state machine for a single instant-save field. Exported so the
 * LWW merge rule + status transitions can be unit-tested without React.
 *
 * - `set`     → user typed. localValue := value, status := "dirty".
 *               No-op if `equals(value, localValue)`.
 * - `remote`  → server pushed a new value via postgres_changes. APPLIED
 *               when status is "idle" or "error" (caller would have already
 *               filtered if the row is otherwise stale). DROPPED when
 *               "dirty" or "saving" — local typing wins.
 * - `saveStart`   → commit in flight. status := "saving".
 * - `saveSuccess` → commit returned. Only transitions to "idle" if the user
 *                   didn't keep typing during the save (localValue still
 *                   matches the value that was committed).
 * - `saveError`   → commit threw. Revert localValue to the server value and
 *                   surface "error" (inline glyph, no toast — caller styles it).
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
        committedAwaitingRemote: null,
      };
    case "remote":
      if (state.status === "dirty" || state.status === "saving") return state;
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
      };
    case "saveStart":
      return { ...state, status: "saving" };
    case "saveSuccess":
      if (
        state.status === "saving" &&
        equals(state.localValue, action.pendingValue)
      ) {
        return {
          ...state,
          status: "idle",
          committedAwaitingRemote: action.pendingValue,
        };
      }
      return state;
    case "saveError":
      return {
        localValue: action.serverValue,
        status: "error",
        committedAwaitingRemote: null,
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
      // Nothing actually changed vs. server; just settle the status.
      if (stateRef.current.status !== "idle") {
        dispatch({ type: "saveSuccess", pendingValue: pending });
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
