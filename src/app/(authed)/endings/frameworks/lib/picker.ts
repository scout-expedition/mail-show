// Tracks how many chip pickers are open across the editor tree. The Save
// button reads from this so an author can't lose a half-typed chip by
// clicking Save before the ✓ confirm.

import { createContext } from "react";

export interface PickerContext {
  /** Total number of pickers currently in the open state. */
  openCount: number;
  /** Tell the editor a picker just opened. */
  register: () => void;
  /** Tell the editor a picker just closed (committed or cancelled). */
  unregister: () => void;
}

export const PickerCtx = createContext<PickerContext>({
  openCount: 0,
  register: () => {},
  unregister: () => {},
});
