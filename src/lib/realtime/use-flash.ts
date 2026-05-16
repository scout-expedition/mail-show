"use client";

// Transient "a peer just did this" highlight. `flash(keys, color)` tints
// each key with a color for `durationMs`, then clears it. Read the live
// color for a control via the returned `flashes` map — typically fed into
// <FlashRing>. Used to surface remote preview-toggle changes the way the
// impact-tile editor flashes a peer's remote value change.

import { useCallback, useEffect, useRef, useState } from "react";

export function useFlash(durationMs = 600): {
  flashes: Record<string, string>;
  /** Tint `keys` with `color` for `durationMs`. No-op on empty keys or a
   *  null color (e.g. a peer with no resolved avatar color). */
  flash: (keys: string[], color: string | null) => void;
} {
  const [flashes, setFlashes] = useState<Record<string, string>>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flash = useCallback(
    (keys: string[], color: string | null) => {
      if (keys.length === 0 || !color) return;
      setFlashes((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = color;
        return next;
      });
      for (const k of keys) {
        const existing = timersRef.current.get(k);
        if (existing) clearTimeout(existing);
        timersRef.current.set(
          k,
          setTimeout(() => {
            timersRef.current.delete(k);
            setFlashes((prev) => {
              if (!(k in prev)) return prev;
              const next = { ...prev };
              delete next[k];
              return next;
            });
          }, durationMs)
        );
      }
    },
    [durationMs]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return { flashes, flash };
}
