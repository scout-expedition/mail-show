"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type PostgresChange = RealtimePostgresChangesPayload<
  Record<string, unknown>
>;

export type PostgresSubscription = {
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  schema?: string;
  table: string;
  filter?: string;
};

/** Raw presence "leave" payload from Supabase's realtime client.
 *  `leftPresences` carries the entries removed in this event; `key` is the
 *  presence key (typically the user id). Fires BEFORE the next `sync`, so
 *  consumers can still see the leaving peer's state in `presenceState()`. */
export type PresenceLeavePayload = {
  key: string;
  currentPresences: Record<string, unknown>[];
  leftPresences: Record<string, unknown>[];
};

export type RealtimeChannelOptions = {
  /** Stable channel name. One per top-level surface, e.g. "letters-workspace". */
  name: string;
  /** Per-user presence key (typically the user's id). Omit to disable presence. */
  presenceKey?: string;
  /** postgres_changes subscriptions. */
  postgres?: PostgresSubscription[];
  /** Broadcast event names to listen for. */
  broadcastEvents?: string[];
  onPostgres?: (change: PostgresChange) => void;
  onBroadcast?: (event: string, payload: unknown) => void;
  onPresenceSync?: () => void;
  /** Fires when a peer (including the local user, e.g. on tab close) leaves
   *  the channel. The post-sync membership won't reflect the leave yet, so
   *  consumers needing "I am the last remaining peer" should compare the
   *  current peers array length against the leaving peer. */
  onPresenceLeave?: (payload: PresenceLeavePayload) => void;
};

/**
 * Subscribe to a Supabase Realtime channel for the lifetime of the calling
 * component. Channel is created on mount, removed on unmount. Returns the
 * live `RealtimeChannel` so callers can `.send()` broadcasts or `.track()`
 * presence state — `null` for one render before subscribe resolves.
 *
 * Callback refs let consumers pass fresh closures each render without
 * re-subscribing — only `name`, `presenceKey`, and the (serialized)
 * subscription shapes drive re-subscription.
 */
export function useRealtimeChannel(opts: RealtimeChannelOptions): {
  channel: RealtimeChannel | null;
  /** True once the channel reaches SUBSCRIBED. Gate `channel.track()` on this:
   *  Supabase's realtime client silently drops `track()` calls made before
   *  the channel finishes joining (the initial-track queue only holds one). */
  subscribed: boolean;
} {
  const { name, presenceKey, postgres, broadcastEvents } = opts;

  const onPostgresRef = useLatest(opts.onPostgres);
  const onBroadcastRef = useLatest(opts.onBroadcast);
  const onPresenceSyncRef = useLatest(opts.onPresenceSync);
  const onPresenceLeaveRef = useLatest(opts.onPresenceLeave);

  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  // Serialize array shapes so a fresh-reference array on each render does not
  // re-subscribe.
  const postgresKey = JSON.stringify(postgres ?? []);
  const broadcastKey = JSON.stringify(broadcastEvents ?? []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const ch = presenceKey
      ? supabase.channel(name, { config: { presence: { key: presenceKey } } })
      : supabase.channel(name);
    const debug =
      typeof window !== "undefined" &&
      window.localStorage?.getItem("debug_presence") === "1";

    const subs = JSON.parse(postgresKey) as PostgresSubscription[];
    for (const sub of subs) {
      ch.on(
        // The `postgres_changes` overload is tagged with a literal; the cast
        // below keeps TS happy without enumerating every event-type variant.
        "postgres_changes" as never,
        {
          event: sub.event ?? "*",
          schema: sub.schema ?? "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        } as never,
        ((payload: PostgresChange) => {
          if (debug) {
            console.warn("[channel]", name, "postgres", payload.eventType, payload.table);
          }
          onPostgresRef.current?.(payload);
        }) as never
      );
    }

    const events = JSON.parse(broadcastKey) as string[];
    for (const ev of events) {
      ch.on("broadcast", { event: ev }, (msg) => {
        // Supabase types `msg` as { type, event, meta?, [k]: any } — the
        // `payload` field sent via channel.send() lands under `msg.payload`
        // at runtime but is not in the static type.
        const payload = (msg as Record<string, unknown>).payload;
        onBroadcastRef.current?.(ev, payload);
      });
    }

    if (presenceKey) {
      ch.on("presence", { event: "sync" }, () => {
        onPresenceSyncRef.current?.();
      });
      ch.on("presence", { event: "leave" }, (raw) => {
        onPresenceLeaveRef.current?.(raw as PresenceLeavePayload);
      });
    }

    // Channel handle exposed to consumers — the effect IS the external-system subscription this hook is built around.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChannel(ch);

    // Postgres_changes subscriptions are RLS-gated server-side, so the
    // channel needs the user's JWT attached before `subscribe()` sends the
    // phx_join. The realtime client picks up the access token from
    // `realtime.setAuth(...)`. We await `getSession()` and explicitly
    // setAuth before subscribing — without this, broadcasts join the
    // channel fine but postgres_changes are silently denied (the user-
    // visible signature is "focus rings work, content updates don't
    // propagate until refresh").
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) {
        supabase.realtime.setAuth(token);
      }
      if (debug) {
        console.warn(
          "[channel]",
          name,
          "subscribing with auth=",
          !!token
        );
      }
      ch.subscribe((status, err) => {
        if (debug) {
          console.warn("[channel]", name, "subscribe status", status, err);
        }
        setSubscribed(status === "SUBSCRIBED");
      });
    });

    return () => {
      cancelled = true;
      setSubscribed(false);
      void supabase.removeChannel(ch);
      setChannel(null);
    };
  // Refs from useLatest are stable across renders; including them is a no-op but satisfies exhaustive-deps.
  }, [name, presenceKey, postgresKey, broadcastKey, onBroadcastRef, onPostgresRef, onPresenceSyncRef, onPresenceLeaveRef]);

  return { channel, subscribed };
}

/**
 * Returns a ref that always points at the latest `value`. The assignment
 * runs in `useLayoutEffect`, not `useEffect`, so the ref is updated
 * synchronously during the commit phase — before any external event
 * (e.g. an incoming realtime broadcast) can run. With plain `useEffect`,
 * a broadcast arriving between commit and effect-flush would read the
 * stale ref on a rerender that changed `value`; `useLayoutEffect` closes
 * that window without forcing the consumer to resubscribe.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
