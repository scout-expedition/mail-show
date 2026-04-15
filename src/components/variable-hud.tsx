import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VARIABLE_LABELS, ZERO_VARIABLES } from "@/lib/playthrough/variables";
import type { PlaythroughVariables } from "@/lib/db/types";

type Vars = Omit<PlaythroughVariables, "playthrough_id">;

/** Compact always-visible readout of tracked variables. */
export function VariableHud({
  vars = ZERO_VARIABLES,
  playthroughName,
  className,
}: {
  vars?: Vars;
  playthroughName?: string | null;
  className?: string;
}) {
  const items: Array<[keyof Vars, string, "muted" | "warning" | "destructive" | "default"]> = [
    ["world_status", "WS", "default"],
    ["demerits", "DM", "warning"],
    ["proletariat", "Pr", "muted"],
    ["gentry", "Gt", "muted"],
    ["epicenter", "Ep", "destructive"],
    ["combined_national", "Nat", "default"],
  ];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {playthroughName ? (
        <Badge variant="secondary" className="uppercase tracking-wide">
          {playthroughName}
        </Badge>
      ) : (
        <Badge variant="muted" className="uppercase tracking-wide">
          no playthrough
        </Badge>
      )}
      <div className="flex items-center gap-1.5 font-mono text-xs">
        {items.map(([k, short, variant]) => (
          <span
            key={k}
            title={VARIABLE_LABELS[k]}
            className={cn(
              "rounded-md border border-border px-1.5 py-0.5",
              "bg-muted/40"
            )}
          >
            <span className="text-muted-foreground">{short}</span>{" "}
            <span
              className={cn(
                variant === "destructive" && vars[k] !== 0 && "text-destructive",
                variant === "warning" && vars[k] !== 0 && "text-warning",
                variant === "default" && vars[k] > 0 && "text-success",
                variant === "default" && vars[k] < 0 && "text-destructive"
              )}
            >
              {vars[k] > 0 ? `+${vars[k]}` : vars[k]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
