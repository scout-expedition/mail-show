"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";

/** Full-screen modal overlay that renders the reference map image.
 *  If `mapImageUrl` is null, shows an empty-state prompt linking to /settings.
 *  Closes on Escape key or clicking outside the image. */
export function ReferenceMapPopup({
  mapImageUrl,
  onClose,
}: {
  mapImageUrl: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close map"
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
      >
        <X size={16} aria-hidden />
      </button>

      {/* Content — stop propagation so clicking the image doesn't close */}
      <div
        className="max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {mapImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapImageUrl}
            alt="Reference map"
            className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-popover px-8 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No reference map uploaded — set one in Settings.
            </p>
            <Link
              href="/settings"
              className="text-sm underline underline-offset-2 hover:text-foreground"
              onClick={onClose}
            >
              Go to Settings
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
