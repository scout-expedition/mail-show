"use client";

// Folder-aware variable picker rendered next to the existing
// VariableOptionList. The latter stays as the narrow listbox used by
// the inspection-letters action picker (variables only). This panel
// handles the richer endings frameworks/logic surfaces:
//
//   - Empty query → render the navigation level at `path` (categories,
//     folders, variables, plus a "← Back" row when nested + a "+ New
//     variable…" row at the end).
//   - Typing → flat search list across the entire tree (folders +
//     categories + variables). Caller is responsible for clearing
//     `path` when transitioning to search if it wants to "reset" the
//     nav, but the panel itself doesn't care — it just renders
//     whatever items it receives.
//
// The caller (mention-trigger-plugin, AddHeaderVariablePicker popover)
// owns keyboard handling, click-outside, and path / query / activeIndex
// state. This component is purely presentational; it forwards clicks
// and hovers up to the caller.

import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { ChevronLeft, Folder, FolderTree, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import {
  filterPickerTree,
  nodesAtPath,
  type PickerNode,
} from "@/lib/endings/variable-categories";
import type { VariableState } from "@/lib/endings/block-state";
import type { EndingVariableKind } from "@/lib/db/enums";

const KIND_LABEL: Record<EndingVariableKind, string> = {
  text: "text",
  number_ref: "number",
  aggregate_ref: "aggregate",
};

/** One row in the rendered list. */
export type PickerItem =
  | { kind: "back" }
  | { kind: "category"; id: string; label: string; childCount: number }
  | { kind: "folder"; id: string; label: string; childCount: number }
  | { kind: "variable"; id: string; variable: VariableState }
  | { kind: "create" };

/**
 * Pure: build the flat row list the panel should render right now.
 * `path` is honored only when `query` is empty — searching is always
 * tree-wide.
 */
export function buildPickerItems(
  tree: ReadonlyArray<PickerNode>,
  path: ReadonlyArray<string>,
  query: string,
  options?: { includeCreate?: boolean }
): PickerItem[] {
  const includeCreate = options?.includeCreate ?? true;
  const out: PickerItem[] = [];
  const flat = filterPickerTree(tree, query);
  if (flat) {
    for (const node of flat) out.push(nodeToItem(node));
    if (includeCreate) out.push({ kind: "create" });
    return out;
  }
  const level = nodesAtPath(tree, path) ?? tree;
  if (path.length > 0) out.push({ kind: "back" });
  for (const node of level) out.push(nodeToItem(node));
  if (includeCreate) out.push({ kind: "create" });
  return out;
}

function nodeToItem(node: PickerNode): PickerItem {
  if (node.type === "variable") {
    return { kind: "variable", id: node.id, variable: node.variable };
  }
  return {
    kind: node.type,
    id: node.id,
    label: node.label,
    childCount: node.children.length,
  };
}

export interface VariablePickerPanelProps {
  items: ReadonlyArray<PickerItem>;
  activeIndex: number;
  onChangeActiveIndex: (i: number) => void;
  /** Fires for any row click. Caller decides what each row does. */
  onCommitItem: (item: PickerItem) => void;
  /** Optional header label (e.g. the current folder/category name when
   *  drilled in). */
  headerLabel?: string | null;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export function VariablePickerPanel({
  items,
  activeIndex,
  onChangeActiveIndex,
  onCommitItem,
  headerLabel,
  ariaLabel,
  className,
  style,
}: VariablePickerPanelProps) {
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (items.length === 0) {
    return (
      <div
        style={style}
        className={cn(
          "rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg",
          className
        )}
      >
        No matches.
      </div>
    );
  }

  return (
    <div
      style={style}
      className={cn(
        "flex flex-col rounded-md border border-border bg-popover text-xs shadow-lg",
        className
      )}
    >
      {headerLabel ? (
        <div className="border-b border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          {headerLabel}
        </div>
      ) : null}
      <ul
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="max-h-64 overflow-y-auto py-1"
      >
        {items.map((item, i) => {
          const isActive = i === activeIndex;
          const showDivider =
            i > 0 &&
            (kindGroup(item) !== kindGroup(items[i - 1]) ||
              item.kind === "create" ||
              items[i - 1].kind === "back");
          return (
            <Fragment key={itemKey(item, i)}>
              {showDivider ? (
                <li
                  role="separator"
                  aria-hidden
                  className="my-1 border-t border-border/60"
                />
              ) : null}
              <li
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="option"
                aria-selected={isActive}
                // For variable rows we dispatch on pointerdown — the
                // pill insertion needs the editor's selection intact
                // before the click event fires (preventDefault stops
                // the browser's default focus / window-selection
                // change so the editor's caret stays in the `@query`
                // run). pointerdown (rather than mousedown) fires for
                // mouse, touch, and pen alike, so touch users aren't
                // silently dropped. For navigation rows (back /
                // category / folder / create) we dispatch on click
                // instead, which is the more forgiving event for
                // click-then-drag interactions and works for keyboard
                // activation through the option list as well.
                onPointerDown={(e) => {
                  if (item.kind !== "variable") return;
                  e.preventDefault();
                  onCommitItem(item);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  if (item.kind !== "variable") onCommitItem(item);
                }}
                onMouseEnter={() => onChangeActiveIndex(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2 py-1",
                  isActive && "bg-accent/60"
                )}
              >
                <ItemContent item={item} />
              </li>
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

function ItemContent({ item }: { item: PickerItem }) {
  if (item.kind === "back") {
    return (
      <>
        <ChevronLeft
          size={12}
          aria-hidden
          className="shrink-0 text-muted-foreground"
        />
        <span className="flex-1 truncate text-muted-foreground">Back</span>
      </>
    );
  }
  if (item.kind === "create") {
    return (
      <>
        <Plus size={12} aria-hidden className="shrink-0 text-primary" />
        <span className="flex-1 truncate text-primary">New variable…</span>
      </>
    );
  }
  if (item.kind === "category" || item.kind === "folder") {
    const Icon = item.kind === "folder" ? Folder : FolderTree;
    return (
      <>
        <Icon
          size={12}
          aria-hidden
          className="shrink-0 text-muted-foreground/80"
        />
        <span className="flex-1 truncate text-foreground">{item.label}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
          {item.childCount}
        </span>
      </>
    );
  }
  const v = item.variable;
  const color = v.color_hex ?? paletteColor(v.color_index);
  return (
    <>
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 truncate text-foreground">{v.name}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {KIND_LABEL[v.kind]}
      </span>
    </>
  );
}

// Group key used to insert dividers between dissimilar rows.
function kindGroup(item: PickerItem): string {
  switch (item.kind) {
    case "back":
      return "nav";
    case "category":
      return "category";
    case "folder":
      return "folder";
    case "variable":
      return `var:${item.variable.kind}`;
    case "create":
      return "create";
  }
}

function itemKey(item: PickerItem, i: number): string {
  switch (item.kind) {
    case "back":
      return "back";
    case "create":
      return "create";
    default:
      return `${item.kind}:${item.id}:${i}`;
  }
}
