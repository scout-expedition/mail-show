"use client";

// Sidebar day picker for the Morning Reports page. Modeled on the endings
// framework-list: a panel of selectable rows with peer-presence dots.

import { PanelHeader } from "@/components/panel";
import { cn } from "@/lib/utils";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import type { Day } from "@/lib/db/types";

export function DayList({
  days,
  selectedId,
  onSelect,
}: {
  days: Day[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { peers } = usePresenceContext();

  return (
    <aside className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <PanelHeader title="Days" />
        {days.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No days yet.
          </p>
        ) : (
          <ul>
            {days.map((d) => {
              const active = d.id === selectedId;
              const peersHere = peers.filter(
                (p) => p.selection?.payload?.morningReportDayId === d.id
              );
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(d.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent/40",
                      active && "bg-accent/60 text-accent-foreground"
                    )}
                  >
                    <span className="font-mono text-xs">{d.identifier}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {d.name ?? ""}
                    </span>
                    {peersHere.length > 0 ? (
                      <span className="inline-flex items-center gap-0.5">
                        {peersHere.slice(0, 3).map((peer) => (
                          <span
                            key={peer.userId}
                            className="rounded-full"
                            style={{
                              width: 6,
                              height: 6,
                              backgroundColor:
                                peer.profile?.avatarColorHex ?? peer.color,
                            }}
                            title={peer.email}
                          />
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
