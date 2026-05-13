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
  type PresenceSelection,
} from "./presence";

type PostgresHandler = (change: PostgresChange) => void;

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
};

const PresenceContext = createContext<PresenceContextValue>({
  focus: null,
  setFocus: () => {},
  selection: null,
  setSelection: () => {},
  peers: [],
  selfColor: null,
  pingActivity: () => {},
  onPostgresChanges: () => () => {},
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
  postgresTables,
  children,
}: {
  channelName: string;
  userId?: string;
  email?: string;
  postgresTables?: string[];
  children: ReactNode;
}) {
  if (userId && email) {
    return (
      <ActivePresenceProvider
        channelName={channelName}
        userId={userId}
        email={email}
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
  postgresTables,
  children,
}: {
  channelName: string;
  userId: string;
  email: string;
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

  const { peers, pingActivity } = usePresence({
    name: channelName,
    self: { userId, email, focus, selection },
    postgres,
    onPostgres,
  });

  const selfColor = useMemo(() => colorFromUserId(userId), [userId]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      focus,
      setFocus,
      selection,
      setSelection,
      peers,
      selfColor,
      pingActivity,
      onPostgresChanges,
    }),
    [focus, selection, peers, selfColor, pingActivity, onPostgresChanges]
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
  const value = useMemo<PresenceContextValue>(
    () => ({
      focus,
      setFocus,
      selection,
      setSelection,
      peers: [],
      selfColor: null,
      pingActivity,
      onPostgresChanges,
    }),
    [focus, selection, pingActivity, onPostgresChanges]
  );
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}
