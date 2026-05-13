"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type BreadcrumbContextValue = {
  /** Page-supplied breadcrumb extension beyond the pathname-derived base.
   *  e.g. ["Cult Takeover"] for the currently-selected framework. */
  extension: string[];
  setExtension: (segments: string[]) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  extension: [],
  setExtension: () => {},
});

/**
 * Wraps the authed app in a shared breadcrumb-extension state. Pages call
 * `useBreadcrumbExtension(segments)` to publish what they're "drilled into"
 * (e.g. the selected framework name) so the AppPresence avatar stack can
 * include those segments in peers' hover popups.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [extension, setExtensionState] = useState<string[]>([]);

  // Stabilize identity by serializing — pages pass freshly-built arrays on
  // every render, but we only want to bump state when contents actually change.
  const setExtension = useCallback((segments: string[]) => {
    setExtensionState((prev) => {
      if (
        prev.length === segments.length &&
        prev.every((s, i) => s === segments[i])
      ) {
        return prev;
      }
      return segments;
    });
  }, []);

  const value = useMemo<BreadcrumbContextValue>(
    () => ({ extension, setExtension }),
    [extension, setExtension]
  );

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/**
 * Push a breadcrumb extension while the calling component is mounted. Clears
 * on unmount. Safe to call without the provider — falls through to the no-op
 * default context.
 *
 * Pages with sub-selections (e.g. "the selected framework is Cult Takeover")
 * call this with the segment array — it'll appear after the pathname-derived
 * base segments in peers' hover popups.
 */
export function useBreadcrumbExtension(segments: string[]) {
  const { setExtension } = useContext(BreadcrumbContext);
  const key = JSON.stringify(segments);
  useEffect(() => {
    setExtension(JSON.parse(key) as string[]);
    return () => setExtension([]);
  }, [key, setExtension]);
}

/** Read the current breadcrumb extension (consumer-side hook). */
export function useBreadcrumbContext(): BreadcrumbContextValue {
  return useContext(BreadcrumbContext);
}
