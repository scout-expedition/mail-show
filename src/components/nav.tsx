"use client";

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
  Ruler,
  Package,
  PlayCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  section: "Game" | "Data" | "Run";
}> = [
  { href: "/dashboard", label: "Dashboard", icon: Inbox, section: "Game" },
  { href: "/days", label: "Days", icon: CalendarDays, section: "Game" },
  { href: "/storylines", label: "Storylines", icon: BookOpen, section: "Game" },
  { href: "/sorting/letters", label: "Sorting letters", icon: Mail, section: "Game" },
  { href: "/sorting/rules", label: "Sorting rules", icon: Ruler, section: "Game" },
  { href: "/physical", label: "Physical letters", icon: Package, section: "Game" },
  { href: "/citizens", label: "Citizens", icon: Users, section: "Data" },
  { href: "/cities", label: "Cities", icon: MapPin, section: "Data" },
  { href: "/nations", label: "Nations", icon: Flag, section: "Data" },
  { href: "/playthroughs", label: "Playthroughs", icon: PlayCircle, section: "Run" },
  { href: "/graph", label: "Narrative graph", icon: MapIcon, section: "Run" },
  { href: "/settings", label: "Settings", icon: Settings, section: "Run" },
];

export function Nav() {
  const pathname = usePathname();
  const sections = ["Game", "Data", "Run"] as const;

  return (
    <nav className="flex h-full w-56 flex-col gap-4 border-r border-border bg-card/50 px-3 py-4">
      <div className="px-2">
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
                pathname === item.href || pathname.startsWith(item.href + "/");
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
  );
}
