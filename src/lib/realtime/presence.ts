"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { IconType } from "@/lib/db/enums";
import {
  useRealtimeChannel,
  type PostgresChange,
  type PostgresSubscription,
} from "./channel";

/**
 * Optional user-profile fields broadcast alongside identity. Mirrors the
 * `UserAvatarData` shape from `src/components/user-avatar.tsx` (which reads
 * from `auth.users.user_metadata`) so consumers can plug the peer object
 * straight into `<UserAvatar>`. All fields are nullable — peers who haven't
 * set a display name / avatar fall back to email + `colorFromUserId`.
 */
export type PresenceProfile = {
  displayName: string | null;
  avatarIconType: IconType | null;
  avatarIconValue: string | null;
  avatarColorHex: string | null;
};

export type PresenceFocus = {
  /** Postgres table name, e.g. "inspection_letters". */
  table: string;
  /** Row id the user is currently looking at / editing. */
  recordId: string;
  /** Column or logical field key, e.g. "content" or "sender_citizen_id". */
  field: string;
};

/**
 * The peer's open-panel chain. `view` records which slot of the surface is
 * "deepest" so consumers can render a location label without re-deriving it
 * from the id presence. All ids default to null when the peer hasn't drilled
 * that far yet.
 *
 * `narrow` reflects the peer's viewport mode at the moment they broadcast.
 * In narrow mode the workspace shows ONE panel; in wide mode it shows two
 * adjacent panels. `sharesPanel` uses this to compute visible-slot overlap
 * accurately — a wide peer on view=group can see slot 1 (storyline) and a
 * narrow peer on view=list shares slot 1, so they're co-located. A wide
 * peer on view=segment sees slots 4–5, which doesn't overlap with another
 * peer on view=group (slot 2). Defaults to false (assume wide) for older
 * clients that don't publish it.
 */
export type PresenceSelection = {
  storylineId: string | null;
  groupId: string | null;
  letterId: string | null;
  segmentId: string | null;
  /**
   * The specific action selected on the actions panel, when the peer has
   * one chip selected (the graph surface selects an individual action when
   * an action chip is clicked). Null when the peer is on the actions panel
   * without a chip-scoped selection, or on any other panel. Lets the graph
   * ring the exact action chip instead of falling back to the parent letter.
   */
  actionId?: string | null;
  view: string;
  narrow?: boolean;
  /**
   * Surface-specific extra context. Carried as a flat string map so the
   * shared PresenceSelection type doesn't grow a new top-level field per
   * surface. Endings uses keys like `endingFrameworkId`, `endingTabId`,
   * `endingDocumentId`; consumers tolerate missing keys.
   */
  payload?: Record<string, string | null>;
};

/**
 * True when a peer's `focus` (the field they're editing) is consistent with
 * the panel `view` in their selection chain.
 *
 * Focus can go stale: an input stays DOM-focused after the peer navigates to
 * another panel via a non-focusable control (a plain clickable div fires no
 * blur), so `focus.table` keeps pointing at the field they left. Location
 * labels should fall back to the selection chain when focus contradicts the
 * panel the peer is actually on — otherwise the label lags one navigation
 * behind (e.g. "Actions" while the peer is already viewing a report).
 *
 * Returns true when there's no selection to validate against (focus is then
 * the only signal available).
 */
export function focusMatchesView(
  focus: PresenceFocus | null,
  selection: PresenceSelection | null
): boolean {
  if (!focus) return false;
  if (!selection) return true;
  switch (focus.table) {
    case "actions":
      return selection.view === "actions";
    case "report_segments":
      return selection.view === "segment" || selection.view === "main";
    case "inspection_letters":
      return selection.view === "main";
    case "letter_groups":
      return selection.view === "group" || selection.view === "list";
    case "storylines":
      return selection.view === "list";
    default:
      return true;
  }
}

export type PresenceSelf = {
  userId: string;
  email: string;
  /** Currently-focused field, or null if the user isn't editing anything. */
  focus: PresenceFocus | null;
  /** Open-panel chain. Null until the peer makes any selection. */
  selection: PresenceSelection | null;
  /** User-customized display name / avatar / color from `user_metadata`.
   *  Null when the user hasn't set anything — consumers fall back to email
   *  + `colorFromUserId`. */
  profile?: PresenceProfile | null;
};

