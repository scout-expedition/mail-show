"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PanelHeader, Spinner } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { EndingDocument } from "@/lib/db/types";
import { createFrameworkDocument } from "../_shared/document-actions";
import { usePresenceContext } from "@/lib/realtime/presence-context";

export function FrameworkList({
  frameworks,
  selectedId,
  onSelect,
}: {
  frameworks: EndingDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const { peers } = usePresenceContext();

  function handleCreate() {
    startTransition(async () => {
      const res = await createFrameworkDocument();
      onSelect(res.id);
    });
  }

  return (
    <aside className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <PanelHeader title="Frameworks" />
        {frameworks.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            None yet.
          </p>
        ) : (
          <ul>
            {frameworks.map((f) => {
              const active = f.id === selectedId;
              // Peers whose presence selection points at this framework
              // — their dot color matches the avatar stack so the user
              // can correlate "person A is in framework X" at a glance.
              const peersOnFramework = peers.filter(
                (p) => p.selection?.payload?.endingFrameworkId === f.id
              );
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(f.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent/40",
                      active && "bg-accent/60 text-accent-foreground"
                    )}
                  >
                    <span className="flex-1 truncate">{f.name ?? "(unnamed)"}</span>
                    {peersOnFramework.length > 0 ? (
                      <span
                        className="inline-flex items-center gap-0.5"
                        aria-label={
                          peersOnFramework.length === 1
                            ? `${peersOnFramework[0].email} is in this framework`
                            : `${peersOnFramework.length} others in this framework`
                        }
                      >
                        {peersOnFramework.slice(0, 3).map((peer) => (
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
                        {peersOnFramework.length > 3 ? (
                          <span
                            className="text-[9px] font-medium tabular-nums text-muted-foreground"
                            title={peersOnFramework
                              .slice(3)
                              .map((p) => p.email)
                              .join(", ")}
                          >
                            +{peersOnFramework.length - 3}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={pending}
      >
        {pending ? (
          <>
            <Spinner />
            Creating…
          </>
        ) : (
          "+ Framework"
        )}
      </Button>
    </aside>
  );
}
