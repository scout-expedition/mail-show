"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConditionDescription,
  MatchModeConnector,
} from "@/components/condition-description";
import type { SortingRule, SortingRuleCondition } from "@/lib/db/types";
import { duplicateRule } from "./actions";

export function RulesList({
  rules,
  conditionsByRule,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const allOpen = rules.length > 0 && openIds.size === rules.length;

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOpen) setOpenIds(new Set());
    else setOpenIds(new Set(rules.map((r) => r.id)));
  }

  return (
    <div className="flex flex-col gap-2">
      {rules.length > 0 ? (
        <div className="mb-1 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      ) : null}

      {rules.map((r) => (
        <RuleRow
          key={r.id}
          rule={r}
          conditions={conditionsByRule[r.id] ?? []}
          open={openIds.has(r.id)}
          onToggle={() => toggle(r.id)}
        />
      ))}
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No rules yet.
        </p>
      ) : null}
    </div>
  );
}

function RuleRow({
  rule,
  conditions,
  open,
  onToggle,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
  open: boolean;
  onToggle: () => void;
}) {
  const [duplicating, startDuplicate] = useTransition();

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    const fd = new FormData();
    fd.append("id", rule.id);
    startDuplicate(async () => {
      await duplicateRule(fd);
    });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-accent/40"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-mono text-sm"
            aria-label={`Rule ${rule.letter}`}
          >
            {rule.letter}
          </span>
          <span className="text-sm">
            {rule.summary ?? <span className="text-muted-foreground">—</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {rule.destination_slot ? (
            <Badge variant="muted">slot {rule.destination_slot}</Badge>
          ) : null}
          <span
            role="button"
            tabIndex={0}
            onClick={handleDuplicate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleDuplicate(e as unknown as React.MouseEvent);
            }}
            aria-label="Duplicate rule"
            title="Duplicate"
            aria-disabled={duplicating}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <DuplicateIcon />
          </span>
          <span aria-hidden className={open ? "rotate-90" : ""}>
            ›
          </span>
        </div>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {conditions.length === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">
                No conditions yet.
              </span>
              <EditRuleLink id={rule.id} />
            </div>
          ) : (
            conditions.map((c, i) => (
              <div key={c.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-4">
                  <ConditionDescription c={c} />
                  {i === 0 ? <EditRuleLink id={rule.id} /> : null}
                </div>
                {i === 0 && conditions.length > 1 ? (
                  <MatchModeConnector mode={rule.match_mode} />
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function EditRuleLink({ id }: { id: string }) {
  return (
    <Link
      href={`/sorting/rules/${id}`}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 text-xs text-primary hover:underline"
    >
      Edit rule →
    </Link>
  );
}

function DuplicateIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
