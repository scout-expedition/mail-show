"use client";

import { useEffect, useRef, useState } from "react";
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
    }

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
  }, [name, presenceKey, postgresKey, broadcastKey]);

  return { channel, subscribed };
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
