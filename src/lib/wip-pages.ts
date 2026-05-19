/**
 * Routes still under construction. Drives the dimmed nav styling and the
 * "(Work in progress)" marker beside the page header. Keep these paths in
 * sync with the `href`s in NAV_ITEMS (src/components/nav.tsx).
 */
export const WIP_PATHS = new Set<string>([
  "/dashboard",
  "/days",
  "/physical",
  "/sorting/letters",
  "/sorting/rules",
  "/playthroughs",
]);

/**
 * Prefix-match a pathname against {@link WIP_PATHS} so detail/sub-pages under a
 * WIP section (e.g. `/days/[id]`, `/playthroughs/[id]`) also count as WIP. The
 * trailing-`/` guard means `/dashboard` never matches an unrelated
 * `/dashboardfoo`.
 */
export function isWipPath(pathname: string | null | undefined): boolean {
  if (pathname == null) return false;
  for (const p of WIP_PATHS) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}
