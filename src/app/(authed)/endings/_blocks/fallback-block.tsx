"use client";

import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { BlockState } from "@/lib/endings/block-state";
import type { EndingDocument } from "@/lib/db/types";

/**
 * Pinned at the bottom of the framework_selection document. Returns the
 * configured framework when the rest of the logic flow above doesn't end
 * in a result. Cannot be deleted, moved, or sit alongside other fallback
 * blocks (DB partial unique enforces one per document).
 */
export function FallbackBlock({
  block,
  frameworks,
  onChange,
}: {
  block: BlockState;
  frameworks: EndingDocument[];
  onChange: (result_value: string | null) => void;
}) {
  const frameworkDocs = frameworks.filter((f) => f.kind === "framework");
  return (
    <section className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3">
      <Label className="mb-1 block text-[11px] uppercase tracking-wide">
        Fallback ending
      </Label>
      <p className="mb-2 text-[11px] text-muted-foreground">
        If nothing above resolves to a framework, return this one.
      </p>
      <Select
        value={block.result_value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 w-auto min-w-[240px]"
      >
        <option value="">— pick a framework —</option>
        {frameworkDocs.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name ?? "(unnamed)"}
          </option>
        ))}
      </Select>
    </section>
  );
}
