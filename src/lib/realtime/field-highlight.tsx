"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PresenceFocus, PresencePeer } from "./presence";

/**
 * Wraps an input (or any focusable element) and draws an outset ring in a
 * peer's avatar color whenever that peer is currently focused on the matching
 * field. Renders inert when no peer matches or `focusKey` is null — caller
 * can wrap unconditionally.
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
  const peer = focusKey
    ? peers.find(
        (p) =>
          p.focus &&
          p.focus.table === focusKey.table &&
          p.focus.recordId === focusKey.recordId &&
          p.focus.field === focusKey.field
      )
    : null;
  return (
    <div
      data-focus-table={focusKey?.table}
      data-focus-record={focusKey?.recordId}
      data-focus-field={focusKey?.field}
      className={cn("rounded-md transition-shadow", className)}
      style={peer ? { boxShadow: `0 0 0 2px ${peer.color}` } : undefined}
    >
      {children}
    </div>
  );
}
