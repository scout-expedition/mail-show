"use client";

import { cn } from "@/lib/utils";
import { PresenceAvatar } from "./avatar-stack";
import type { PresencePeer, PresenceFocus } from "./presence";

/**
 * Renders avatars of any peer whose focus matches the given key. Inline-flex
 * by default; wrap in a `relative`-positioned container if you want to
 * overlay it inside an input.
 *
 * Returns `null` when nobody else is focused on this field — pages with no
 * collaborators show no extra chrome.
 */
export function FieldPresence({
  peers,
  focusKey,
  className,
  size = 16,
}: {
  peers: PresencePeer[];
  focusKey: PresenceFocus;
  className?: string;
  size?: number;
}) {
  const focused = peers.filter((p) => matchesFocus(p.focus, focusKey));
  if (focused.length === 0) return null;

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-label={
        focused.length === 1
          ? `${focused[0].email} is editing this field`
          : `${focused.length} others editing this field`
      }
    >
      {focused.map((peer) => (
        <PresenceAvatar
          key={peer.userId}
          peer={peer}
          size={size}
          title={`${peer.email} is editing`}
        />
      ))}
    </span>
  );
}

function matchesFocus(
  focus: PresenceFocus | null,
  key: PresenceFocus
): boolean {
  if (!focus) return false;
  return (
    focus.table === key.table &&
    focus.recordId === key.recordId &&
    focus.field === key.field
  );
}
