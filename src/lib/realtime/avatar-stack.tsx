"use client";

import { useEffect, useState } from "react";
import { IconDisplay } from "@/components/icon-display";
import { cn } from "@/lib/utils";
import type { PresencePeer, PresenceSelection } from "./presence";

/** Border used to mark "currently on this page" for the local user + peers
 *  sharing the pathname (or, in workspace mode, the same panel). Falls back
 *  to the default `border-background` for peers who aren't here. */
export const SAME_PAGE_BORDER = "#ffffff";

/** WCAG-lite foreground luminance check — picks black-or-white text for any
 *  background hex. Same logic as `UserAvatar`'s readableOn() so peer avatars
 *  use the matching contrast color when a custom hex is set. */
function readableOn(hex: string): string {
  const full = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

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
/** Slot index for each `view` in the 6-panel slide layout
 *  (0 = storylines list, 1 = storyline inspector, 2 = group, 3 = letter,
 *  4 = actions, 5 = segment). `list` collapses to slot 1 because the
 *  storyline-inspector panel is what `selfSelection.storylineId` actually
 *  refers to; the bare list panel (slot 0) has no record. */
const SLOT_BY_VIEW: Record<string, number> = {
  list: 1,
  group: 2,
  main: 3,
  actions: 4,
  segment: 5,
};

/** The record id loaded at each slot for a given selection. Slots 3 and 4
 *  both key off `letterId` since actions are letter-scoped. */
function recordAtSlot(sel: PresenceSelection, slot: number): string | null {
  switch (slot) {
    case 1:
      return sel.storylineId;
    case 2:
      return sel.groupId;
    case 3:
    case 4:
      return sel.letterId;
    case 5:
      return sel.segmentId;
    default:
      return null;
  }
}

/** Visible slot range given a selection's view + narrow state. Wide mode
 *  shows two adjacent panels (the slide centers slot N with slot N-1 also
 *  on-screen, except at slot 1 which has nothing to its left). Narrow mode
 *  shows just slot N. */
function visibleSlots(sel: PresenceSelection): number[] {
  const slot = SLOT_BY_VIEW[sel.view];
  if (!slot) return [];
  if (sel.narrow) return [slot];
  return slot > 1 ? [slot - 1, slot] : [slot];
}

/**
 * True when self and peer can both see a panel showing the same record.
 * Visible-slot overlap, not chain-membership: a wide peer on view=segment
 * sees slots 4–5 (actions + segment), which doesn't overlap with a peer on
 * view=group (slot 2) even though both have the same group loaded in their
 * chain. Symmetric — both sides reach the same answer regardless of
 * viewport, given each side's broadcast `narrow` field.
 */
export function sharesPanel(
  self: PresenceSelection | null,
  peer: PresenceSelection | null
): boolean {
  if (!self || !peer) return false;
  const selfSlots = visibleSlots(self);
  if (selfSlots.length === 0) return false;
  const peerSlots = new Set(visibleSlots(peer));
  for (const slot of selfSlots) {
    if (!peerSlots.has(slot)) continue;
    const a = recordAtSlot(self, slot);
    const b = recordAtSlot(peer, slot);
    if (a && b && a === b) return true;
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
  self,
  className,
  max = 5,
  selfSelection,
  peerLocations,
  peerBreadcrumbs,
  samePagePeerIds,
  samePathnamePeerIds,
  onAvatarClick,
  onSelfClick,
  popupAlign = "center",
  inactiveAfterMs = INACTIVE_AFTER_MS,
  narrow = false,
}: {
  peers: PresencePeer[];
  /** The local user shaped as a `PresencePeer`. When provided, appended to
   *  the avatar row (rightmost) so "you" appear alongside everyone else.
   *  Always renders with the `SAME_PAGE_BORDER` ring. `onSelfClick` (when
   *  provided) makes the self avatar interactive. */
  self?: PresencePeer | null;
  className?: string;
  /** Cap visible avatars; overflow rolls up to "+N". Default 5. */
  max?: number;
  /** Local user's open-panel chain — used to compute the "not on same panel"
   *  mute state. When undefined, no peer is muted on that basis. */
  selfSelection?: PresenceSelection | null;
  /** Map of userId → single-line location label (legacy popup shape — used
   *  by per-surface stacks). Falls back to "Idle". */
  peerLocations?: Map<string, string>;
  /** Map of userId → breadcrumb segments (e.g. ["Endings", "Frameworks",
   *  "Cult Takeover"]). When present, the popup renders one line per segment
   *  with "> " trailers, replacing the single `peerLocations` entry. */
  peerBreadcrumbs?: Map<string, string[]>;
  /** Set of peer userIds currently on the same full surface (pathname +
   *  ?search) as the local user. These avatars get the `SAME_PAGE_BORDER`
   *  ring like `self`. */
  samePagePeerIds?: Set<string>;
  /** Set of peer userIds currently on the same pathname (parent page —
   *  ignores query string) as the local user. Controls AVATAR OVERLAP:
   *  same-pathname peers cluster tightly on the right with the self avatar;
   *  other peers render spaced out on the left. When undefined, ALL peers
   *  are treated as same-pathname (the per-surface workspace case, where
   *  every peer in the channel is by definition on the same surface). */
  samePathnamePeerIds?: Set<string>;
  /** Click handler — receives the clicked peer. When omitted the avatar is
   *  not interactive (no cursor change, no button semantics). */
  onAvatarClick?: (peer: PresencePeer) => void;
  /** Click handler for the local user's avatar — e.g. jump to /settings.
   *  When omitted the self avatar is non-interactive. */
  onSelfClick?: () => void;
  /** Popup horizontal anchor.
   *  - 'center' (default) — `left-1/2 -translate-x-1/2`, popup centered.
   *  - 'right' — `right-0`, popup grows to the LEFT from the avatar's right.
   *    Use when the stack is on the right edge of the viewport.
   *  - 'left' — `left-0`, popup grows to the RIGHT from the avatar's left. */
  popupAlign?: "center" | "right" | "left";
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

  if (peers.length === 0 && !self) return null;

  // Same-page set (= same FULL surface, pathname + ?search): controls the
  // white border. Either explicit (app-presence) or derived from
  // selfSelection via sharesPanel (workspace + graph stacks). White border
  // means "we're synchronized on the same tab/panel."
  const samePageSet =
    samePagePeerIds ??
    (() => {
      if (!selfSelection) return new Set<string>();
      // sharesPanel reads `narrow` from each selection. The local
      // selection's `narrow` may not be set yet (e.g. graph embed) — fold
      // the AvatarStack's `narrow` prop in as a fallback so callers don't
      // have to plumb it through their selection state too.
      const selfSel: PresenceSelection = {
        ...selfSelection,
        narrow: selfSelection.narrow ?? narrow,
      };
      const s = new Set<string>();
      for (const p of peers) {
        if (sharesPanel(selfSel, p.selection)) s.add(p.userId);
      }
      return s;
    })();

  // Same-pathname set (= same parent page, ignoring query): controls
  // AVATAR OVERLAP. Same-pathname peers cluster with self on the right;
  // other peers render spaced apart on the left. When the prop is
  // undefined, all peers are treated as same-pathname (per-surface
  // channels — workspace + graph — only see peers on this surface anyway).
  const allPeersSamePath = samePathnamePeerIds === undefined;
  const isSamePath = (p: PresencePeer) =>
    allPeersSamePath || samePathnamePeerIds!.has(p.userId);

  // Visibility priority for the `max` cap: same-pathname > same-page > rest.
  // Same-pathname peers are "closer" to the local user, so they should
  // survive the cap first. Within same-pathname, same-page (same tab) wins
  // the next tier.
  const byPriority = [...peers].sort((a, b) => {
    const aPath = isSamePath(a) ? 1 : 0;
    const bPath = isSamePath(b) ? 1 : 0;
    if (aPath !== bPath) return bPath - aPath;
    const aPage = samePageSet.has(a.userId) ? 1 : 0;
    const bPage = samePageSet.has(b.userId) ? 1 : 0;
    if (aPage !== bPage) return bPage - aPage;
    return a.userId.localeCompare(b.userId);
  });
  const visible = byPriority.slice(0, max);
  const overflow = peers.length - visible.length;

  // Split visible into two render groups:
  //   - elsewhere: not same-pathname → spaced out on the left
  //   - cluster: same-pathname → overlap on the right, with same-page peers
  //     sorted rightmost (closest to self)
  const elsewhere = visible
    .filter((p) => !isSamePath(p))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const cluster = visible
    .filter(isSamePath)
    .sort((a, b) => {
      const aPage = samePageSet.has(a.userId) ? 1 : 0;
      const bPage = samePageSet.has(b.userId) ? 1 : 0;
      if (aPage !== bPage) return aPage - bPage; // same-page rightmost
      return a.userId.localeCompare(b.userId);
    });

  const renderPeer = (peer: PresencePeer) => {
    const inactive =
      peer.lastActiveAt > 0
        ? now - peer.lastActiveAt > inactiveAfterMs
        : false;
    const location = peerLocations?.get(peer.userId) ?? "Idle";
    const breadcrumb = peerBreadcrumbs?.get(peer.userId);
    const samePage = samePageSet.has(peer.userId);
    return (
      <PresenceAvatar
        key={peer.userId}
        peer={peer}
        size={24}
        inactive={inactive}
        location={location}
        breadcrumb={breadcrumb}
        samePage={samePage}
        popupAlign={popupAlign}
        onClick={onAvatarClick ? () => onAvatarClick(peer) : undefined}
      />
    );
  };

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      aria-label={`${peers.length} other ${peers.length === 1 ? "user" : "users"} active`}
    >
      {elsewhere.length > 0 || overflow > 0 ? (
        <div className="flex items-center gap-1">
          {elsewhere.map(renderPeer)}
          {overflow > 0 ? (
            <span
              className="z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-background bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title={byPriority
                .slice(max)
                .map((p) => p.profile?.displayName?.trim() || p.email)
                .join(", ")}
            >
              +{overflow}
            </span>
          ) : null}
        </div>
      ) : null}
      {cluster.length > 0 || self ? (
        <div className="flex items-center -space-x-1.5">
          {cluster.map(renderPeer)}
          {self ? (
            <PresenceAvatar
              key={self.userId}
              peer={self}
              size={24}
              location={peerLocations?.get(self.userId) ?? "You"}
              breadcrumb={peerBreadcrumbs?.get(self.userId)}
              samePage
              isSelf
              popupAlign={popupAlign}
              onClick={onSelfClick}
            />
          ) : null}
        </div>
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
  breadcrumb,
  onClick,
  inactive = false,
  samePage = false,
  isSelf = false,
  popupAlign = "center",
}: {
  peer: PresencePeer;
  size?: number;
  className?: string;
  location?: string;
  /** Breadcrumb segments — when provided, replaces `location` in the popup
   *  with one line per segment ("Endings >", "Frameworks >", "Cult Takeover"). */
  breadcrumb?: string[];
  onClick?: () => void;
  inactive?: boolean;
  /** Draw the avatar with the `SAME_PAGE_BORDER` ring instead of the default
   *  page-blending border — marks "I am here / they are here". */
  samePage?: boolean;
  /** Marks the local user's own avatar — appends " (You)" in the popup name
   *  line so the user can tell at a glance which avatar is theirs. */
  isSelf?: boolean;
  /** Popup horizontal anchor. See AvatarStack docs. */
  popupAlign?: "center" | "right" | "left";
}) {
  const interactive = !!onClick;
  // Honor the user's customized avatar from /settings when set; fall back
  // to the deterministic peer.color + the first letter of display name OR
  // email otherwise. Matches the UserAvatar component used in the nav.
  const profile = peer.profile ?? null;
  const bg = profile?.avatarColorHex ?? peer.color;
  const hasIcon = !!(profile?.avatarIconType && profile?.avatarIconValue);
  const fg = readableOn(bg);
  const initialSource =
    (profile?.displayName?.trim() || peer.email.trim() || "?")[0];
  const initial = initialSource.toUpperCase();
  const ariaLabel = profile?.displayName?.trim() || peer.email;
  // Only inactive (idle) peers get muted — saturate/brightness filters
  // (not `opacity-*`) so the avatar circle stays opaque (overlapping
  // siblings used to bleed through when the muted avatar dropped to 50%
  // alpha). The previous "off-panel dim" is gone; co-location is signaled
  // by the white SAME_PAGE_BORDER instead.
  const muteClass = inactive ? "grayscale brightness-75 saturate-50" : "";
  const borderClass = samePage
    ? "border-2"
    : "border border-background";
  const avatar = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold shadow-sm transition",
        borderClass,
        muteClass,
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        color: fg,
        fontSize: Math.max(9, Math.floor(size * 0.45)),
        ...(samePage ? { borderColor: SAME_PAGE_BORDER } : null),
      }}
      aria-label={ariaLabel}
    >
      {hasIcon ? (
        <IconDisplay
          type={profile.avatarIconType!}
          value={profile.avatarIconValue!}
          size={Math.max(10, Math.round(size * 0.55))}
        />
      ) : (
        initial
      )}
    </span>
  );

  // Wrap in a `group` so the popup reveals on hover/focus of the trigger.
  const trigger = interactive ? (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      className="relative inline-flex cursor-pointer items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Jump to ${ariaLabel}`}
    >
      {avatar}
    </button>
  ) : (
    <span className="relative inline-flex items-center justify-center">
      {avatar}
    </span>
  );

  // Popup anchor: right-aligned for header stacks so the popup doesn't
  // overflow the viewport's right edge; center for in-flow uses.
  const popupAnchorClass =
    popupAlign === "right"
      ? "right-0"
      : popupAlign === "left"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";

  const breadcrumbLines = breadcrumb && breadcrumb.length > 0 ? breadcrumb : null;

  return (
    <span className="group relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100",
          popupAnchorClass
        )}
      >
        <span className="block text-foreground">
          {profile?.displayName?.trim() || peer.email}
          {isSelf ? (
            <span className="text-muted-foreground"> (You)</span>
          ) : null}
        </span>
        {breadcrumbLines ? (
          <span className="mt-0.5 block text-muted-foreground">
            {breadcrumbLines.map((seg, i) => (
              <span key={`${i}-${seg}`} className="block">
                {i < breadcrumbLines.length - 1 ? `${seg} >` : seg}
              </span>
            ))}
          </span>
        ) : location ? (
          <span className="block whitespace-pre-line text-muted-foreground">
            {location}
          </span>
        ) : null}
      </span>
    </span>
  );
}
