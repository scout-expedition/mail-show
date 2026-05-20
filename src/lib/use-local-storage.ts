"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side persisted state backed by window.localStorage. Starts from
 * `initial` on first render (SSR-safe) and hydrates from storage once mounted,
 * so no server/client text mismatch. Writes are fire-and-forget.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      // Hydrate from localStorage — the external system this hook synchronizes with.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore parse/storage errors and keep the initial value
    }
     
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: T) => T)(prev)
            : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // ignore quota / privacy-mode errors
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, update];
}
