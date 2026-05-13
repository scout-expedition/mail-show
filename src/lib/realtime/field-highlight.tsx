"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PresenceFocus, PresencePeer } from "./presence";
import { usePresenceContext } from "./presence-context";

/**
 * Wraps an input (or any focusable element) and draws an outset ring in
 * the avatar color of whoever currently has focus on this field — the
 * local user (self ring, "where I'm editing") OR a peer (peer ring,
 * "someone else is editing here"). Self wins when both match, since the
 * user's own location is more visually load-bearing than a colocated
 * peer's; peers still appear via the avatar stack.
 *
 * Renders inert when no one's focused or `focusKey` is null — caller can
 * wrap unconditionally.
 *
 * Also stamps `data-focus-field` / `data-focus-record` / `data-focus-table`
 * onto the wrapper so an enclosing surface (e.g. ActionEditor) can resolve
 * "which sub-field just got focused" via `target.closest()` instead of
 * threading explicit onFocus handlers down to every nested control.
 */
export function FieldHighlight({
  peers,
  focusKey,
  className,
  children,
}: {
  peers: PresencePeer[];
  focusKey: PresenceFocus | null;
  className?: string;
  children: ReactNode;
}) {
  const { focus: localFocus, selfColor } = usePresenceContext();

  let color: string | undefined;
  if (focusKey) {
    if (
      localFocus &&
      selfColor &&
      localFocus.table === focusKey.table &&
      localFocus.recordId === focusKey.recordId &&
      localFocus.field === focusKey.field
    ) {
      color = selfColor;
    } else {
      const peer = peers.find(
        (p) =>
          p.focus &&
          p.focus.table === focusKey.table &&
          p.focus.recordId === focusKey.recordId &&
          p.focus.field === focusKey.field
      );
      // Honor the peer's customized avatar hex from /settings (same
      // precedence the AvatarStack uses) — falls back to the deterministic
      // `peer.color` from `colorFromUserId` when the peer hasn't picked one.
      color = peer?.profile?.avatarColorHex ?? peer?.color;
    }
  }

  // Set the `--ring` CSS variable so `focus-visible:ring-ring` on descendant
  // Inputs/Selects/Textareas picks up the avatar color instead of the global
  // blue — without that override the default focus ring sits on top of our
  // box-shadow and visually wins. Cast through Record<string, string>
  // because React's CSSProperties type doesn't permit custom property keys
  // directly.
  const style = color
    ? ({
        boxShadow: `0 0 0 2px ${color}`,
        "--ring": color,
      } as React.CSSProperties & Record<string, string>)
    : undefined;

  return (
    <div
      data-focus-table={focusKey?.table}
      data-focus-record={focusKey?.recordId}
      data-focus-field={focusKey?.field}
      className={cn("rounded-md transition-shadow", className)}
      style={style}
    >
      {children}
    </div>
  );
}
