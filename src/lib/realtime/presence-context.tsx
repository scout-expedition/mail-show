"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PostgresChange, PostgresSubscription } from "./channel";
import {
  colorFromUserId,
  usePresence,
  type PresenceFocus,
  type PresencePeer,
  type PresenceProfile,
  type PresenceSelection,
} from "./presence";

type PostgresHandler = (change: PostgresChange) => void;
type BroadcastHandler = (payload: unknown) => void;

/** Custom broadcast events all presence providers subscribe to. */
const CUSTOM_BROADCAST_EVENTS = ["row-deleting"];

type PresenceContextValue = {
  /** The local user's currently-focused field, or null. */
  focus: PresenceFocus | null;
  /** Imperative setter — typically wired into useInstantField.onFocusChange. */
  setFocus: (focus: PresenceFocus | null) => void;
  /** The local user's open-panel chain, or null pre-selection. */
  selection: PresenceSelection | null;
  /** Imperative setter — typically wired into the surface's selection effect. */
  setSelection: (selection: PresenceSelection | null) => void;
  /** Other users on this channel (excludes self). */
  peers: PresencePeer[];
  /**
   * Avatar color for the local user, derived deterministically from their
   * `userId` via `colorFromUserId`. Same hash used for peer colors so the
   * user's self-ring matches what peers see in the avatar stack. `null`
   * when presence is inactive.
   */
  selfColor: string | null;
  /**
   * The local user shaped as a `PresencePeer` so AvatarStack can render
   * "you" alongside everyone else. `null` when presence is inactive (no
   * userId/email). `lastActiveAt` is always now — by definition you're
   * the one driving this render.
   */
  selfPeer: PresencePeer | null;
  /**
   * Broadcast a lightweight activity heartbeat. Throttled callers (e.g.
   * useInstantField while typing) keep peers marked active without re-firing
   * focus/selection. No-op when presence is inactive.
   */
  pingActivity: () => void;
  /**
   * Register a postgres_changes handler on the surface's shared channel.
   * Returns an unregister fn. Multiple handlers stack and are invoked in
   * registration order. No-op when presence is inactive (no userId/email).
   */
  onPostgresChanges: (handler: PostgresHandler) => () => void;
  /**
   * Send a broadcast event on the shared channel. No-op when presence is
   * inactive or the channel hasn't subscribed yet.
   */
  sendBroadcast: (event: string, payload: unknown) => void;
  /**
   * Subscribe to a custom broadcast event on the shared channel. Returns an
   * unregister fn. No-op (never fires) when presence is inactive.
   */
  subscribeBroadcast: (event: string, handler: BroadcastHandler) => () => void;
};

const PresenceContext = createContext<PresenceContextValue>({
  focus: null,
  setFocus: () => {},
  selection: null,
  setSelection: () => {},
  peers: [],
  selfColor: null,
  selfPeer: null,
  pingActivity: () => {},
  onPostgresChanges: () => () => {},
  sendBroadcast: () => {},
  subscribeBroadcast: () => () => {},
});

/** Read the current presence + focus context. Safe to call without a Provider —
 *  returns empty peers and a no-op setFocus, so components don't need to know
 *  whether realtime is wired. */
export function usePresenceContext(): PresenceContextValue {
  return useContext(PresenceContext);
}

/**
 * Wraps a surface (e.g. LettersWorkspace) in shared presence + field-focus
 * state. When `userId` and `email` are both provided, opens a Supabase
 * Realtime channel named `channelName` and exposes peers via context.
 * When either is missing, falls back to a no-op provider so the surface
 * still renders without realtime (used by graph embed before Track D).
 *
 * Pass `postgresTables` to also subscribe to row-level INSERT/UPDATE/DELETE
 * events on those tables. Consumers register handlers with
 * `onPostgresChanges` from context.
 */
export function WorkspacePresenceProvider({
  channelName,
  userId,
  email,
  profile,
  postgresTables,
  children,
}: {
  channelName: string;
  userId?: string;
  email?: string;
  /** Optional user-customized display name / avatar / color. When provided,
   *  the local user broadcasts these to peers; consumers fall back to email
   *  + `colorFromUserId` for any missing fields. */
  profile?: PresenceProfile | null;
  postgresTables?: string[];
  children: ReactNode;
}) {
  if (userId && email) {
    return (
      <ActivePresenceProvider
        channelName={channelName}
        userId={userId}
        email={email}
        profile={profile ?? null}
        postgresTables={postgresTables}
      >
        {children}
      </ActivePresenceProvider>
    );
  }
  return <InactivePresenceProvider>{children}</InactivePresenceProvider>;
}

