"use client";

import { usePathname } from "next/navigation";
import { isHideChromePath } from "@/components/nav";
import { cn } from "@/lib/utils";

const FORCE_NARROW_PREFIXES = ["/graph"] as const;
/**
 * Routes that host their own inline menu button (e.g. inside a PageHeader)
 * and therefore don't need any vertical room reserved at the top of main.
 * Keep in sync with `INLINE_MENU_PREFIXES` in nav.tsx.
 */
const INLINE_MENU_PREFIXES = ["/graph"] as const;

/**
 * Reserves room above page content for the fixed Menu toggle button. At lg+
 * the regular nav is inline so the spacer normally collapses — except on
 * routes where the nav is forced into hamburger mode at every viewport.
 * Routes that host an inline menu button skip the spacer entirely so the
 * page can put the trigger on the same line as its title.
 */
export function NavSpacer() {
  const pathname = usePathname();
  const forceNarrow = pathname
    ? FORCE_NARROW_PREFIXES.some((p) => pathname.startsWith(p))
    : false;
  const inlineMenu = pathname
    ? INLINE_MENU_PREFIXES.some((p) => pathname.startsWith(p))
    : false;
  if (inlineMenu) return null;
  if (isHideChromePath(pathname)) return null;
  return (
    <div
      aria-hidden
      className={cn("h-12 shrink-0", forceNarrow ? null : "lg:hidden")}
    />
  );
}
