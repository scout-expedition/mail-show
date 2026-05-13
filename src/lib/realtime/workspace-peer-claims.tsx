"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
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
  /** Publish the current claim for a stable claimer id. Multiple claimers
   *  coexist (e.g. /graph mounts its own claimer AND the nested
   *  LettersWorkspace inspector mounts another); the global `claimed` set
   *  is the union of every claimer's ids. */
  publishClaim: (claimerId: string, ids: string[]) => void;
  /** Drop a claimer's entry — called on unmount of the using hook so peers
   *  from that claimer stop counting. */
  releaseClaim: (claimerId: string) => void;
};

const WorkspacePeerClaimsContext = createContext<WorkspacePeerClaimsValue>({
  claimed: new Set(),
  publishClaim: () => {},
  releaseClaim: () => {},
});

export function WorkspacePeerClaimsProvider({ children }: { children: ReactNode }) {
  // Per-claimer map of {claimerId: peerIds}. Multiple per-surface stacks
  // (e.g. the graph workspace stack AND the nested letters inspector when
  // /graph opens the inspector) each get their own entry — clearing one
  // doesn't clobber the others, fixing the "duplicate avatars when the
  // inspector closes" regression that Codex flagged.
  const [byClaimer, setByClaimer] = useState<Record<string, string[]>>({});

  const publishClaim = useCallback((claimerId: string, ids: string[]) => {
    setByClaimer((prev) => {
      const existing = prev[claimerId];
      if (
        existing &&
        existing.length === ids.length &&
        ids.every((id, i) => existing[i] === id)
      ) {
        return prev;
      }
      return { ...prev, [claimerId]: ids };
    });
  }, []);

  const releaseClaim = useCallback((claimerId: string) => {
    setByClaimer((prev) => {
      if (!(claimerId in prev)) return prev;
      const next: Record<string, string[]> = {};
      for (const key of Object.keys(prev)) {
        if (key !== claimerId) next[key] = prev[key];
      }
      return next;
    });
  }, []);

  const claimed = useMemo(() => {
    const out = new Set<string>();
    for (const ids of Object.values(byClaimer)) {
      for (const id of ids) out.add(id);
    }
    return out;
  }, [byClaimer]);

  const value = useMemo<WorkspacePeerClaimsValue>(
    () => ({ claimed, publishClaim, releaseClaim }),
    [claimed, publishClaim, releaseClaim]
  );

  return (
    <WorkspacePeerClaimsContext.Provider value={value}>
      {children}
    </WorkspacePeerClaimsContext.Provider>
  );
}

/**
 * Workspace-side hook: publishes the per-surface peer userIds while the
 * stack is mounted, clears on unmount. Each call gets a stable `useId`
 * claimer key so multiple concurrent claimers (graph + nested letters
 * inspector) coexist without overwriting each other.
 */
export function useClaimWorkspacePeers(peerIds: string[]) {
  const { publishClaim, releaseClaim } = useContext(WorkspacePeerClaimsContext);
  const claimerId = useId();
  const key = peerIds.join(",");
  useEffect(() => {
    publishClaim(claimerId, key ? key.split(",") : []);
    return () => releaseClaim(claimerId);
  }, [claimerId, key, publishClaim, releaseClaim]);
}

/** Reader hook used by AppPresence to filter out userIds already shown in
 *  a per-surface stack. */
export function useClaimedWorkspacePeerIds(): Set<string> {
  return useContext(WorkspacePeerClaimsContext).claimed;
}
