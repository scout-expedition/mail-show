"use client";

import { useMemo, useState, useTransition } from "react";
import { IconPicker } from "@/components/icon-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { IconType } from "@/lib/db/enums";
import type { Storyline } from "@/lib/db/types";
import { createStorylineWithFields } from "./actions";

function nextUnusedAbbreviation(storylines: Storyline[]): string {
  const used = new Set(
    storylines.map((s) => (s.abbreviation ?? "").toUpperCase())
  );
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    if (!used.has(letter)) return letter;
  }
  return "X";
}

export function AddStorylineDialog({
  storylines,
}: {
  storylines: Storyline[];
}) {
  const [open, setOpen] = useState(false);
  const defaultAbbr = useMemo(
    () => nextUnusedAbbreviation(storylines),
    [storylines]
  );

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        + Storyline
      </Button>
    );
  }
  return (
    <Dialog onClose={() => setOpen(false)} defaultAbbr={defaultAbbr} />
  );
}

function Dialog({
  onClose,
  defaultAbbr,
}: {
  onClose: () => void;
  defaultAbbr: string;
}) {
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState(defaultAbbr);
  const [description, setDescription] = useState("");
  const [iconType, setIconType] = useState<IconType>("lucide");
  const [iconValue, setIconValue] = useState<string>("");
  const [colorHex, setColorHex] = useState("#4b8eff");
  const [pending, startTransition] = useTransition();

  const canSubmit =
    name.trim().length > 0 && abbreviation.trim().length > 0 && !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      await createStorylineWithFields({
        name,
        abbreviation,
        description: description.trim() || null,
        icon_type: iconType,
        icon_value: iconValue.trim() || null,
        color_hex: colorHex,
      });
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New storyline"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          New storyline
        </h3>
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-4 flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
              required
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Abbr</Label>
            <Input
              value={abbreviation}
              onChange={(e) =>
                setAbbreviation(e.target.value.toUpperCase().slice(0, 1))
              }
              maxLength={1}
              required
              className="h-8 text-center font-mono uppercase"
            />
          </div>
          <div className="col-span-6 flex flex-col gap-1">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className="mt-3">
          <IconPicker
            initialType={iconType}
            initialValue={iconValue || null}
            emitHiddenFields={false}
            onChange={(next) => {
              setIconType(next.type);
              setIconValue(next.value);
            }}
            color={colorHex}
            onColorChange={setColorHex}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {pending ? "Creating…" : "Create storyline"}
          </Button>
        </div>
      </form>
    </div>
  );
}
