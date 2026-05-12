"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePresence, type PresenceFocus, type PresencePeer } from "./presence";

type PresenceContextValue = {
  /** The local user's currently-focused field, or null. */
  focus: PresenceFocus | null;
  /** Imperative setter — typically wired into useInstantField.onFocusChange. */
  setFocus: (focus: PresenceFocus | null) => void;
  /** Other users on this channel (excludes self). */
  peers: PresencePeer[];
};

const PresenceContext = createContext<PresenceContextValue>({
  focus: null,
  setFocus: () => {},
  peers: [],
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
 */
export function WorkspacePresenceProvider({
  channelName,
  userId,
  email,
  children,
}: {
  channelName: string;
  userId?: string;
  email?: string;
  children: ReactNode;
}) {
  if (userId && email) {
    return (
      <ActivePresenceProvider
        channelName={channelName}
        userId={userId}
        email={email}
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
  children,
}: {
  channelName: string;
  userId: string;
  email: string;
  children: ReactNode;
}) {
  const [focus, setFocus] = useState<PresenceFocus | null>(null);
  const { peers } = usePresence({
    name: channelName,
    self: { userId, email, focus },
  });
  return (
    <PresenceContext.Provider value={{ focus, setFocus, peers }}>
      {children}
    </PresenceContext.Provider>
  );
}

function InactivePresenceProvider({ children }: { children: ReactNode }) {
  // Track focus locally even without realtime so consumers' onFocusChange
  // wiring works identically — broadcast is just inert.
  const [focus, setFocus] = useState<PresenceFocus | null>(null);
  return (
    <PresenceContext.Provider value={{ focus, setFocus, peers: [] }}>
      {children}
    </PresenceContext.Provider>
  );
}
