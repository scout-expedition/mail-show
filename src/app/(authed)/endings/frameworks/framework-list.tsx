"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PanelHeader, Spinner } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { EndingFramework } from "@/lib/db/types";
import { createEndingFramework } from "./actions";

export function FrameworkList({
  frameworks,
  selectedId,
  onSelect,
}: {
  frameworks: EndingFramework[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const res = await createEndingFramework();
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
                    <span className="truncate">{f.name}</span>
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
