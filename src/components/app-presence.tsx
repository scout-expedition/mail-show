"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { useBreadcrumbContext } from "@/lib/breadcrumb-context";
import { useRealtimeChannel } from "@/lib/realtime/channel";
import {
  colorFromUserId,
  type PresencePeer,
  type PresenceProfile,
} from "@/lib/realtime/presence";
import { useClaimedWorkspacePeerIds } from "@/lib/realtime/workspace-peer-claims";

/**
 * Global presence channel name. One per app — every authed surface joins it
 * and tracks its current pathname + breadcrumb. Separate from per-surface
 * channels (`letters-workspace`, `graph`, …) so identity is decoupled from
 * per-surface focus + selection broadcasts.
 */
const APP_PRESENCE_CHANNEL = "app-presence";

/** Identity payload broadcast via `channel.track()`. Carries the peer's
 *  current pathname (for cross-surface jump) AND their breadcrumb segments
 *  (for hover popup). */
type AppPresenceEntry = {
  userId?: string;
  email?: string;
  profile?: PresenceProfile | null;
  surface?: string;
  breadcrumb?: string[];
  /** Wall-clock ms at the moment this meta was published. Used to pick the
   *  freshest meta when the same user has multiple browser tabs open (each
   *  tab is a distinct meta under the same userId key). */
  trackedAt?: number;
  presence_ref?: string;
};

type RawState = Record<string, AppPresenceEntry[]>;

/** Pick the most recently-published meta from a Phoenix Presence entries
 *  array. With multi-tab the user has multiple metas under their key; we
 *  resolve to the one whose `trackedAt` is largest so peer popups reflect
 *  whichever tab they touched last. Older clients without `trackedAt` fall
 *  back to last-in-array (matches the pre-multi-tab behavior). */
function pickFreshestEntry(
  entries: AppPresenceEntry[]
): AppPresenceEntry | undefined {
  if (entries.length === 0) return undefined;
  let best = entries[0];
  let bestTs = typeof best.trackedAt === "number" ? best.trackedAt : -1;
  for (let i = 1; i < entries.length; i++) {
    const cur = entries[i];
    const ts = typeof cur.trackedAt === "number" ? cur.trackedAt : -1;
    // Tie-breaker: later array position wins (matches Phoenix's "fresh at
    // the back" ordering for a single tab calling track() twice).
    if (ts >= bestTs) {
      best = cur;
      bestTs = ts;
    }
  }
  return best;
}

/**
 * Pathname → base breadcrumb segments. Pages that drill into a sub-selection
 * (e.g. selected framework "Cult Takeover") append via
 * `useBreadcrumbExtension()`. Kept inline rather than reused from `NAV_ITEMS`
 * (which is module-scoped to a "use client" file) — update both when adding
 * new routes.
 */
function surfaceSegments(pathname: string): string[] {
  if (!pathname || pathname === "/") return ["Home"];
  // /inspection/letters intentionally returns just ["Inspection"] — the
  // workspace publishes a single-segment extension (the deepest selected ID,
  // e.g. "L-W2/b3" / "GW2-3" / "R-W2/ii", or "Letters" when nothing is
  // selected) so the popup reads "Inspection > <ID>" instead of stacking
  // four parent segments.
  if (pathname.startsWith("/inspection/letters")) return ["Inspection"];
  if (pathname.startsWith("/inspection/storylines"))
    return ["Inspection", "Storylines"];
  if (pathname.startsWith("/inspection/actions"))
    return ["Inspection", "Actions"];
  if (pathname.startsWith("/graph")) return ["Map View"];
  if (pathname.startsWith("/sorting/letters")) return ["Sorting", "Letters"];
  if (pathname.startsWith("/sorting/rules")) return ["Sorting", "Rules"];
  if (pathname.startsWith("/endings/frameworks"))
    return ["Endings", "Frameworks"];
  if (pathname.startsWith("/endings/logic")) return ["Endings", "Logic"];
  if (pathname.startsWith("/endings/variables"))
    return ["Endings", "Variables"];
  if (pathname.startsWith("/endings")) return ["Endings"];
  if (pathname.startsWith("/cities")) return ["Cities"];
  if (pathname.startsWith("/citizens")) return ["Citizens"];
  if (pathname.startsWith("/nations")) return ["Nations"];
  if (pathname.startsWith("/playthroughs")) return ["Playthroughs"];
  if (pathname.startsWith("/physical")) return ["Physical Letters"];
  if (pathname.startsWith("/days")) return ["Days"];
  if (pathname.startsWith("/dashboard")) return ["Dashboard"];
  if (pathname.startsWith("/settings")) return ["Settings"];
  return [pathname];
}

