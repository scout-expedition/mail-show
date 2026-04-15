import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Simple link-based tabs. The active tab is highlighted by the caller passing `active`. */
export function TabBar({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-border text-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px inline-flex h-9 items-center border-b-2 px-3 transition-colors",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
