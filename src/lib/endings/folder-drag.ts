// Pure helpers backing the drag-and-drop UX on /endings/variables. The
// editor passes its local mirror of folders here so we can answer cycle
// questions without going to the server. The DB cycle trigger and the
// server-action cycle check (in actions.ts) are the authoritative wall;
// these client predicates exist to suppress invalid hover highlights
// before drop, so the user can't even visually request an invalid move.

export type FolderLike = {
  id: string;
  parent_folder_id: string | null;
};

/**
 * Would moving the dragged folder under `targetParentId` create a cycle?
 *
 * A folder cannot become its own ancestor: dropping a folder onto itself,
 * onto a child, or anywhere in its own subtree is rejected. Walks the
 * ancestor chain of `targetParentId` and returns false if it encounters
 * `draggedFolderId`.
 *
 * `targetParentId === null` means "root level", which is always valid.
 */
export function isValidFolderDropTarget(
  folders: ReadonlyArray<FolderLike>,
  draggedFolderId: string,
  targetParentId: string | null
): boolean {
  if (targetParentId === null) return true;
  if (targetParentId === draggedFolderId) return false;
  // Walk up from the proposed parent; if we find ourselves, the move
  // would put us under our own descendant.
  let cursor: string | null = targetParentId;
  // Bound the loop length so a corrupt FK chain can't spin forever.
  const limit = folders.length + 1;
  for (let i = 0; i < limit; i++) {
    if (cursor === null) return true;
    if (cursor === draggedFolderId) return false;
    const next = folders.find((f) => f.id === cursor);
    if (!next) return true; // stale id — let the server be the final word
    cursor = next.parent_folder_id;
  }
  return true;
}
