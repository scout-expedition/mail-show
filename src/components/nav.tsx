"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNavState } from "@/components/nav-context";
import { Menu } from "lucide-react";
import { NAV_ITEMS, NAV_SECTIONS } from "@/lib/nav-items";
import { WIP_PATHS } from "@/lib/wip-pages";
import { cn } from "@/lib/utils";

/**
 * Routes that force the nav into hamburger/overlay mode at every viewport
 * width — the page wants every pixel for its canvas. Keep this list in sync
 * with `NavSpacer` and the inline-menu check below.
 */
const FORCE_NARROW_PREFIXES = ["/graph"] as const;

/**
 * Routes that render their own inline menu button inside the page chrome
 * (so the floating left-edge button would just be redundant). The drawer
 * still works; only the floating trigger is suppressed.
 */
const INLINE_MENU_PREFIXES = ["/graph"] as const;

/**
 * Routes that take over the full viewport with their own chrome and want
 * the AppShell's left nav (and floating menu button) suppressed entirely.
 * Play-through detail pages render `<PlayNavbar>` and don't want to share
 * pixels with the planner's nav. Keep in sync with `isHideChromePath` in
 * `src/components/nav-spacer.tsx` and `app-shell-hud.tsx`.
 */
const HIDE_CHROME_PATTERNS = [/^\/playthroughs\/[^/]+(\/|$)/] as const;

function isForceNarrowPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return FORCE_NARROW_PREFIXES.some((p) => pathname.startsWith(p));
}
function isInlineMenuPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return INLINE_MENU_PREFIXES.some((p) => pathname.startsWith(p));
}
export function isHideChromePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDE_CHROME_PATTERNS.some((p) => p.test(pathname));
}

/**
 * Inline hamburger trigger for pages that want to host the toggle in their
 * own header (e.g. /graph puts it on the same line as the page title to
 * save vertical space). Reads the same shared open state as the floating
 * button, so either one opens the same drawer.
 */
export function NavMenuButton({ className }: { className?: string }) {
  const { open, toggle } = useNavState();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle navigation"
      aria-expanded={open}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className
      )}
    >
      <Menu size={16} aria-hidden />
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const forceNarrow = isForceNarrowPath(pathname);
  const inlineMenu = isInlineMenuPath(pathname);
  const hideChrome = isHideChromePath(pathname);
  const { open, setOpen } = useNavState();

  // Close the drawer whenever navigation finishes so a clicked link
  // doesn't leave the overlay hanging on narrow screens.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  if (hideChrome) return null;

  return (
    <>
      {/* Floating left-edge toggle button. Hidden when the route hosts its
          own inline menu button (the drawer state is shared via context, so
          either trigger opens the same drawer). */}
      {inlineMenu ? null : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className={cn(
            "fixed left-3 top-3 z-40 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground",
            forceNarrow ? null : "lg:hidden"
          )}
        >
          <Menu size={16} aria-hidden />
        </button>
      )}

      {/* Backdrop while drawer is open on narrow screens. */}
      {open ? (
        <div
          onClick={() => setOpen(false)}
          aria-hidden
          className={cn(
            "fixed inset-0 z-20 bg-black/40",
            forceNarrow ? null : "lg:hidden"
          )}
        />
      ) : null}

      <nav
        className={cn(
          "flex h-full w-56 shrink-0 flex-col gap-4 border-r border-border bg-card px-3 py-4",
          // Always a fixed overlay; at lg+ on non-force-narrow routes the
          // overlay becomes inline. The nav is rendered AFTER page content
          // in the DOM (so Tab reaches the page first); lg:order-1 pulls it
          // back to the left visually.
          "fixed inset-y-0 left-0 z-30 shadow-xl transition-transform duration-200",
          forceNarrow
            ? null
            : "lg:static lg:order-1 lg:translate-x-0 lg:shadow-none",
          open
            ? "translate-x-0"
            : forceNarrow
              ? "-translate-x-full"
              : "-translate-x-full lg:translate-x-0"
        )}
        aria-hidden={!open ? undefined : false}
      >
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="block rounded-md px-2 pt-8 lg:pt-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <div className="text-sm font-semibold tracking-wide transition-colors hover:text-foreground">
            Mail Show
          </div>
          <div className="text-xs text-muted-foreground">Planning tool</div>
        </Link>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section} className="flex flex-col gap-0.5">
              <div className="px-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                {section}
              </div>
              {NAV_ITEMS.filter((i) => i.section === section).map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                const wip = WIP_PATHS.has(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      // Inset focus ring — the scrolling section list
                      // (overflow-y-auto) would clip an outset ring/
                      // outline on links near its edges.
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active
                        ? "bg-accent text-accent-foreground"
                        : wip
                          ? "text-muted-foreground/55 hover:bg-accent/60 hover:text-foreground"
                          : "text-foreground/80 hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
