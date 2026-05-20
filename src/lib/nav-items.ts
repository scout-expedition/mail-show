import type { ComponentType, SVGProps } from "react";
import {
  Atom,
  CalendarDays,
  BookOpen,
  Focus,
  Mail,
  Users,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Flag,
  Inbox,
  Network,
  Ruler,
  Package,
  PlayCircle,
  ScrollText,
  Settings,
} from "lucide-react";
import { IconBolt, IconMailOpened } from "@tabler/icons-react";
export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type NavSection =
  | "Game"
  | "Sorting"
  | "Inspection"
  | "Top of Day"
  | "Endings"
  | "Data"
  | "Setup";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  section: NavSection;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  "Game",
  "Top of Day",
  "Sorting",
  "Inspection",
  "Endings",
  "Data",
  "Setup",
] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/playthroughs", label: "Playthroughs", icon: PlayCircle, section: "Game" },
  { href: "/dashboard", label: "Dashboard", icon: Inbox, section: "Game" },
  { href: "/sorting/letters", label: "Letters", icon: Mail, section: "Sorting" },
  { href: "/sorting/rules", label: "Rules", icon: Ruler, section: "Sorting" },
  { href: "/inspection/letters", label: "Letters", icon: IconMailOpened, section: "Inspection" },
  { href: "/inspection/storylines", label: "Storylines", icon: BookOpen, section: "Inspection" },
  { href: "/inspection/actions", label: "Actions", icon: IconBolt, section: "Inspection" },
  { href: "/graph", label: "Graph", icon: MapIcon, section: "Inspection" },
  { href: "/top-of-day/morning-reports", label: "Morning Reports", icon: Megaphone, section: "Top of Day" },
  { href: "/endings/frameworks", label: "Frameworks", icon: ScrollText, section: "Endings" },
  { href: "/endings/logic", label: "Logic", icon: Network, section: "Endings" },
  { href: "/endings/variables", label: "Variables", icon: Focus, section: "Endings" },
  { href: "/endings/smart-variables", label: "Smart Variables", icon: Atom, section: "Endings" },
  { href: "/citizens", label: "Citizens", icon: Users, section: "Data" },
  { href: "/cities", label: "Cities", icon: MapPin, section: "Data" },
  { href: "/nations", label: "Nations", icon: Flag, section: "Data" },
  { href: "/days", label: "Days", icon: CalendarDays, section: "Setup" },
  { href: "/physical", label: "Physical Letters", icon: Package, section: "Setup" },
  { href: "/settings", label: "Settings", icon: Settings, section: "Setup" },
];

export const DEFAULT_TILE_HREFS: readonly string[] = [
  "/playthroughs",
  "/inspection/storylines",
  "/inspection/letters",
  "/inspection/actions",
  "/graph",
  "/top-of-day/morning-reports",
] as const;

