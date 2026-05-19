"use client";

import { usePathname } from "next/navigation";
import { AppPresence } from "@/components/app-presence";
import { usePresenceUser } from "@/components/presence-user-context";
import { isWipPath } from "@/lib/wip-pages";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  leading,
  className,
  presenceOthersOnly = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional content rendered to the LEFT of the title (e.g. the inline
   *  nav menu button on routes that suppress the floating one). */
  leading?: React.ReactNode;
  className?: string;
  /** When the page mounts its OWN per-surface AvatarStack (e.g. /graph), set
   *  this so the header AppPresence filters out same-pathname peers — they
   *  show up in the page's own stack and would otherwise duplicate. */
  presenceOthersOnly?: boolean;
}) {
  const presenceUser = usePresenceUser();
  const workInProgress = isWipPath(usePathname());

  return (
    <div
      className={cn(
        "mb-6 flex items-end justify-between gap-4 border-b border-border pb-4",
        className
      )}
    >
      <div className="flex items-end gap-3">
        {leading ? <div className="flex items-center pb-1">{leading}</div> : null}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            {workInProgress ? (
              <span className="text-sm italic text-warning/70">
                (Work in progress)
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* AppPresence renders FIRST (left) so on pages that put their own
            per-surface AvatarStack inside `actions` (e.g. /graph), the
            elsewhere-peers stack sits LEFT of the page's same-surface
            stack — matching the "self avatar always rightmost" rule. */}
        {presenceUser ? (
          <AppPresence
            userId={presenceUser.userId}
            email={presenceUser.email}
            profile={presenceUser.profile}
            othersOnly={presenceOthersOnly}
          />
        ) : null}
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
