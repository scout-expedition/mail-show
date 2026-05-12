"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  useRealtimeChannel,
  type PostgresChange,
  type PostgresSubscription,
} from "./channel";

export type PresenceFocus = {
  /** Postgres table name, e.g. "inspection_letters". */
  table: string;
  /** Row id the user is currently looking at / editing. */
  recordId: string;
  /** Column or logical field key, e.g. "content" or "sender_citizen_id". */
  field: string;
};

export type PresenceSelf = {
  userId: string;
  email: string;
  /** Currently-focused field, or null if the user isn't editing anything. */
  focus: PresenceFocus | null;
};

export type PresencePeer = PresenceSelf & {
  /** Deterministic hex color derived from userId — same across every client. */
  color: string;
};

export type UsePresenceOptions = {
  name: string;
  self: PresenceSelf;
  postgres?: PostgresSubscription[];
  broadcastEvents?: string[];
  onPostgres?: (change: PostgresChange) => void;
  onBroadcast?: (event: string, payload: unknown) => void;
};

const PALETTE = [
  "#f97316",
  "#ec4899",
  "#a855f7",
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#eab308",
  "#ef4444",
];

/** Deterministic color from userId — djb2-style xor hash mod palette length. */
export function colorFromUserId(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash) ^ userId.charCodeAt(i);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Identity payload published via `channel.track()` — stays stable per user. */
type PresenceIdentity = { userId: string; email: string };

export type RawPresenceEntry = Partial<PresenceIdentity> & {
  presence_ref?: string;
};
export type RawPresenceState = Record<string, RawPresenceEntry[]>;

/** Internal broadcast event name used for focus updates (and re-sync). */
const FOCUS_EVENT = "presence-focus";

type FocusBroadcastPayload = {
  userId: string;
  focus: PresenceFocus | null;
};

/**
 * Convert Supabase's `channel.presenceState()` shape into a typed identity
 * map (userId → { userId, email }), excluding the local user. Uses the LAST
 * entry per key — Phoenix Presence prepends stale metas on subsequent
 * track() calls (`@supabase/phoenix/presence.js` — `state[key].metas.unshift(...)`).
 *
 * Focus is NOT read here. Presence is reserved for stable identity
 * (join/leave); focus is delivered via the FOCUS_EVENT broadcast which has
 * no dedup/merge semantics and reliably propagates every update.
 */
export function parsePresenceIdentities(
  state: RawPresenceState,
  selfUserId: string
): Record<string, PresenceIdentity> {
  const out: Record<string, PresenceIdentity> = {};
  for (const [key, entries] of Object.entries(state)) {
    if (key === selfUserId) continue;
    const latest = entries[entries.length - 1];
    if (!latest?.userId || !latest?.email) continue;
    out[latest.userId] = { userId: latest.userId, email: latest.email };
  }
  return out;
}

/**
 * Subscribe to a Supabase Realtime channel with presence + focus broadcast.
 *
 * **Identity** is published once via `channel.track({ userId, email })`. The
 * full peer set comes from `presenceState()` (join/leave).
 *
 * **Focus** is published via broadcast on every change. Broadcasts have no
 * merging/dedup behavior — every send fires a unique event, so high-
 * frequency focus updates propagate reliably. Presence is unreliable for
 * this (Supabase/Phoenix may drop or coalesce repeat track payloads).
 *
 * Compose with `postgres` / `broadcastEvents` to share one channel for
 * identity + focus + row updates + custom broadcast.
 */
export function usePresence(opts: UsePresenceOptions): {
  peers: PresencePeer[];
  channel: RealtimeChannel | null;
} {
  const { name, self, postgres, broadcastEvents, onPostgres, onBroadcast } =
    opts;
  const [identities, setIdentities] = useState<Record<string, PresenceIdentity>>(
    {}
  );
  const [focusMap, setFocusMap] = useState<
    Record<string, PresenceFocus | null>
  >({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfUserIdRef = useRef(self.userId);
  selfUserIdRef.current = self.userId;
  const selfFocusRef = useRef(self.focus);
  selfFocusRef.current = self.focus;
  const onBroadcastRef = useRef(onBroadcast);
  onBroadcastRef.current = onBroadcast;

  // Merge user-supplied broadcast events with our internal focus event.
  // Stable serialized key so the channel doesn't re-subscribe on every render.
  const mergedEvents = useMemo(() => {
    const set = new Set<string>(broadcastEvents ?? []);
    set.add(FOCUS_EVENT);
    return Array.from(set);
  }, [broadcastEvents]);

  const { channel, subscribed } = useRealtimeChannel({
    name,
    presenceKey: self.userId,
    postgres,
    broadcastEvents: mergedEvents,
    onPostgres,
    onBroadcast: (event, payload) => {
      if (event === FOCUS_EVENT) {
        const p = payload as FocusBroadcastPayload | undefined;
        if (p?.userId && p.userId !== selfUserIdRef.current) {
          setFocusMap((m) => ({ ...m, [p.userId]: p.focus ?? null }));
        }
        return;
      }
      onBroadcastRef.current?.(event, payload);
    },
    onPresenceSync: () => {
      const ch = channelRef.current;
      if (!ch) return;
      const state = ch.presenceState() as RawPresenceState;
      const next = parsePresenceIdentities(state, selfUserIdRef.current);
      setIdentities(next);
      // Drop focus entries for peers that have left.
      setFocusMap((m) => {
        const filtered: Record<string, PresenceFocus | null> = {};
        for (const userId of Object.keys(next)) {
          if (userId in m) filtered[userId] = m[userId];
        }
        return filtered;
      });
      // Re-broadcast our own focus so freshly-joined peers can sync state
      // without waiting for the local user to refocus a field.
      if (selfFocusRef.current) {
        void ch.send({
          type: "broadcast",
          event: FOCUS_EVENT,
          payload: {
            userId: selfUserIdRef.current,
            focus: selfFocusRef.current,
          } satisfies FocusBroadcastPayload,
        });
      }
    },
  });

  // Track the live channel so onPresenceSync can read presenceState() and
  // .send() broadcasts.
  useEffect(() => {
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
    };
  }, [channel]);

  // Track stable identity once per subscribe — userId/email don't change
  // mid-session. Gated on SUBSCRIBED: track() before subscribe completes
  // can be silently dropped.
  useEffect(() => {
    if (!channel || !subscribed) return;
    void channel.track({ userId: self.userId, email: self.email });
  }, [channel, subscribed, self.userId, self.email]);

  // Broadcast focus whenever it changes. Serialize for dep stability.
  const focusKey = JSON.stringify(self.focus);
  useEffect(() => {
    if (!channel || !subscribed) return;
    const focus = JSON.parse(focusKey) as PresenceFocus | null;
    void channel.send({
      type: "broadcast",
      event: FOCUS_EVENT,
      payload: {
        userId: self.userId,
        focus,
      } satisfies FocusBroadcastPayload,
    });
  }, [channel, subscribed, focusKey, self.userId]);

  const peers = useMemo<PresencePeer[]>(() => {
    const list: PresencePeer[] = [];
    for (const [userId, identity] of Object.entries(identities)) {
      list.push({
        userId,
        email: identity.email,
        focus: focusMap[userId] ?? null,
        color: colorFromUserId(userId),
      });
    }
    list.sort((a, b) => a.userId.localeCompare(b.userId));
    return list;
  }, [identities, focusMap]);

  return { peers, channel };
}
