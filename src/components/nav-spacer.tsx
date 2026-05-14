"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const FORCE_NARROW_PREFIXES = ["/graph"] as const;

/**
 * Reserves room above page content for the fixed Menu toggle button. At lg+
 * the regular nav is inline so the spacer normally collapses — except on
 * routes where the nav is forced into hamburger mode at every viewport
 * (currently `/graph`), where the spacer needs to stay visible too. Keep
 * the route prefix list in sync with the matching constant in nav.tsx.
 */
export function NavSpacer() {
  const pathname = usePathname();
  const forceNarrow = pathname
    ? FORCE_NARROW_PREFIXES.some((p) => pathname.startsWith(p))
    : false;
  return (
    <div
      aria-hidden
      className={cn("h-12 shrink-0", forceNarrow ? null : "lg:hidden")}
    />
  );
}
