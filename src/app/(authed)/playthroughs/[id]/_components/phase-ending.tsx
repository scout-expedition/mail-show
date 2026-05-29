"use client";

import type { PlaythroughVariables } from "@/lib/db/types";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

export function PhaseEnding({
  frameworkName,
  paragraphs,
  vars,
}: {
  frameworkName: string | null;
  paragraphs: string[];
  vars: PlaythroughVariables | null;
}) {
  const noMatch = paragraphs.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Ending
        </div>
        {frameworkName ? (
          <p className="text-sm text-muted-foreground/70">
            Framework:{" "}
            <span className="font-medium text-foreground">{frameworkName}</span>
          </p>
        ) : null}
      </div>

      {noMatch ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
          <p className="text-sm font-medium text-destructive">
            No ending matched
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The framework selection logic returned no result for the current
            variable values. Check the ending configuration.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-6">
          <div className="prose prose-sm prose-invert max-w-none">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

      {vars ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Final Variables
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {(
              [
                "world_status",
                "demerits",
                "proletariat",
                "gentry",
                "epicenter",
                "folos",
                "emberlyn",
                "spokgrad",
                "pelico",
                "combined_national",
              ] as const
            ).map((key) => {
              const value = vars[key];
              const label = VARIABLE_LABELS[key];
              return (
                <div
                  key={key}
                  className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="font-mono text-[10px] text-muted-foreground truncate">
                    {label}
                  </span>
                  <span
                    className={
                      value > 0
                        ? "font-mono text-sm font-semibold text-green-400"
                        : value < 0
                          ? "font-mono text-sm font-semibold text-red-400"
                          : "font-mono text-sm font-semibold text-muted-foreground"
                    }
                  >
                    {value > 0 ? "+" : ""}
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
