"use client";

// Inline "+ New variable…" / "+ New value…" forms used by the chip-add
// and header-variable pickers in the frameworks/logic editors. Both
// resolve with the new ids so the caller can immediately reference them
// from the surrounding picker state.

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createEndingVariableInline,
  createEndingVariableValueInline,
} from "../variables/actions";

/** Sentinel value reserved for the "+ New variable…" option in <select>
 *  pickers. Picking it switches the picker into create mode. */
export const CREATE_VARIABLE_SENTINEL = "__create_new_variable__";

/** Sentinel value reserved for the "+ New value…" option in chip-picker
 *  value dropdowns. Picking it switches the value picker into create mode. */
export const CREATE_VALUE_SENTINEL = "__create_new_value__";

export function InlineCreateVariableForm({
  className,
  initialName,
  onCreated,
  onCancel,
}: {
  className?: string;
  initialName?: string;
  onCreated: (result: {
    variableId: string;
    valueId: string;
    name: string;
    firstValue: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [firstValue, setFirstValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedValue = firstValue.trim();
    if (!trimmedName || !trimmedValue) return;
    startTransition(async () => {
      try {
        const ids = await createEndingVariableInline({
          name: trimmedName,
          firstValue: trimmedValue,
        });
        onCreated({
          ...ids,
          name: trimmedName,
          firstValue: trimmedValue,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create.");
      }
    });
  }

  const canSubmit =
    !pending && name.trim().length > 0 && firstValue.trim().length > 0;

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]",
        className
      )}
    >
      <span className="px-1 font-mono uppercase tracking-widest text-[10px] opacity-70">
        New
      </span>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        disabled={pending}
        className="h-7 w-32 border-0 bg-transparent pl-2 pr-1 text-[11px] focus:!ring-0"
      />
      <Input
        value={firstValue}
        onChange={(e) => setFirstValue(e.target.value)}
        placeholder="first value"
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSubmit) {
            e.preventDefault();
            submit();
          }
        }}
        className="h-7 w-32 border-0 bg-transparent pl-2 pr-1 text-[11px] focus:!ring-0"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="ml-auto rounded px-1 text-[11px] text-primary disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        aria-label="Cancel"
        className="opacity-60 hover:opacity-100"
      >
        <X size={10} aria-hidden />
      </button>
      {error ? (
        <span className="basis-full text-[10px] text-destructive">{error}</span>
      ) : null}
    </span>
  );
}

export function InlineCreateValueForm({
  variableId,
  className,
  onCreated,
  onCancel,
}: {
  variableId: string;
  className?: string;
  onCreated: (result: { valueId: string; value: string }) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        const { valueId } = await createEndingVariableValueInline({
          variable_id: variableId,
          value: trimmed,
        });
        onCreated({ valueId, value: trimmed });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create.");
      }
    });
  }

  const canSubmit = !pending && text.trim().length > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]",
        className
      )}
    >
      <span className="px-1 font-mono uppercase tracking-widest text-[10px] opacity-70">
        New value
      </span>
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="value"
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSubmit) {
            e.preventDefault();
            submit();
          }
        }}
        className="h-7 w-32 border-0 bg-transparent pl-2 pr-1 text-[11px] focus:!ring-0"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="ml-auto rounded px-1 text-[11px] text-primary disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        aria-label="Cancel"
        className="opacity-60 hover:opacity-100"
      >
        <X size={10} aria-hidden />
      </button>
      {error ? (
        <span className="basis-full text-[10px] text-destructive">{error}</span>
      ) : null}
    </span>
  );
}
