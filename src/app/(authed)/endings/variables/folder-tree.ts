// Shared helper for rendering the variable-inspector / create-variable
// popover's "Folder" <Select>. Builds the indented folder option list
// from a flat array of EndingVariableFolder rows, optionally excluding
// a set of folder ids (and every descendant of each) so the variables
// page can prevent reparenting a folder under itself.

import type { EndingVariableFolder } from "@/lib/db/types";
import type { FolderTreeOption } from "./variable-inspector";

export function buildChildFoldersByParent(
  folders: ReadonlyArray<EndingVariableFolder>
): Map<string | null, EndingVariableFolder[]> {
  const m = new Map<string | null, EndingVariableFolder[]>();
  for (const f of folders) {
    const key = f.parent_folder_id ?? null;
    const list = m.get(key) ?? [];
    list.push(f);
    m.set(key, list);
  }
  for (const list of m.values()) {
    list.sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
  }
  return m;
}

export function buildFolderOptions(
  folders: ReadonlyArray<EndingVariableFolder>,
  excludedIds: ReadonlyArray<string> = []
): FolderTreeOption[] {
  const childFoldersByParent = buildChildFoldersByParent(folders);
  const excluded = new Set<string>(excludedIds);
  const queue: string[] = [...excludedIds];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const child of childFoldersByParent.get(next) ?? []) {
      if (!excluded.has(child.id)) {
        excluded.add(child.id);
        queue.push(child.id);
      }
    }
  }
  const out: FolderTreeOption[] = [];
  function visit(parentId: string | null, depth: number) {
    const children = childFoldersByParent.get(parentId) ?? [];
    for (const f of children) {
      if (excluded.has(f.id)) continue;
      out.push({
        id: f.id,
        label: `${"  ".repeat(depth)}${f.name}`,
      });
      visit(f.id, depth + 1);
    }
  }
  visit(null, 0);
  return out;
}
