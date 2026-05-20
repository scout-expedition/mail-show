import { describe, expect, it } from "vitest";
import { isValidFolderDropTarget, type FolderLike } from "./folder-drag";

// A small folder tree used by the cycle-guard tests:
//
//   root
//   ├── A
//   │   ├── A1
//   │   │   └── A1a
//   │   └── A2
//   └── B
const TREE: FolderLike[] = [
  { id: "A", parent_folder_id: null },
  { id: "A1", parent_folder_id: "A" },
  { id: "A1a", parent_folder_id: "A1" },
  { id: "A2", parent_folder_id: "A" },
  { id: "B", parent_folder_id: null },
];

describe("isValidFolderDropTarget", () => {
  it("allows a folder to move to root", () => {
    expect(isValidFolderDropTarget(TREE, "A1", null)).toBe(true);
  });

  it("rejects dropping a folder onto itself", () => {
    expect(isValidFolderDropTarget(TREE, "A", "A")).toBe(false);
  });

  it("rejects dropping a folder onto its direct child", () => {
    expect(isValidFolderDropTarget(TREE, "A", "A1")).toBe(false);
  });

  it("rejects dropping a folder onto a deep descendant", () => {
    expect(isValidFolderDropTarget(TREE, "A", "A1a")).toBe(false);
  });

  it("allows moving into a sibling subtree", () => {
    expect(isValidFolderDropTarget(TREE, "A1", "B")).toBe(true);
  });

  it("allows moving a leaf into its own parent (no-op move is still valid)", () => {
    expect(isValidFolderDropTarget(TREE, "A1a", "A1")).toBe(true);
  });

  it("treats unknown parent ids as valid (server / DB is the final word)", () => {
    expect(isValidFolderDropTarget(TREE, "A", "ghost-parent-id")).toBe(true);
  });

  it("is robust against a corrupt FK chain", () => {
    // C → D → C is a cycle that shouldn't exist post-trigger but if it
    // somehow appeared in stale local state we must not spin forever.
    const corrupt: FolderLike[] = [
      { id: "C", parent_folder_id: "D" },
      { id: "D", parent_folder_id: "C" },
    ];
    expect(() => isValidFolderDropTarget(corrupt, "X", "C")).not.toThrow();
  });
});
