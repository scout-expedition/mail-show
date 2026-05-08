"use server";

// Thin re-exports of the unified document actions for the Frameworks tab.
// The pre-rebuild `frameworks/actions.ts` is gone; new callers should
// import from `_shared/document-actions.ts` directly.

export {
  addBlock,
  addBlockVariable,
  addChip,
  addRow,
  createFrameworkDocument,
  createValueInline,
  createVariableInline,
  deleteBlock,
  deleteChip,
  deleteFrameworkDocument,
  deleteRow,
  removeBlockVariable,
  renameDocument,
  saveDocument,
} from "../_shared/document-actions";
