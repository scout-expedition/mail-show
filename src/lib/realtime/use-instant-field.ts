"use client";

import { useEffect, useRef, useState } from "react";

export type InstantFieldStatus = "idle" | "dirty" | "saving" | "error";

export type InstantFieldState<T> = {
  localValue: T;
  status: InstantFieldStatus;
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
      return { localValue: action.value, status: "dirty" };
    case "remote":
      if (state.status === "dirty" || state.status === "saving") return state;
      if (equals(action.value, state.localValue)) return state;
      return { localValue: action.value, status: state.status };
    case "saveStart":
      return { ...state, status: "saving" };
    case "saveSuccess":
      if (
        state.status === "saving" &&
        equals(state.localValue, action.pendingValue)
      ) {
        return { ...state, status: "idle" };
      }
      return state;
    case "saveError":
      return { localValue: action.serverValue, status: "error" };
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
  } = opts;

  const [state, setState] = useState<InstantFieldState<T>>({
    localValue: value,
    status: "idle",
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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dispatch(action: InstantFieldAction<T>) {
    setState((s) => instantFieldReducer(s, action, equalsRef.current));
  }

  // Apply remote updates whenever the upstream `value` prop changes.
  // The reducer enforces the LWW rule (drops when dirty/saving).
  useEffect(() => {
    dispatch({ type: "remote", value });
  }, [value]);

  // Clear pending timer on unmount so a late commit doesn't fire after the
  // component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
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

  function set(next: T) {
    dispatch({ type: "set", value: next });
    scheduleCommit();
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
