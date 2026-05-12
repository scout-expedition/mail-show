"use client";

import { cn } from "@/lib/utils";
import type { PresencePeer } from "./presence";

/**
 * Header pill: shows everyone currently active on this surface as a row of
 * colored initial-avatars. Hover for email. Empty when nobody else is here.
 */
export function AvatarStack({
  peers,
  className,
  max = 5,
}: {
  peers: PresencePeer[];
  className?: string;
  /** Cap visible avatars; overflow rolls up to "+N". Default 5. */
  max?: number;
}) {
  if (peers.length === 0) return null;
  const visible = peers.slice(0, max);
  const overflow = peers.length - visible.length;

  return (
    <div
      className={cn("flex items-center -space-x-1.5", className)}
      aria-label={`${peers.length} other ${peers.length === 1 ? "user" : "users"} active`}
    >
      {visible.map((peer) => (
        <PresenceAvatar key={peer.userId} peer={peer} size={24} />
      ))}
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

/** Single circular avatar with the email's first letter, colored by peer.color. */
export function PresenceAvatar({
  peer,
  size = 20,
  className,
  title,
}: {
  peer: PresencePeer;
  size?: number;
  className?: string;
  title?: string;
}) {
  const initial = peer.email.charAt(0).toUpperCase();
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-full border border-background font-semibold text-white shadow-sm",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: peer.color,
        fontSize: Math.max(9, Math.floor(size * 0.45)),
      }}
      title={title ?? peer.email}
      aria-label={peer.email}
    >
      {initial}
    </span>
  );
}
