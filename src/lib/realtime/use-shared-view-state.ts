"use client";

// Live "shared view state" sync over a dedicated per-record Supabase
// Realtime broadcast channel. Keeps an ephemeral, non-persisted view (a
// preview toggle + simulation picks) identical for every collaborator
// looking at the same record.
//
// Wire protocol — broadcast events on `channelName`:
//   view-patch    {ts, actorColor, data: ViewStatePatch<T>}  a peer changed
//   view-full     {ts, actorColor, data: T}                  snapshot reply
//   view-request  {}                                         "I just joined"
//
// Patches MERGE RECURSIVELY: a patch carries only the entries that changed,
// and `deepMerge` folds them into nested objects. Two peers editing
// different controls — even different entries of the same map — both
// survive; only edits to the *same* entry resolve last-write-wins. `ts` is
// a strictly-monotonic stamp that orders full-snapshot replies so a fresh
// joiner adopts the live snapshot while an established client ignores
// another joiner's reply.
//
// The hook owns the state (single merge site — no consumer/authority
// divergence). Outbound payloads read the synchronous `stateRef`, never
// (possibly stale) React render state.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRealtimeChannel } from "./channel";
import { usePresenceContext } from "./presence-context";

const PATCH_EVENT = "view-patch";
const FULL_EVENT = "view-full";
const REQUEST_EVENT = "view-request";
const EVENTS = [PATCH_EVENT, FULL_EVENT, REQUEST_EVENT];

/** A patch: scalar keys carry a replacement; object-valued keys carry a
 *  partial that merges entry-wise (recursively) into the current value. */
export type ViewStatePatch<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

type Envelope<T> = {
  ts: number;
  actorColor: string | null;
  data: ViewStatePatch<T> | T;
};

export type SharedViewStateRemote<T> = {
  /** State immediately before the remote change — diff against `next`. */
  prev: T;
  /** Full state after applying the incoming patch / snapshot. */
  next: T;
  /** Avatar color of the peer who made the change, when known. */
  actorColor: string | null;
  /** "patch" — a peer changed something live. "snapshot" — a catch-up
   *  reply received on join. Consumers typically only flash on "patch". */
  kind: "patch" | "snapshot";
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively merge `patch` into `base`: nested plain objects merge
 *  entry-wise; everything else (scalars, null) replaces. Never deletes a
 *  key — callers represent "cleared" with a sentinel value, not absence. */
function deepMerge<O extends object>(base: O, patch: object): O {
  const next = { ...base } as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  for (const [key, pv] of Object.entries(patch)) {
    if (pv === undefined) continue;
    const bv = b[key];
    next[key] =
      isPlainObject(pv) && isPlainObject(bv) ? deepMerge(bv, pv) : pv;
  }
  return next as O;
}

export function useSharedViewState<T extends object>(opts: {
  /** Stable, per-record channel name, e.g. `endings-view:<documentId>`. */
  channelName: string;
  /** Local starting snapshot. Read once on mount (later prop changes are
   *  ignored — pass a stable seed). */
  initialState: T;
  /** Called for every remote change. The hook has already applied `next`
   *  to `state`; use this only to diff `prev`/`next` for flashes. */
  onRemote?: (change: SharedViewStateRemote<T>) => void;
}): {
  /** The live shared state. */
  state: T;
  /** Apply a local change and broadcast it. Pass only the changed entries;
   *  a function form receives the current authoritative state. */
  update: (
    patch: ViewStatePatch<T> | ((current: T) => ViewStatePatch<T>)
  ) => void;
  /** Apply a local change WITHOUT broadcasting — for deterministic local
   *  derivations every client computes identically (e.g. default-fill). */
  updateLocal: (
    patch: ViewStatePatch<T> | ((current: T) => ViewStatePatch<T>)
  ) => void;
} {
  const { channelName, initialState, onRemote } = opts;
  const { selfColor } = usePresenceContext();

  const [state, setState] = useState<T>(initialState);
  const stateRef = useRef<T>(initialState);
  const tsRef = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Latest onRemote / color in refs so callbacks stay referentially stable.
  const onRemoteRef = useRef(onRemote);
  const selfColorRef = useRef(selfColor);
  useEffect(() => {
    onRemoteRef.current = onRemote;
    selfColorRef.current = selfColor;
  });

  const sendFull = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: "broadcast",
      event: FULL_EVENT,
      payload: {
        ts: tsRef.current,
        actorColor: selfColorRef.current,
        data: stateRef.current,
      } satisfies Envelope<T>,
    });
  }, []);

  // Apply a local change. `broadcast` false = a deterministic local
  // derivation (e.g. default-fill) every client recomputes identically.
  const apply = useCallback(
    (
      p: ViewStatePatch<T> | ((current: T) => ViewStatePatch<T>),
      broadcast: boolean
    ) => {
      const patch = typeof p === "function" ? p(stateRef.current) : p;
      if (Object.keys(patch).length === 0) return;
      const next = deepMerge(stateRef.current, patch);
      stateRef.current = next;
      setState(next);
      if (!broadcast) return;
      // Strictly-monotonic so rapid local changes each get a distinct ts.
      tsRef.current = Math.max(Date.now(), tsRef.current + 1);
      const ch = channelRef.current;
      if (!ch) return;
      void ch.send({
        type: "broadcast",
        event: PATCH_EVENT,
        payload: {
          ts: tsRef.current,
          actorColor: selfColorRef.current,
          data: patch,
        } satisfies Envelope<T>,
      });
    },
    []
  );

  const update = useCallback(
    (p: ViewStatePatch<T> | ((current: T) => ViewStatePatch<T>)) =>
      apply(p, true),
    [apply]
  );
  const updateLocal = useCallback(
    (p: ViewStatePatch<T> | ((current: T) => ViewStatePatch<T>)) =>
      apply(p, false),
    [apply]
  );

  const { channel, subscribed } = useRealtimeChannel({
    name: channelName,
    broadcastEvents: EVENTS,
    onBroadcast: (event, payload) => {
      if (event === REQUEST_EVENT) {
        sendFull();
        return;
      }
      const env = payload as Envelope<T> | undefined;
      if (!env || typeof env.ts !== "number") return;
      if (event === PATCH_EVENT) {
        // Patches always merge — `ts` only advances the local clock.
        const prev = stateRef.current;
        const next = deepMerge(prev, env.data as ViewStatePatch<T>);
        stateRef.current = next;
        tsRef.current = Math.max(tsRef.current, env.ts);
        setState(next);
        onRemoteRef.current?.({
          prev,
          next,
          actorColor: env.actorColor ?? null,
          kind: "patch",
        });
      } else if (event === FULL_EVENT) {
        // Catch-up snapshot — adopt only if strictly newer, so an
        // established client isn't reset by another joiner's reply.
        if (env.ts <= tsRef.current) return;
        const prev = stateRef.current;
        const next = env.data as T;
        stateRef.current = next;
        tsRef.current = env.ts;
        setState(next);
        onRemoteRef.current?.({
          prev,
          next,
          actorColor: env.actorColor ?? null,
          kind: "snapshot",
        });
      }
    },
  });

  useEffect(() => {
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
    };
  }, [channel]);

  // On join, ask peers already here for the live snapshot.
  useEffect(() => {
    if (!channel || !subscribed) return;
    void channel.send({
      type: "broadcast",
      event: REQUEST_EVENT,
      payload: {},
    });
  }, [channel, subscribed]);

  return { state, update, updateLocal };
}
