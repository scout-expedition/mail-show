"use client";

import { useCallback, useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const RESYNC_INTERVAL_MS = 30_000;

/**
 * Fetches `select extract(epoch from now())` from the database once on
 * mount, stores the offset against `performance.now()`, and re-syncs
 * every 30 s to correct drift.
 *
 * Returns a stable `nowMs()` accessor that returns milliseconds since the
 * Unix epoch according to the server's clock. Use this instead of
 * `Date.now()` inside timer components — all persisted timestamp columns
 * (`started_at`, `paused_at`, etc.) are written by Postgres `now()`, so
 * display stays authoritative to the same time source.
 *
 * The accessor uses `Date.now()` as a safe fallback while the very first
 * sync is in flight (typically <100 ms; the error is negligible).
 */
export function useServerClock(): () => number {
  // offsetMs = serverTimeMs - performance.now() at the moment of the last
  // successful sync. serverTimeMs ≈ performance.now() + offsetMs. Null
  // before the first sync — the accessor falls back to `Date.now()` for
  // that ~100ms window so callers see a sane value immediately.
  const offsetRef = useRef<number | null>(null);

  const syncNow = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // `extract(epoch from now())` returns a float of seconds since Unix epoch.
    const { data, error } = await supabase
      .rpc("get_server_epoch_seconds")
      .maybeSingle<number>();

    if (error || data === null || data === undefined) return;
    // Convert seconds → ms; update offset relative to performance.now().
    offsetRef.current = (data as number) * 1000 - performance.now();
  }, []);

  useEffect(() => {
    // Seed with the client's own clock so the accessor reads usefully
    // during the brief window before the first server sync lands. Lives
    // in the effect (not useRef init) to satisfy react-hooks/purity.
    if (offsetRef.current === null) {
      offsetRef.current = Date.now() - performance.now();
    }
    void syncNow();
    const id = setInterval(() => void syncNow(), RESYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [syncNow]);

  return useCallback(
    () => performance.now() + (offsetRef.current ?? Date.now() - performance.now()),
    []
  );
}
