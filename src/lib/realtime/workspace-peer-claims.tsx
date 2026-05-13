"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type WorkspacePeerClaimsValue = {
  /** Peer userIds currently shown in a per-surface AvatarStack. AppPresence
   *  (othersOnly) excludes these to avoid duplicating the same peer across
   *  two stacks — handles the multi-tab / mid-navigation race where a peer
   *  is still subscribed to a per-surface channel while their app-presence
   *  surface already points elsewhere. */
  claimed: Set<string>;
  publishClaim: (ids: string[]) => void;
};

const WorkspacePeerClaimsContext = createContext<WorkspacePeerClaimsValue>({
  claimed: new Set(),
  publishClaim: () => {},
});

export function WorkspacePeerClaimsProvider({ children }: { children: ReactNode }) {
  const [claimed, setClaimed] = useState<Set<string>>(() => new Set());

  const publishClaim = useCallback((ids: string[]) => {
    setClaimed((prev) => {
      if (
        prev.size === ids.length &&
        ids.every((id) => prev.has(id))
      ) {
        return prev;
      }
      return new Set(ids);
    });
  }, []);

  const value = useMemo<WorkspacePeerClaimsValue>(
    () => ({ claimed, publishClaim }),
    [claimed, publishClaim]
  );

  return (
    <WorkspacePeerClaimsContext.Provider value={value}>
      {children}
    </WorkspacePeerClaimsContext.Provider>
  );
}

/**
 * Workspace-side hook: publishes the per-surface peer userIds while the
 * stack is mounted, clears on unmount. Pass `peers.map(p => p.userId)`.
 * Identity-stabilized via a serialized key so calling on every render with
 * a fresh array doesn't churn context state.
 */
export function useClaimWorkspacePeers(peerIds: string[]) {
  const { publishClaim } = useContext(WorkspacePeerClaimsContext);
  const key = peerIds.join(",");
  useEffect(() => {
    publishClaim(key ? key.split(",") : []);
    return () => publishClaim([]);
  }, [key, publishClaim]);
}

/** Reader hook used by AppPresence to filter out userIds already shown in
 *  a per-surface stack. */
export function useClaimedWorkspacePeerIds(): Set<string> {
  return useContext(WorkspacePeerClaimsContext).claimed;
}
