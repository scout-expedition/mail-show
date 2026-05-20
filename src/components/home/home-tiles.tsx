"use client";

import {
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { setUserHomeTiles } from "@/app/(authed)/actions";
import { Button } from "@/components/ui/button";
import { usePresenceUser } from "@/components/presence-user-context";
import {
  NAV_ITEMS,
  NAV_SECTIONS,
  type NavIcon,
  type NavItem,
  type NavSection,
} from "@/lib/nav-items";
import { WIP_PATHS } from "@/lib/wip-pages";
import { cn } from "@/lib/utils";

export type SubOption = { href: string; label: string };
export type SubOptionsMap = Record<string, SubOption[]>;

const ITEM_BY_PATH: Map<string, NavItem> = new Map(
  NAV_ITEMS.map((item) => [item.href, item])
);

const TILE_FRAME =
  "relative flex min-h-[7.25rem] flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-4 text-center transition-colors";
const TILE_GRID = "grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6";

const AUTOSAVE_DELAY_MS = 500;
const FALLBACK_ACCENT = "#3b82f6";

/**
 * Per-user accent color. Provided at the HomeTiles root and consumed by
 * portaled descendants (SubmenuPortal) that can't inherit the parent
 * subtree's CSS variable via the DOM.
 */
const AccentContext = createContext<string>(FALLBACK_ACCENT);

function pathnameOf(href: string): string {
  const noHash = href.split("#")[0] ?? "";
  return noHash.split("?")[0] ?? "";
}

interface ResolvedTile {
  icon: NavIcon;
  label: string;
  section: NavSection;
  wip: boolean;
  pathname: string;
}

function resolveTile(
  href: string,
  subOptions: SubOptionsMap
): ResolvedTile | null {
  const pathname = pathnameOf(href);
  const parent = ITEM_BY_PATH.get(pathname);
  if (!parent) return null;
  const wip = WIP_PATHS.has(pathname);
  if (href === pathname) {
    return {
      icon: parent.icon,
      label: parent.label,
      section: parent.section,
      wip,
      pathname,
    };
  }
  const subs = subOptions[pathname] ?? [];
  const sub = subs.find((s) => s.href === href);
  return {
    icon: parent.icon,
    label: sub ? sub.label : parent.label,
    section: parent.section,
    wip,
    pathname,
  };
}

export function HomeTiles({
  initialHrefs,
  subOptions,
}: {
  initialHrefs: string[];
  subOptions: SubOptionsMap;
}) {
  const presenceUser = usePresenceUser();
  const userAccent =
    presenceUser?.profile?.avatarColorHex || FALLBACK_ACCENT;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [hrefs, setHrefs] = useState<string[]>(initialHrefs);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Skip the first effect run so we don't re-save the initial server payload.
  const dirtyRef = useRef(false);

  // Debounced autosave whenever `hrefs` changes after the first render.
  useEffect(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      return;
    }
    const t = window.setTimeout(() => {
      startTransition(async () => {
        try {
          await setUserHomeTiles(hrefs);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save tiles.");
        }
      });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [hrefs]);

  const rootStyle = useMemo<CSSProperties>(
    () =>
      ({
        // Override the global --accent token for everything inside the home
        // page so hover/selection chrome uses the local user's color.
        "--accent": userAccent,
      }) as CSSProperties,
    [userAccent]
  );

  return (
    <AccentContext.Provider value={userAccent}>
      <div className="flex flex-col gap-4" style={rootStyle}>
        <div className="flex items-center justify-end gap-2">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : null}
        <Button
          variant={mode === "edit" ? "default" : "outline"}
          size="icon"
          onClick={() => setMode(mode === "edit" ? "view" : "edit")}
          aria-label={mode === "edit" ? "Done editing tiles" : "Edit tiles"}
          aria-pressed={mode === "edit"}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      {mode === "view" ? (
        <TileGrid
          hrefs={hrefs}
          subOptions={subOptions}
          onEdit={() => setMode("edit")}
        />
      ) : (
        <TileEditor
          hrefs={hrefs}
          onChange={setHrefs}
          subOptions={subOptions}
        />
      )}
      </div>
    </AccentContext.Provider>
  );
}

function TileGrid({
  hrefs,
  subOptions,
  onEdit,
}: {
  hrefs: string[];
  subOptions: SubOptionsMap;
  onEdit: () => void;
}) {
  const tiles = hrefs
    .map((href) => {
      const meta = resolveTile(href, subOptions);
      return meta ? { href, meta } : null;
    })
    .filter((t): t is { href: string; meta: ResolvedTile } => t !== null);

  if (tiles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
        <p className="text-sm text-muted-foreground">No tiles yet.</p>
        <Button
          variant="outline"
          size="icon"
          className="mt-4"
          onClick={onEdit}
          aria-label="Edit tiles"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={TILE_GRID}>
      {tiles.map(({ href, meta }) => (
        <ViewTile key={href} href={href} meta={meta} />
      ))}
    </div>
  );
}

function ViewTile({ href, meta }: { href: string; meta: ResolvedTile }) {
  const Icon = meta.icon;
  return (
    <Link
      href={href}
      className={cn(
        TILE_FRAME,
        "group hover:border-accent/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        meta.wip && "opacity-60"
      )}
    >
      <Icon className="h-7 w-7 text-foreground transition-colors group-hover:text-accent" />
      <div className="text-[10px] font-medium leading-tight text-foreground">
        {meta.label}
      </div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {meta.section}
      </div>
    </Link>
  );
}

function TileEditor({
  hrefs,
  onChange,
  subOptions,
}: {
  hrefs: string[];
  onChange: (next: string[]) => void;
  subOptions: SubOptionsMap;
}) {
  const [draggingHref, setDraggingHref] = useState<string | null>(null);

  const usedSet = useMemo(() => new Set(hrefs), [hrefs]);

  const moveHrefTo = (href: string, toIndex: number) => {
    const fromIndex = hrefs.indexOf(href);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    const next = hrefs.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  const setHrefAt = (index: number, href: string) => {
    if (usedSet.has(href) && hrefs[index] !== href) return;
    const next = hrefs.slice();
    next[index] = href;
    onChange(next);
  };

  const remove = (index: number) => {
    const next = hrefs.slice();
    next.splice(index, 1);
    onChange(next);
  };

  const append = (href: string) => {
    if (usedSet.has(href)) return;
    onChange([...hrefs, href]);
  };

  return (
    <div className={TILE_GRID}>
      {hrefs.map((href, idx) => (
        <EditTile
          key={href}
          href={href}
          subOptions={subOptions}
          usedHrefs={usedSet}
          isDragging={draggingHref === href}
          onDragStart={() => setDraggingHref(href)}
          onDragEnd={() => setDraggingHref(null)}
          onDragOver={() => {
            if (draggingHref === null || draggingHref === href) return;
            moveHrefTo(draggingHref, idx);
          }}
          onDrop={() => setDraggingHref(null)}
          onSelect={(nextHref) => setHrefAt(idx, nextHref)}
          onRemove={() => remove(idx)}
        />
      ))}
      <AddTile
        subOptions={subOptions}
        usedHrefs={usedSet}
        onSelect={append}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Picker menu                                                         */
/* ------------------------------------------------------------------ */

interface MenuRowDescriptor {
  item: NavItem;
  visibleSubs: SubOption[];
  parentVisible: boolean;
}

interface SubmenuPlacement {
  href: string;
  left: number;
  top: number;
}

/**
 * Click-to-open page picker. The main panel lists nav items grouped by
 * section. Items with available sub-pages get a Chevron-right; clicking
 * one opens a SINGLE submenu portaled to document.body so it never gets
 * clipped by the main panel's overflow.
 */
function PagePickerMenu({
  open,
  onOpenChange,
  value,
  usedHrefs,
  subOptions,
  onSelect,
  children,
  wrapperClassName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  value: string;
  usedHrefs: Set<string>;
  subOptions: SubOptionsMap;
  onSelect: (href: string) => void;
  children: React.ReactNode;
  wrapperClassName?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<SubmenuPlacement | null>(null);
  // 150ms grace period so the cursor can traverse from the parent row into
  // the (portaled) submenu without the submenu closing on the way.
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenu(null);
      closeTimerRef.current = null;
    }, 150);
  }, [cancelClose]);

  const closeAll = useCallback(() => {
    cancelClose();
    onOpenChange(false);
    setSubmenu(null);
  }, [onOpenChange, cancelClose]);

  // Hidden if used by another tile and not the currently-selected value.
  const isHidden = useCallback(
    (href: string) => href !== value && usedHrefs.has(href),
    [usedHrefs, value]
  );

  // Build the menu row descriptors once per render.
  const sections = useMemo(() => {
    return NAV_SECTIONS.map((section) => {
      const rows: MenuRowDescriptor[] = NAV_ITEMS.filter(
        (i) => i.section === section
      )
        .map<MenuRowDescriptor>((item) => {
          const allSubs = subOptions[item.href] ?? [];
          const visibleSubs = allSubs.filter((s) => !isHidden(s.href));
          const parentVisible = !isHidden(item.href);
          return { item, visibleSubs, parentVisible };
        })
        .filter(
          ({ visibleSubs, parentVisible }) =>
            parentVisible || visibleSubs.length > 0
        );
      return { section, rows };
    }).filter(({ rows }) => rows.length > 0);
  }, [isHidden, subOptions]);

  // Close on outside-click and Escape.
  useEffect(() => {
    if (!open) {
      setSubmenu(null);
      return;
    }
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest('[data-home-tile-submenu="true"]')) return;
      closeAll();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, closeAll]);

  // Clear any pending close timer on unmount so we never fire setState
  // after the picker is gone.
  useEffect(() => cancelClose, [cancelClose]);

  // If the current submenu's parent disappears (because the matching tile
  // was added elsewhere), close the submenu.
  useEffect(() => {
    if (!submenu) return;
    const stillVisible = sections.some(({ rows }) =>
      rows.some(
        ({ item, visibleSubs }) =>
          item.href === submenu.href && visibleSubs.length > 0
      )
    );
    if (!stillVisible) setSubmenu(null);
  }, [sections, submenu]);

  const pick = (href: string) => {
    onSelect(href);
    closeAll();
  };

  const openSubmenuAt = (href: string, anchor: HTMLElement) => {
    cancelClose();
    const r = anchor.getBoundingClientRect();
    setSubmenu((prev) => {
      if (prev?.href === href) return prev;
      return { href, left: r.right, top: r.top };
    });
  };

  const activeRow = submenu
    ? sections
        .flatMap(({ rows }) => rows)
        .find((row) => row.item.href === submenu.href)
    : null;

  return (
    <div
      ref={wrapperRef}
      className={cn("relative", wrapperClassName ?? "inline-flex max-w-full")}
    >
      {children}
      {open ? (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-1/2 top-full z-30 mt-1 max-h-[80vh] w-56 -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-card p-1 text-left text-xs shadow-xl"
        >
          {sections.map(({ section, rows }) => (
            <div key={section} className="flex flex-col gap-0.5 py-1">
              <div className="px-2 pb-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                {section}
              </div>
              {rows.map(({ item, visibleSubs, parentVisible }) => {
                const isSelected = item.href === value;
                if (visibleSubs.length === 0) {
                  return (
                    <MenuLeaf
                      key={item.href}
                      item={item}
                      selected={isSelected}
                      onClick={() => pick(item.href)}
                    />
                  );
                }
                return (
                  <ExpandableRow
                    key={item.href}
                    item={item}
                    selected={isSelected}
                    parentVisible={parentVisible}
                    isOpen={submenu?.href === item.href}
                    onHoverIn={(anchor) => openSubmenuAt(item.href, anchor)}
                    onHoverOut={scheduleClose}
                    onClick={() => {
                      if (parentVisible) pick(item.href);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      {open && submenu && activeRow ? (
        <SubmenuPortal
          placement={submenu}
          parent={activeRow.item}
          parentVisible={activeRow.parentVisible}
          subs={activeRow.visibleSubs}
          value={value}
          onPick={pick}
          onHoverIn={cancelClose}
          onHoverOut={scheduleClose}
        />
      ) : null}
    </div>
  );
}

function MenuLeaf({
  item,
  selected,
  onClick,
}: {
  item: NavItem;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const wip = WIP_PATHS.has(item.href);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-0.5 text-left text-xs",
        selected
          ? "bg-accent text-accent-foreground"
          : wip
            ? "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            : "text-foreground/85 hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <span className={cn("inline-flex", wip && "opacity-60")}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function ExpandableRow({
  item,
  selected,
  parentVisible,
  isOpen,
  onHoverIn,
  onHoverOut,
  onClick,
}: {
  item: NavItem;
  selected: boolean;
  parentVisible: boolean;
  isOpen: boolean;
  onHoverIn: (anchor: HTMLElement) => void;
  onHoverOut: () => void;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const wip = WIP_PATHS.has(item.href);
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onMouseEnter={(e) => onHoverIn(e.currentTarget)}
      onMouseLeave={onHoverOut}
      onFocus={(e) => onHoverIn(e.currentTarget)}
      onBlur={onHoverOut}
      onClick={parentVisible ? onClick : undefined}
      aria-disabled={!parentVisible}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-0.5 text-left text-xs",
        isOpen
          ? "bg-accent/60 text-foreground"
          : selected && parentVisible
            ? "bg-accent text-accent-foreground"
            : !parentVisible
              ? wip
                ? "cursor-default text-muted-foreground"
                : "cursor-default text-foreground/85"
              : wip
                ? "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                : "text-foreground/85 hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <span className={cn("inline-flex", wip && "opacity-60")}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

function SubmenuPortal({
  placement,
  parent,
  parentVisible,
  subs,
  value,
  onPick,
  onHoverIn,
  onHoverOut,
}: {
  placement: SubmenuPlacement;
  parent: NavItem;
  parentVisible: boolean;
  subs: SubOption[];
  value: string;
  onPick: (href: string) => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
}) {
  // Portals escape the parent subtree's CSS variables, so re-inject the
  // accent on the portal's own style from context.
  const accent = useContext(AccentContext);
  if (typeof document === "undefined") return null;
  const Icon = parent.icon;
  const parentWip = WIP_PATHS.has(parent.href);
  return createPortal(
    <div
      data-home-tile-submenu="true"
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
      style={{
        position: "fixed",
        left: placement.left,
        top: placement.top,
        ["--accent" as string]: accent || undefined,
      }}
      className="z-50 w-56 rounded-md border border-border bg-card p-1 text-xs shadow-xl"
    >
      {parentVisible ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick(parent.href)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-0.5 text-left text-xs",
              parent.href === value
                ? "bg-accent text-accent-foreground"
                : parentWip
                  ? "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  : "text-foreground/85 hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <span className={cn("inline-flex", parentWip && "opacity-60")}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{parent.label} (overview)</span>
          </button>
          <div className="my-1 border-t border-border" />
        </>
      ) : null}
      {subs.map((sub) => {
        const selected = sub.href === value;
        return (
          <button
            key={sub.href}
            type="button"
            role="menuitem"
            onClick={() => onPick(sub.href)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-0.5 text-left text-xs",
              selected
                ? "bg-accent text-accent-foreground"
                : parentWip
                  ? "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  : "text-foreground/85 hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <span className="truncate">{sub.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Tile components                                                     */
/* ------------------------------------------------------------------ */

function EditTile({
  href,
  subOptions,
  usedHrefs,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSelect,
  onRemove,
}: {
  href: string;
  subOptions: SubOptionsMap;
  usedHrefs: Set<string>;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onSelect: (href: string) => void;
  onRemove: () => void;
}) {
  const meta = resolveTile(href, subOptions);
  const Icon = meta?.icon;
  const [dragArmed, setDragArmed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!dragArmed) return;
    const off = () => setDragArmed(false);
    window.addEventListener("mouseup", off);
    window.addEventListener("touchend", off);
    return () => {
      window.removeEventListener("mouseup", off);
      window.removeEventListener("touchend", off);
    };
  }, [dragArmed]);

  return (
    <div
      draggable={dragArmed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", href);
        setTimeout(onDragStart, 0);
      }}
      onDragEnd={() => {
        setDragArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        TILE_FRAME,
        isDragging && "border-dashed border-accent/60 bg-card/30",
        meta?.wip && !isDragging && "opacity-80"
      )}
    >
      {isDragging ? null : (
        <>
          <button
            type="button"
            aria-label="Drag to reorder"
            onMouseDown={() => setDragArmed(true)}
            onTouchStart={() => setDragArmed(true)}
            onClick={(e) => e.preventDefault()}
            className="absolute left-1.5 top-1.5 inline-flex h-5 w-5 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Remove tile"
            className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
          {Icon ? (
            <span className={cn("inline-flex", meta?.wip && "opacity-70")}>
              <Icon className="h-7 w-7 text-foreground" />
            </span>
          ) : (
            <Plus className="h-7 w-7 opacity-50" />
          )}
          <PagePickerMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            value={href}
            usedHrefs={usedHrefs}
            subOptions={subOptions}
            onSelect={onSelect}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border bg-background/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent/60"
            >
              <span className="truncate">{meta?.label ?? "Unknown page"}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </PagePickerMenu>
          {meta ? (
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {meta.section}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AddTile({
  subOptions,
  usedHrefs,
  onSelect,
}: {
  subOptions: SubOptionsMap;
  usedHrefs: Set<string>;
  onSelect: (href: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <PagePickerMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      value=""
      usedHrefs={usedHrefs}
      subOptions={subOptions}
      onSelect={onSelect}
      wrapperClassName="block"
    >
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Add tile"
        className={cn(
          TILE_FRAME,
          "h-full w-full border-dashed text-muted-foreground transition-colors hover:border-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        )}
      >
        <Plus className="h-7 w-7" />
        <span aria-hidden className="h-4 w-0" />
        <span aria-hidden className="h-4 w-0" />
      </button>
    </PagePickerMenu>
  );
}
