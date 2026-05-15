"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import type { IconType } from "@/lib/db/enums";

export type IconPickerSavePayload = {
  type: IconType;
  value: string;
  color: string;
};

export function IconPickerDialog({
  title = "Edit Icon",
  initialType,
  initialValue,
  initialColor,
  onSave,
  onClose,
}: {
  title?: string;
  initialType: IconType;
  initialValue: string | null;
  initialColor: string;
  onSave: (payload: IconPickerSavePayload) => void;
  onClose: () => void;
}) {
  const [iconType, setIconType] = useState<IconType>(initialType);
  const [iconValue, setIconValue] = useState<string>(initialValue ?? "");
  const [colorHex, setColorHex] = useState<string>(initialColor);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
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
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSave({ type: iconType, value: iconValue.trim(), color: colorHex });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
