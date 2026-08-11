"use client";

import { AlertTriangle } from "lucide-react";
import type { Destination } from "@/lib/rules/destination";
import { RulePill } from "../rules/rule-pill";
import { SlotPill } from "../rules/slot-pill";

/**
 * Where a letter lands, as the table and the panel both render it: the winning
 * rule's pill next to its slot. A rule that matched but names no destination
 * reads as a dash with an explanation; equal-precedence rules that disagree
 * read as a warning naming both, because the show can't answer the question
 * either until an author breaks the tie.
 */
export function DestinationCell({
  destination,
  size = "sm",
}: {
  destination: Destination;
  size?: "sm" | "md";
}) {
  if (destination.status === "none") {
    return (
      <span className="text-muted-foreground" title="No active rule matches this letter">
        —
      </span>
    );
  }

  if (destination.status === "unassigned") {
    return (
      <span
        className="flex items-center gap-1.5"
        title={`Rule ${destination.rule.letter} matches but has no destination slot`}
      >
        <RulePill letter={destination.rule.letter} color={destination.rule.color_hex} />
        <span className="text-muted-foreground">—</span>
      </span>
    );
  }

  if (destination.status === "conflict") {
    const letters = destination.rules.map((r) => r.letter).join(" / ");
    return (
      <span
        className="flex items-center gap-1.5 text-warning"
        title={`Rules ${letters} were implemented on the same day and disagree about the destination`}
      >
        <AlertTriangle size={13} aria-hidden />
        <span className="font-mono text-xs">{letters}</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <RulePill letter={destination.rule.letter} color={destination.rule.color_hex} />
      <SlotPill
        slot={destination.slot}
        reporting={destination.routesToReporting}
        size={size}
      />
    </span>
  );
}
