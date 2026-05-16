"use client";

// Live "shared view state" sync over a dedicated per-record Supabase
// Realtime broadcast channel. Keeps an ephemeral, non-persisted view (a
// preview toggle + simulation picks) identical for every collaborator
// looking at the same record.
//
// Wire protocol — broadcast events on `channelName`:
//   view-patch    {ts, actorColor, data: Partial<T>}  a peer changed fields
//   view-full     {ts, actorColor, data: T}           full-snapshot reply
//   view-request  {}                                  "I just joined"
//
// Patches MERGE shallowly (per top-level key) so two peers editing
// different controls never clobber each other — the concern with naive
// whole-state last-write-wins. `ts` is a strictly-monotonic stamp used to
// order full-snapshot replies: a fresh joiner (ts 0) adopts the live
// snapshot, while an established client ignores another joiner's reply.
//
// The authoritative local snapshot lives in `stateRef`, updated
// synchronously on every local broadcast and applied remote message, so
// outbound payloads never read (possibly stale) React state.

import { useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRealtimeChannel } from "./channel";
import { usePresenceContext } from "./presence-context";

const PATCH_EVENT = "view-patch";
const FULL_EVENT = "view-full";
const REQUEST_EVENT = "view-request";
const EVENTS = [PATCH_EVENT, FULL_EVENT, REQUEST_EVENT];

type Envelope<T> = {
  ts: number;
  actorColor: string | null;
  data: T | Partial<T>;
};

export type SharedViewStateRemote<T> = {
  /** State immediately before the remote change — diff against `next`. */
  prev: T;
  /** Full state after applying the incoming patch / snapshot. */
  next: T;
  /** Avatar color of the peer who made the change, when known. */
  actorColor: string | null;
  /** "patch" — a peer changed something live. "snapshot" — a catch-up
   *  reply received on join. Consumers typically only flash on "patch" so
   *  a fresh joiner doesn't flash every already-set control. */
  kind: "patch" | "snapshot";
};

export function useSharedViewState<T extends object>(opts: {
  /** Stable, per-record channel name, e.g. `endings-view:<documentId>`. */
  channelName: string;
  /** Local starting snapshot. Read once on mount (later prop changes are
   *  ignored — pass a stable seed). */
  initialState: T;
  /** Called for every remote change that advances state. Apply `next` to
   *  local React state here, and diff `prev`/`next` to drive flashes. */
  onRemote: (change: SharedViewStateRemote<T>) => void;
}): {
  /** Apply a local change — pass only the fields that changed. Merges into
   *  the shared snapshot and broadcasts the patch to peers. */
  broadcast: (patch: Partial<T>) => void;
} {
  const { channelName, initialState, onRemote } = opts;
  const { selfColor } = usePresenceContext();

  const stateRef = useRef<T>(initialState);
  const tsRef = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Latest onRemote / color kept in refs so the channel callbacks and
  // `broadcast` stay referentially stable across renders.
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

  const broadcast = useCallback((patch: Partial<T>) => {
    stateRef.current = { ...stateRef.current, ...patch };
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
  }, []);

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
        const next = { ...prev, ...(env.data as Partial<T>) };
        stateRef.current = next;
        tsRef.current = Math.max(tsRef.current, env.ts);
        onRemoteRef.current({
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
        onRemoteRef.current({
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

  return { broadcast };
}
