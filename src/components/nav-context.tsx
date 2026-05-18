"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type NavState = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const NavStateContext = createContext<NavState | null>(null);

/**
 * Holds the navigation drawer's open/closed state so the toggle button can
 * live anywhere in the tree (e.g. inline in a page's header) and still
 * control the same drawer. Wraps the entire authed shell.
 */
export function NavStateProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const toggle = useCallback(() => setOpenState((v) => !v), []);
  return (
    <NavStateContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </NavStateContext.Provider>
  );
}

export function useNavState(): NavState {
  const ctx = useContext(NavStateContext);
  if (!ctx) {
    throw new Error("useNavState must be used within NavStateProvider");
  }
  return ctx;
}
