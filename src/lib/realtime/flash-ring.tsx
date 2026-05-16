"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a control in a transient avatar-colored ring used to surface a
 * peer's just-made change — the box-shadow appears instantly and fades via
 * `transition-shadow` when `color` clears. `color` null/undefined renders
 * inert, so callers can wrap unconditionally. Pair with `useFlash`.
 */
export function FlashRing({
  color,
  className,
  children,
}: {
  color: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("rounded-md transition-shadow", className)}
      style={color ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      {children}
    </div>
  );
}
