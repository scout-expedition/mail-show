"use client";

import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  BookOpen,
  Mail,
  Users,
  Map as MapIcon,
  MapPin,
  Flag,
  Inbox,
  Menu,
  Milestone,
  Ruler,
  Package,
  PlayCircle,
  ScrollText,
  Settings,
} from "lucide-react";
import { IconMailOpened } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: NavIcon;
  section: "Game" | "Sorting" | "Inspection" | "Data" | "Run";
}> = [
  { href: "/dashboard", label: "Dashboard", icon: Inbox, section: "Game" },
  { href: "/days", label: "Days", icon: CalendarDays, section: "Game" },
  { href: "/graph", label: "Narrative Graph", icon: MapIcon, section: "Game" },
  { href: "/physical", label: "Physical Letters", icon: Package, section: "Game" },
  { href: "/sorting/letters", label: "Letters", icon: Mail, section: "Sorting" },
  { href: "/sorting/rules", label: "Rules", icon: Ruler, section: "Sorting" },
  { href: "/inspection/letters", label: "Letters", icon: IconMailOpened, section: "Inspection" },
  { href: "/inspection/storylines", label: "Storylines", icon: BookOpen, section: "Inspection" },
  { href: "/inspection/actions", label: "Actions", icon: Milestone, section: "Inspection" },
  { href: "/citizens", label: "Citizens", icon: Users, section: "Data" },
  { href: "/cities", label: "Cities", icon: MapPin, section: "Data" },
  { href: "/nations", label: "Nations", icon: Flag, section: "Data" },
  { href: "/endings", label: "Endings", icon: ScrollText, section: "Data" },
  { href: "/playthroughs", label: "Playthroughs", icon: PlayCircle, section: "Run" },
  { href: "/settings", label: "Settings", icon: Settings, section: "Run" },
];

export function Nav() {
  const pathname = usePathname();
  const sections = ["Game", "Sorting", "Inspection", "Data", "Run"] as const;
  const [open, setOpen] = useState(false);

  // Close the drawer whenever navigation finishes so a clicked link
  // doesn't leave the overlay hanging on narrow screens.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Toggle button — always on-screen; the nav itself is an
          overlay on narrow viewports and inline at lg+ widths. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
        aria-expanded={open}
        className={cn(
          "fixed left-3 top-3 z-40 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground",
          // Hide on wide screens when nav is already inline; show when
          // the user has explicitly collapsed it.
          "lg:hidden"
        )}
      >
        <Menu size={16} aria-hidden />
      </button>

      {/* Backdrop while drawer is open on narrow screens. */}
      {open ? (
        <div
          onClick={() => setOpen(false)}
          aria-hidden
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
        />
      ) : null}

      <nav
        className={cn(
          "flex h-full w-56 shrink-0 flex-col gap-4 border-r border-border bg-card px-3 py-4",
          // On narrow screens the nav is a fixed overlay that slides in
          // from the left; at lg+ it sits inline in the flex row.
          "fixed inset-y-0 left-0 z-30 shadow-xl transition-transform duration-200 lg:static lg:translate-x-0 lg:shadow-none",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        aria-hidden={!open ? undefined : false}
      >
        <div className="px-2 pt-8 lg:pt-0">
          <div className="text-sm font-semibold tracking-wide">Mail Show</div>
          <div className="text-xs text-muted-foreground">Planning tool</div>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto">
          {sections.map((section) => (
            <div key={section} className="flex flex-col gap-0.5">
              <div className="px-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                {section}
              </div>
              {NAV_ITEMS.filter((i) => i.section === section).map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
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