/**
 * App-shell-wide presence avatar stack — shows every authed user currently
 * online anywhere in the app.
 *
 * - Tracks `{ userId, email, profile, surface, breadcrumb }` once per route
 *   change AND whenever the breadcrumb extension changes. Phoenix `track()`
 *   updates are idempotent.
 * - Hover popup shows the peer's display name + their breadcrumb (one
 *   segment per line, "> " trailers).
 * - Peers on the SAME pathname as the local user get the same `#69707C`
 *   border as the self avatar, so co-location is obvious at a glance.
 * - Clicking a peer routes the local user to their surface. No-op if the
 *   peer is on the current page.
 * - The self avatar is rightmost in the stack; clicking it routes to
 *   `/settings`.
 */
export function AppPresence({
  userId,
  email,
  profile,
  othersOnly = false,
}: {
  userId: string;
  email: string;
  profile: PresenceProfile | null;
  /** When true, the stack only shows peers on OTHER pages (different surface)
   *  and hides the self avatar. Used on /inspection/letters where the
   *  workspace's own AvatarStack already covers same-page peers + self;
   *  AppPresence supplements with elsewhere-only awareness. */
  othersOnly?: boolean;
}) {
  const pathname = usePathname();
  const searchParamsObj = useSearchParams();
  const search = searchParamsObj?.toString() ?? "";
  const claimedByWorkspace = useClaimedWorkspacePeerIds();
  // Full URL including query string. Tabs (?tab=) and selections (?framework=)
  // are part of the surface so peers on different sub-views show as "different
  // page" and avatar clicks land you on the exact view, not just the base path.
  const surface = search ? `${pathname}?${search}` : pathname;
  const router = useRouter();
  const { extension } = useBreadcrumbContext();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [peerData, setPeerData] = useState<Record<string, AppPresenceEntry>>(
    {}
  );

  const { channel, subscribed } = useRealtimeChannel({
    name: APP_PRESENCE_CHANNEL,
    presenceKey: userId,
    onPresenceSync: () => {
      const ch = channelRef.current;
      if (!ch) return;
      const state = ch.presenceState() as RawState;
      const next: Record<string, AppPresenceEntry> = {};
      for (const [key, entries] of Object.entries(state)) {
        if (key === userId) continue;
        const latest = pickFreshestEntry(entries);
        if (!latest?.userId || !latest?.email) continue;
        next[latest.userId] = latest;
      }
      setPeerData(next);
    },
  });

  useEffect(() => {
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
    };
  }, [channel]);

  // Re-track on pathname OR breadcrumb-extension OR profile change. Serialize
  // the breadcrumb to keep the effect dep stable.
  const profileKey = JSON.stringify(profile);
  const extensionKey = JSON.stringify(extension);
  const breadcrumb = useMemo(
    () => [...surfaceSegments(pathname), ...extension],
    [pathname, extension]
  );
  const breadcrumbKey = JSON.stringify(breadcrumb);
  useEffect(() => {
    if (!channel || !subscribed) return;
    const parsedProfile = JSON.parse(profileKey) as PresenceProfile | null;
    const parsedBreadcrumb = JSON.parse(breadcrumbKey) as string[];
    void channel.track({
      userId,
      email,
      profile: parsedProfile,
      surface,
      breadcrumb: parsedBreadcrumb,
      // Per-call timestamp so multi-tab parsing can pick the freshest meta.
      trackedAt: Date.now(),
    });
  }, [
    channel,
    subscribed,
    userId,
    email,
    profileKey,
    surface,
    breadcrumbKey,
    extensionKey,
  ]);

  const peers = useMemo<PresencePeer[]>(() => {
    const list: PresencePeer[] = [];
    for (const [uid, entry] of Object.entries(peerData)) {
      if (!entry.email) continue;
      if (othersOnly) {
        // Two dedupe paths against the host page's per-surface stack:
        //   1. Peer's app-presence surface points at our pathname (steady
        //      state — both stacks would agree they're "here").
        //   2. Peer is in the workspace claims set even when their
        //      app-presence track has drifted to another page (multi-tab
        //      / mid-navigation race — letters-workspace channel still
        //      shows them).
        // Either match drops them from the elsewhere stack.
        if (claimedByWorkspace.has(uid)) continue;
        if (entry.surface) {
          const peerPath = entry.surface.split("?")[0];
          if (peerPath === pathname) continue;
        }
      }
      list.push({
        userId: uid,
        email: entry.email,
        profile: entry.profile ?? null,
        focus: null,
        selection: null,
        color: colorFromUserId(uid),
        // No activity heartbeats on this channel — 0 disables inactive-mute.
        lastActiveAt: 0,
      });
    }
    list.sort((a, b) => a.userId.localeCompare(b.userId));
    return list;
  }, [peerData, othersOnly, pathname, claimedByWorkspace]);

  const peerBreadcrumbs = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [uid, entry] of Object.entries(peerData)) {
      if (entry.breadcrumb && entry.breadcrumb.length > 0) {
        map.set(uid, entry.breadcrumb);
      } else if (entry.surface) {
        // Forward-compat for clients that haven't bundled breadcrumb yet —
        // derive from pathname so the popup isn't blank.
        map.set(uid, surfaceSegments(entry.surface));
      }
    }
    // Always include the local user's breadcrumb so the popup matches what
    // peers see for us.
    map.set(userId, breadcrumb);
    return map;
  }, [peerData, userId, breadcrumb]);

  const samePagePeerIds = useMemo(() => {
    const set = new Set<string>();
    for (const [uid, entry] of Object.entries(peerData)) {
      if (entry.surface === surface) set.add(uid);
    }
    return set;
  }, [peerData, surface]);

  // Same-pathname set ignores query: peers on the same parent page (different
  // tab or selection) still cluster with self via the AvatarStack overlap.
  // White border still requires a full-surface match (samePagePeerIds).
  const samePathnamePeerIds = useMemo(() => {
    const set = new Set<string>();
    for (const [uid, entry] of Object.entries(peerData)) {
      if (!entry.surface) continue;
      const peerPath = entry.surface.split("?")[0];
      if (peerPath === pathname) set.add(uid);
    }
    return set;
  }, [peerData, pathname]);

  const selfPeer = useMemo<PresencePeer>(
    () => ({
      userId,
      email,
      profile,
      color: profile?.avatarColorHex ?? colorFromUserId(userId),
      focus: null,
      selection: null,
      // AvatarStack skips the inactive-mute path for the `self` slot, so 0
      // is fine and keeps the render pure.
      lastActiveAt: 0,
    }),
    [userId, email, profile]
  );

  const handleAvatarClick = (peer: PresencePeer) => {
    const entry = peerData[peer.userId];
    // Compare against the full surface (pathname + ?search) so clicking a peer
    // on the same pathname but a different tab still navigates.
    if (entry?.surface && entry.surface !== surface) {
      router.push(entry.surface);
    }
  };

  const handleSelfClick = () => {
    if (pathname !== "/settings") router.push("/settings");
  };

  // othersOnly hides the self avatar — the host page's own stack already has
  // it. Returning null when the filtered peer list is also empty keeps the
  // workspace breadcrumb tidy: no orphan stack when everyone else is on the
  // same page.
  if (othersOnly && peers.length === 0) return null;

  return (
    <AvatarStack
      peers={peers}
      self={othersOnly ? null : selfPeer}
      peerBreadcrumbs={peerBreadcrumbs}
      samePagePeerIds={samePagePeerIds}
      samePathnamePeerIds={samePathnamePeerIds}
      onAvatarClick={handleAvatarClick}
      onSelfClick={handleSelfClick}
      popupAlign="right"
    />
  );
}
