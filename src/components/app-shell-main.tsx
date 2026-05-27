"use client";

import { usePathname } from "next/navigation";
import { isHideChromePath } from "@/components/nav";

/** AppShell's `<main>`. On routes that hide the planner chrome (play mode),
 *  drops the planner's standard padding so the page can claim the full
 *  viewport. */
export function AppShellMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = isHideChromePath(pathname);
  if (hideChrome) {
    // Play mode owns its own scroll container + chrome. Drop the planner's
    // padding and outer scroll so PlayModeShell can fill the viewport.
    return <main className="flex flex-1 min-h-0 flex-col">{children}</main>;
  }
  return (
    <main
      className="flex-1 overflow-y-auto px-8 py-6"
      style={{ scrollbarGutter: "stable" }}
    >
      {children}
    </main>
  );
}
