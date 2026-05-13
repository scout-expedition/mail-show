"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { PresencePeer, PresenceSelection } from "./presence";

/** Default mute threshold: peers go grayscale + dim after this much inactivity. */
const INACTIVE_AFTER_MS = 120_000;

/**
 * Compute whether the local user and a peer have at least one record loaded
 * in common — i.e. their open-panel chains intersect at any of storyline /
 * group / letter / segment. Used to dim peers who aren't on the same panel.
 *
 * In `narrow` mode the workspace shows one slot at a time, so "sharing a
 * panel" reduces to "we're both looking at the same visible record" — derived
 * from each side's `view` + the matching id. The full intersection would be
 * misleading: in narrow mode a peer could have a group + a letter loaded but
 * only the letter is on screen, so showing them as "co-located" via the
 * background group would be wrong.
 */
export function sharesPanel(
  self: PresenceSelection | null,
  peer: PresenceSelection | null,
  narrow = false
): boolean {
  if (!self || !peer) return false;
  if (narrow) {
    const selfId = visibleRecordId(self);
    const peerId = visibleRecordId(peer);
    return !!selfId && selfId === peerId;
  }
  const selfIds = new Set(
    [self.storylineId, self.groupId, self.letterId, self.segmentId].filter(
      (id): id is string => !!id
    )
  );
  for (const id of [
    peer.storylineId,
    peer.groupId,
    peer.letterId,
    peer.segmentId,
  ]) {
    if (id && selfIds.has(id)) return true;
  }
  return false;
}

/** The record id of the currently-visible slot in a peer's selection chain.
 *  Mirrors the workspace's slide-to-view mapping (slot 0 = list/storyline,
 *  slot 2 = group, slot 3 = letter, slot 4 = actions (still letter-scoped),
 *  slot 5 = segment). */
export function visibleRecordId(sel: PresenceSelection): string | null {
  switch (sel.view) {
    case "list":
      return sel.storylineId;
    case "group":
      return sel.groupId;
    case "main":
    case "actions":
      return sel.letterId;
    case "segment":
      return sel.segmentId;
    default:
      return null;
  }
}

/**
 * Header pill: shows everyone currently active on this surface as a row of
 * colored initial-avatars.
 *
 * - Hovering an avatar reveals a small popup with the peer's location label
 *   (or "Idle" when they have neither a focus nor a selection).
 * - Clicking an avatar (when `onAvatarClick` is provided) jumps the local
 *   user to the peer's panel.
 * - Avatars are dimmed when the peer isn't sharing any open panel with the
 *   local user (`selfSelection`).
 * - Avatars are grayscale + dimmed after `inactiveAfterMs` (default 120s) of
 *   no broadcast activity; an internal interval ticks every 5s so this flips
 *   without external state changes.
 */
export function AvatarStack({
  peers,
  className,
  max = 5,
  selfSelection,
  peerLocations,
  onAvatarClick,
  inactiveAfterMs = INACTIVE_AFTER_MS,
  narrow = false,
}: {
  peers: PresencePeer[];
  className?: string;
  /** Cap visible avatars; overflow rolls up to "+N". Default 5. */
  max?: number;
  /** Local user's open-panel chain — used to compute the "not on same panel"
   *  mute state. When undefined, no peer is muted on that basis. */
  selfSelection?: PresenceSelection | null;
  /** Map of userId → location label shown in the hover popup. The workspace
   *  builds this by resolving each peer's focus.recordId or deepest selection
   *  entity against the local data mirrors. Missing entries fall back to
   *  "Idle". */
  peerLocations?: Map<string, string>;
  /** Click handler — receives the clicked peer. When omitted the avatar is
   *  not interactive (no cursor change, no button semantics). */
  onAvatarClick?: (peer: PresencePeer) => void;
  /** Inactivity threshold in ms. Default 120s. */
  inactiveAfterMs?: number;
  /** When true, only the currently-visible slot counts for "same panel" —
   *  matches the workspace's slide-one-panel-at-a-time layout. */
  narrow?: boolean;
}) {
  // Re-render every 5s so the inactive-mute boundary flips without external
  // state changes. `now` is owned by state (not Date.now() in render) so the
  // component stays pure across renders. Only mounted when there are peers —
  // avoids a perpetual timer on the common "alone on the page" path.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (peers.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [peers.length]);

  if (peers.length === 0) return null;
  const visible = peers.slice(0, max);
  const overflow = peers.length - visible.length;

  return (
    <div
      className={cn("flex items-center -space-x-1.5", className)}
      aria-label={`${peers.length} other ${peers.length === 1 ? "user" : "users"} active`}
    >
      {visible.map((peer) => {
        const inactive = peer.lastActiveAt > 0
          ? now - peer.lastActiveAt > inactiveAfterMs
          : false;
        const offPanel =
          !!selfSelection && !sharesPanel(selfSelection, peer.selection, narrow);
        const location = peerLocations?.get(peer.userId) ?? "Idle";
        return (
          <PresenceAvatar
            key={peer.userId}
            peer={peer}
            size={24}
            inactive={inactive}
            offPanel={offPanel}
            location={location}
            onClick={onAvatarClick ? () => onAvatarClick(peer) : undefined}
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className="z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-background bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
          title={peers
            .slice(max)
            .map((p) => p.email)
            .join(", ")}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Single circular avatar with the email's first letter, colored by
 * `peer.color`. Renders a hover popup with `location` when supplied, and an
 * optional `onClick` makes the avatar interactive (button semantics).
 *
 * `inactive` toggles grayscale + dim; `offPanel` toggles dim only — so the
 * two states stay visually distinct.
 */
export function PresenceAvatar({
  peer,
  size = 20,
  className,
  location,
  onClick,
  inactive = false,
  offPanel = false,
}: {
  peer: PresencePeer;
  size?: number;
  className?: string;
  location?: string;
  onClick?: () => void;
  inactive?: boolean;
  offPanel?: boolean;
}) {
  const initial = peer.email.charAt(0).toUpperCase();
  const interactive = !!onClick;
  const muteClass = inactive
    ? "opacity-50 grayscale"
    : offPanel
      ? "opacity-50"
      : "";
  const avatar = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-background font-semibold text-white shadow-sm transition",
        muteClass,
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: peer.color,
        fontSize: Math.max(9, Math.floor(size * 0.45)),
      }}
      aria-label={peer.email}
    >
      {initial}
    </span>
  );

  // Wrap in a `group` so the popup reveals on hover/focus of the trigger.
  const trigger = interactive ? (
    <button
      type="button"
      onClick={onClick}
      className="relative inline-flex cursor-pointer items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Jump to ${peer.email}`}
    >
      {avatar}
    </button>
  ) : (
    <span className="relative inline-flex items-center justify-center">
      {avatar}
    </span>
  );

  return (
    <span className="group relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block text-foreground">{peer.email}</span>
        {location ? (
          <span className="block whitespace-pre-line text-muted-foreground">
            {location}
          </span>
        ) : null}
      </span>
    </span>
  );
}