function ActivePresenceProvider({
  channelName,
  userId,
  email,
  profile,
  postgresTables,
  children,
}: {
  channelName: string;
  userId: string;
  email: string;
  profile: PresenceProfile | null;
  postgresTables?: string[];
  children: ReactNode;
}) {
  const [focus, setFocus] = useState<PresenceFocus | null>(null);
  const [selection, setSelection] = useState<PresenceSelection | null>(null);

  // Handlers are kept in a ref so registering/unregistering doesn't cause a
  // channel re-subscribe. Iteration order matches insertion order (Set guarantee).
  const handlersRef = useRef<Set<PostgresHandler>>(new Set());
  const onPostgresChanges = useCallback((handler: PostgresHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // Custom broadcast handler registry — same ref-based pattern as postgres handlers.
  const broadcastHandlersRef = useRef(
    new Map<string, Set<BroadcastHandler>>()
  );
  const subscribeBroadcast = useCallback(
    (event: string, handler: BroadcastHandler) => {
      if (!broadcastHandlersRef.current.has(event)) {
        broadcastHandlersRef.current.set(event, new Set());
      }
      broadcastHandlersRef.current.get(event)!.add(handler);
      return () => {
        broadcastHandlersRef.current.get(event)?.delete(handler);
      };
    },
    []
  );
  const onBroadcast = useCallback((event: string, payload: unknown) => {
    broadcastHandlersRef.current.get(event)?.forEach((h) => h(payload));
  }, []);

  // Stable identity for the postgres subscription array — `useRealtimeChannel`
  // re-subscribes when the serialized shape changes, so we memo by table list.
  const tablesKey = (postgresTables ?? []).join(",");
  const postgres = useMemo<PostgresSubscription[]>(
    () => (postgresTables ?? []).map((table) => ({ table })),
    // tablesKey captures the contents — postgresTables identity may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablesKey]
  );

  const onPostgres = useCallback((change: PostgresChange) => {
    for (const handler of handlersRef.current) {
      handler(change);
    }
  }, []);

  const { peers, channel, pingActivity } = usePresence({
    name: channelName,
    self: { userId, email, profile, focus, selection },
    postgres,
    onPostgres,
    broadcastEvents: CUSTOM_BROADCAST_EVENTS,
    onBroadcast,
  });

  const sendBroadcast = useCallback(
    (event: string, payload: unknown) => {
      void channel?.send({ type: "broadcast", event, payload });
    },
    [channel]
  );

  // Self color prefers the user's customized `avatarColorHex` (set in
  // /settings) and falls back to the deterministic hash. Peers see the
  // same value via the tracked identity payload, so the avatar stack and
  // FieldHighlight self-ring all read the same color.
  const selfColor = useMemo(
    () => profile?.avatarColorHex ?? colorFromUserId(userId),
    [profile?.avatarColorHex, userId]
  );

  const selfPeer = useMemo<PresencePeer>(
    () => ({
      userId,
      email,
      profile,
      color: selfColor,
      focus,
      selection,
      lastActiveAt: Date.now(),
    }),
    [userId, email, profile, selfColor, focus, selection]
  );

  const value = useMemo<PresenceContextValue>(
    () => ({
      focus,
      setFocus,
      selection,
      setSelection,
      peers,
      selfColor,
      selfPeer,
      pingActivity,
      onPostgresChanges,
      sendBroadcast,
      subscribeBroadcast,
    }),
    [
      focus,
      selection,
      peers,
      selfColor,
      selfPeer,
      pingActivity,
      onPostgresChanges,
      sendBroadcast,
      subscribeBroadcast,
    ]
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

function InactivePresenceProvider({ children }: { children: ReactNode }) {
  // Track focus + selection locally even without realtime so consumers'
  // onFocusChange / setSelection wiring works identically — broadcast is
  // just inert.
  const [focus, setFocus] = useState<PresenceFocus | null>(null);
  const [selection, setSelection] = useState<PresenceSelection | null>(null);
  const onPostgresChanges = useCallback(() => () => {}, []);
  const pingActivity = useCallback(() => {}, []);
  const sendBroadcast = useCallback(() => {}, []);
  const subscribeBroadcast = useCallback(() => () => {}, []);
  const value = useMemo<PresenceContextValue>(
    () => ({
      focus,
      setFocus,
      selection,
      setSelection,
      peers: [],
      selfColor: null,
      selfPeer: null,
      pingActivity,
      onPostgresChanges,
      sendBroadcast,
      subscribeBroadcast,
    }),
    [focus, selection, pingActivity, onPostgresChanges, sendBroadcast, subscribeBroadcast]
  );
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}
