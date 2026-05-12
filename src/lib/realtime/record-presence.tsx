"use client";

import { cn } from "@/lib/utils";
import type { PresencePeer } from "./presence";

/**
 * Tiny colored dots next to a record's row label, one per peer currently
 * focused anywhere within the record (any field on this `recordId`).
 * Returns `null` when nobody else is on this record.
 */
export function RecordPresence({
  peers,
  recordId,
  className,
  max = 3,
  size = 6,
}: {
  peers: PresencePeer[];
  recordId: string;
  className?: string;
  /** Cap visible dots before overflow indicator. Default 3. */
  max?: number;
  /** Dot diameter in px. Default 6. */
  size?: number;
}) {
  const focused = peers.filter((p) => p.focus?.recordId === recordId);
  if (focused.length === 0) return null;

  const visible = focused.slice(0, max);
  const overflow = focused.length - visible.length;

  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-label={
        focused.length === 1
          ? `${focused[0].email} is viewing this`
          : `${focused.length} others viewing this`
      }
    >
      {visible.map((peer) => (
        <span
          key={peer.userId}
          className="rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: peer.color,
          }}
          title={peer.email}
        />
      ))}
      {overflow > 0 ? (
        <span
          className="text-[9px] font-medium tabular-nums text-muted-foreground"
          title={focused
            .slice(max)
            .map((p) => p.email)
            .join(", ")}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
