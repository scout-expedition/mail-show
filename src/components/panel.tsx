"use client";

import * as React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMenuPosition } from "@/components/use-menu-position";
import { MoreVertical, Save, Trash2 } from "lucide-react";
import { IconRestore } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Entry-field look: a darker-than-panel fill that darkens further on hover
 * and shows a visible border on focus. The border stays transparent at
 * rest so the field blends with the panel edges — "not editable until
 * clicked in".
 */
export const GHOST_FIELD =
  "border-transparent bg-black/35 shadow-none hover:bg-black/50 focus:border-border focus-visible:bg-black/50 focus-visible:shadow-sm";

/** Shared style for "+ thing" buttons — muted at rest, solid accent on hover. */
export const MUTED_ADD_BTN =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/40 px-3 text-xs text-muted-foreground/60 transition-colors hover:border-foreground/40 hover:bg-accent hover:text-accent-foreground disabled:opacity-40";

/**
 * Textarea that grows to fit its contents — no inner scroll. Useful when
 * a block of prose should read end-to-end without the editor hiding part
 * of it behind an internal scrollbar.
 */
export function AutoTextarea({
  value,
  onChange,
  minRows = 2,
  className,
  ...rest
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  className?: string;
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "rows" | "className"
>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      className={cn("resize-none overflow-hidden", className)}
      {...rest}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent",
        className
      )}
    />
  );
}

export function PanelHeader({
  title,
  icon,
  dirty,
  showSaved,
  saveRevert,
  menu,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  dirty?: boolean;
  showSaved?: boolean;
  saveRevert?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 rounded-t-md border-b border-border bg-white/[0.04] px-3 py-1.5">
      <span className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </span>
      <div className="flex items-center gap-2">
        {dirty ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
            • Unsaved
          </span>
        ) : showSaved ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            Saved
          </span>
        ) : null}
        {saveRevert}
        {menu}
      </div>
    </div>
  );
}

/**
 * Icon-only save + revert pair. Revert is expected to guard itself with a
 * confirm modal when dirty. Hidden entirely until there are unsaved
 * changes (or a save is in flight).
 */
export function SaveRevert({
  dirty,
  pending,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  if (!dirty && !pending) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onRevert}
        disabled={pending}
        aria-label="Revert to saved"
        title="Revert to saved"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconRestore size={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        aria-label="Save"
        title="Save"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Spinner /> : <Save size={14} aria-hidden />}
      </button>
    </div>
  );
}

export type OverflowMenuItem =
  | {
      label: string;
      onClick: () => void;
      intent?: "default" | "destructive";
      icon?: React.ReactNode;
      disabled?: boolean;
    }
  | { divider: true };

export function OverflowMenu({
  items,
  size = "default",
  icon,
  ariaLabel = "More actions",
}: {
  items: OverflowMenuItem[];
  size?: "default" | "sm";
  /** Overrides the kebab glyph — e.g. a Plus for an "add" menu. */
  icon?: React.ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { triggerRef, menuRef, pos } = useMenuPosition({
    open,
    align: "right",
    preferredPlacement: "down",
    deps: [items.length],
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      const target = e.target as Node;
      if (ref.current.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuRef]);

  const buttonClass =
    size === "sm"
      ? "inline-flex h-4 w-4 items-center justify-center overflow-visible rounded text-muted-foreground transition-colors hover:text-foreground"
      : "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
  const iconSize = size === "sm" ? 16 : 14;
  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={buttonClass}
      >
        {icon ?? <MoreVertical size={iconSize} aria-hidden />}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-max max-w-[260px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          {items.map((item, i) => {
            if ("divider" in item) {
              return (
                <div
                  key={i}
                  role="separator"
                  className="my-1 border-t border-border"
                />
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 whitespace-nowrap px-3 py-1 text-left font-mono text-[11px] tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  item.intent === "destructive"
                    ? "text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    : "text-foreground hover:bg-accent/40"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function DeleteButton({
  onClick,
  disabled,
  label = "Delete",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground opacity-40 transition-[colors,opacity] hover:border-destructive hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 disabled:opacity-30"
    >
      <Trash2 size={10} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export type UnsavedOutcome = "save" | "discard" | "cancel";

/**
 * Three-way dialog for navigating away from unsaved changes. Resolves to
 * "save", "discard", or "cancel". Callers decide what each means in their
 * flow — typically: save and continue, discard and continue, or stay put.
 */
export function useUnsavedDialog(): {
  ask: (title: string, message?: string) => Promise<UnsavedOutcome>;
  dialog: React.ReactNode;
} {
  const [state, setState] = useState<{ title: string; message?: string } | null>(
    null
  );
  const resolveRef = useRef<((v: UnsavedOutcome) => void) | null>(null);

  const ask = useCallback(
    (title: string, message?: string) =>
      new Promise<UnsavedOutcome>((resolve) => {
        resolveRef.current = resolve;
        setState({ title, message });
      }),
    []
  );

  function settle(v: UnsavedOutcome) {
    const r = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    r?.(v);
  }

  const dialog = state ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
      onClick={() => settle("cancel")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {state.title}
        </h3>
        {state.message ? (
          <p className="mt-3 text-sm text-foreground/90">{state.message}</p>
        ) : null}
        <div className="mt-6 flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => settle("discard")}
          >
            Don&rsquo;t save
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => settle("cancel")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => settle("save")}
              autoFocus
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
