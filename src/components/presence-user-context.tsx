"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PresenceProfile } from "@/lib/realtime/presence";

export type PresenceUser = {
  userId: string;
  email: string;
  profile: PresenceProfile;
};

const PresenceUserContext = createContext<PresenceUser | null>(null);

/**
 * Wraps the authed app in the current user's presence payload (userId,
 * email, profile). Populated server-side by `AppShell` so client components
 * downstream (AppPresence, workspace stacks) can read identity without
 * threading props through every level — and without making PageHeader an
 * async server component (which would break Client Components that import
 * it, like graph-surface.tsx).
 */
export function PresenceUserProvider({
  value,
  children,
}: {
  value: PresenceUser | null;
  children: ReactNode;
}) {
  // Memoize on the primitive fields so re-renders of AppShell with the same
  // payload don't churn descendants' context identity.
  const profileKey = value
    ? `${value.profile.displayName ?? ""}|${value.profile.avatarIconType ?? ""}|${value.profile.avatarIconValue ?? ""}|${value.profile.avatarColorHex ?? ""}`
    : "";
  const memoed = useMemo(
    () => value,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value?.userId, value?.email, profileKey]
  );
  return (
    <PresenceUserContext.Provider value={memoed}>
      {children}
    </PresenceUserContext.Provider>
  );
}

/** Read the local user's presence payload. Returns `null` outside the
 *  provider or for un-authed sessions. */
export function usePresenceUser(): PresenceUser | null {
  return useContext(PresenceUserContext);
}
