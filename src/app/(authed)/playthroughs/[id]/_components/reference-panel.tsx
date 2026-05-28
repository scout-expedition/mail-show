"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReferenceCityList } from "./reference-city-list";
import { ReferenceCitizenDirectory } from "./reference-citizen-directory";
import { ReferenceMapPopup } from "./reference-map-popup";

type Tab = "map" | "cities" | "citizens";

/** Fixed bottom-left book-icon button that opens a popover with three tabs:
 *  Map, City List, and Citizen Directory. Uses the same click-outside + Escape
 *  pattern as `<PlayMenu>`. */
export function ReferencePanel({ mapImageUrl }: { mapImageUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [mapOpen, setMapOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (popRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "map", label: "Map" },
    { id: "cities", label: "City List" },
    { id: "citizens", label: "Citizen Directory" },
  ];

  return (
    <>
      {/* Trigger button — fixed bottom-left */}
      <div className="fixed bottom-5 left-5 z-40">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open reference panel"
          aria-expanded={open}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/90 shadow-lg backdrop-blur-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            open ? "bg-accent text-foreground" : null
          )}
        >
          <BookOpen size={18} aria-hidden />
        </button>

        {open ? (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Reference panel"
            className="absolute bottom-full left-0 mb-2 w-80 rounded-md border border-border bg-popover shadow-xl"
          >
            {/* Tab bar */}
            <div className="flex border-b border-border">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex-1 px-2 py-2 text-xs font-medium transition-colors",
                    activeTab === tab.id
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="max-h-96 overflow-y-auto p-3">
              {activeTab === "map" ? (
                <div className="flex flex-col gap-2">
                  {mapImageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mapImageUrl}
                        alt="Reference map"
                        className="w-full cursor-pointer rounded-md border border-border object-contain"
                        onClick={() => setMapOpen(true)}
                      />
                      <p className="text-center text-xs text-muted-foreground">
                        Click to enlarge
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4 text-center text-sm text-muted-foreground">
                      <p>No reference map uploaded.</p>
                      <a
                        href="/settings"
                        className="text-xs underline underline-offset-2 hover:text-foreground"
                      >
                        Set one in Settings
                      </a>
                    </div>
                  )}
                </div>
              ) : activeTab === "cities" ? (
                <ReferenceCityList />
              ) : (
                <ReferenceCitizenDirectory />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Full-screen map overlay */}
      {mapOpen ? (
        <ReferenceMapPopup
          mapImageUrl={mapImageUrl}
          onClose={() => setMapOpen(false)}
        />
      ) : null}
    </>
  );
}