export type PresencePeer = PresenceSelf & {
  /** Deterministic hex color derived from userId — used as the fallback when
   *  the peer hasn't picked an `avatarColorHex`. Consumers should prefer
   *  `profile.avatarColorHex ?? color`. */
  color: string;
  /**
   * Last time we heard ANY broadcast from this peer (focus, selection,
   * activity heartbeat) — milliseconds, bucketed to 5s to bound state churn
   * during sustained typing. Consumers compare against `Date.now()` to gate
   * "inactive" UI.
   */
  lastActiveAt: number;
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

/** Identity payload published via `channel.track()` — stays stable per user.
 *  Profile is bundled here (not a separate broadcast) because it's stable
 *  per-session like userId/email, so the once-per-subscribe `track()` is the
 *  right vehicle. Older clients that don't publish profile still parse cleanly
 *  via the Partial wrapper below. */
type PresenceIdentity = {
  userId: string;
  email: string;
  profile?: PresenceProfile | null;
};

export type RawPresenceEntry = Partial<PresenceIdentity> & {
  presence_ref?: string;
};
export type RawPresenceState = Record<string, RawPresenceEntry[]>;

/** Internal broadcast event names. */
const FOCUS_EVENT = "presence-focus";
const SELECTION_EVENT = "presence-selection";
const ACTIVITY_EVENT = "presence-activity";

type FocusBroadcastPayload = {
  userId: string;
  focus: PresenceFocus | null;
};

type SelectionBroadcastPayload = {
  userId: string;
  selection: PresenceSelection | null;
};

type ActivityBroadcastPayload = { userId: string };

/** Bucket ms to 5s so sustained-typing pings don't churn peers state at 1Hz. */
function activityBucket(now: number = Date.now()): number {
  return Math.floor(now / 5000) * 5000;
}

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
    out[latest.userId] = {
      userId: latest.userId,
      email: latest.email,
      profile: latest.profile ?? null,
    };
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
  /** Broadcast a lightweight activity heartbeat so sustained-typing peers stay
   *  marked active without re-firing focus/selection. Called by useInstantField
   *  while status is dirty. No-op until the channel is subscribed. */
  pingActivity: () => void;
} {
  const { name, self, postgres, broadcastEvents, onPostgres, onBroadcast } =
    opts;
  const [identities, setIdentities] = useState<Record<string, PresenceIdentity>>(
    {}
  );
  const [focusMap, setFocusMap] = useState<
    Record<string, PresenceFocus | null>
  >({});
  const [selectionMap, setSelectionMap] = useState<
    Record<string, PresenceSelection | null>
  >({});
  const [lastActiveAtMap, setLastActiveAtMap] = useState<
    Record<string, number>
  >({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfUserIdRef = useRef(self.userId);
  selfUserIdRef.current = self.userId;
  const selfFocusRef = useRef(self.focus);
  selfFocusRef.current = self.focus;
  // selfSelectionRef tracks the latest selection so onPresenceSync can
  // re-broadcast it for newly-joined peers. Assigned via effect (not during
  // render) per the react-hooks/refs rule; onPresenceSync runs async via
  // the realtime channel callback so the effect-settled value is fine.
  const selfSelectionRef = useRef(self.selection);
  useEffect(() => {
    selfSelectionRef.current = self.selection;
  }, [self.selection]);
  const onBroadcastRef = useRef(onBroadcast);
  onBroadcastRef.current = onBroadcast;

  // Bump a peer's lastActiveAt to the current 5-second bucket. Bucketing
  // bounds state churn during sustained-typing (1Hz heartbeats collapse to
  // one re-render per peer per 5s).
  const bumpActivity = useCallback((userId: string) => {
    const bucket = activityBucket();
    setLastActiveAtMap((m) => {
      if (m[userId] === bucket) return m;
      return { ...m, [userId]: bucket };
    });
  }, []);

  // Merge user-supplied broadcast events with our internal events.
  // Stable serialized key so the channel doesn't re-subscribe on every render.
  const mergedEvents = useMemo(() => {
    const set = new Set<string>(broadcastEvents ?? []);
    set.add(FOCUS_EVENT);
    set.add(SELECTION_EVENT);
    set.add(ACTIVITY_EVENT);
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
          bumpActivity(p.userId);
        }
        return;
      }
      if (event === SELECTION_EVENT) {
        const p = payload as SelectionBroadcastPayload | undefined;
        if (p?.userId && p.userId !== selfUserIdRef.current) {
          setSelectionMap((m) => ({ ...m, [p.userId]: p.selection ?? null }));
          bumpActivity(p.userId);
        }
        return;
      }
      if (event === ACTIVITY_EVENT) {
        const p = payload as ActivityBroadcastPayload | undefined;
        if (p?.userId && p.userId !== selfUserIdRef.current) {
          bumpActivity(p.userId);
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
      // Drop focus / selection / activity entries for peers that have left.
      setFocusMap((m) => {
        const filtered: Record<string, PresenceFocus | null> = {};
        for (const userId of Object.keys(next)) {
          if (userId in m) filtered[userId] = m[userId];
        }
        return filtered;
      });
      setSelectionMap((m) => {
        const filtered: Record<string, PresenceSelection | null> = {};
        for (const userId of Object.keys(next)) {
          if (userId in m) filtered[userId] = m[userId];
        }
        return filtered;
      });
      // Seed lastActiveAt for newly-joined peers (treat presence as activity)
      // and drop entries for peers that have left. Avoid recomputing identity
      // when the membership set hasn't actually changed so 1Hz heartbeats
      // arriving alongside no-op syncs don't churn this map.
      setLastActiveAtMap((m) => {
        const bucket = activityBucket();
        const out: Record<string, number> = {};
        let changed = false;
        for (const userId of Object.keys(next)) {
          if (userId in m) {
            out[userId] = m[userId];
          } else {
            out[userId] = bucket;
            changed = true;
          }
        }
        if (!changed && Object.keys(m).length === Object.keys(out).length) {
          return m;
        }
        return out;
      });
      // Re-broadcast our own focus + selection so freshly-joined peers can
      // sync state without waiting for the local user to refocus a field or
      // change panels.
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
      if (selfSelectionRef.current) {
        void ch.send({
          type: "broadcast",
          event: SELECTION_EVENT,
          payload: {
            userId: selfUserIdRef.current,
            selection: selfSelectionRef.current,
          } satisfies SelectionBroadcastPayload,
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

  // Track stable identity once per subscribe — userId/email/profile don't
  // change mid-session at the data-flow level. Gated on SUBSCRIBED:
  // track() before subscribe completes can be silently dropped. Profile is
  // JSON-stringified into the dep array so an object identity churn from a
  // re-render doesn't re-track on every parent update.
  const profileKey = JSON.stringify(self.profile ?? null);
  useEffect(() => {
    if (!channel || !subscribed) return;
    const profile = JSON.parse(profileKey) as PresenceProfile | null;
    void channel.track({
      userId: self.userId,
      email: self.email,
      profile,
    });
  }, [channel, subscribed, self.userId, self.email, profileKey]);

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

  // Broadcast selection whenever it changes. Same serialize-for-dep pattern.
  const selectionKey = JSON.stringify(self.selection);
  useEffect(() => {
    if (!channel || !subscribed) return;
    const selection = JSON.parse(selectionKey) as PresenceSelection | null;
    void channel.send({
      type: "broadcast",
      event: SELECTION_EVENT,
      payload: {
        userId: self.userId,
        selection,
      } satisfies SelectionBroadcastPayload,
    });
  }, [channel, subscribed, selectionKey, self.userId]);

  const pingActivity = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: "broadcast",
      event: ACTIVITY_EVENT,
      payload: {
        userId: selfUserIdRef.current,
      } satisfies ActivityBroadcastPayload,
    });
  }, []);

  const peers = useMemo<PresencePeer[]>(() => {
    const list: PresencePeer[] = [];
    for (const [userId, identity] of Object.entries(identities)) {
      list.push({
        userId,
        email: identity.email,
        profile: identity.profile ?? null,
        focus: focusMap[userId] ?? null,
        selection: selectionMap[userId] ?? null,
        lastActiveAt: lastActiveAtMap[userId] ?? 0,
        color: colorFromUserId(userId),
      });
    }
    list.sort((a, b) => a.userId.localeCompare(b.userId));
    return list;
  }, [identities, focusMap, selectionMap, lastActiveAtMap]);

  return { peers, channel, pingActivity };
}
