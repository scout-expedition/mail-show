"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { UserAvatar, type UserAvatarData } from "@/components/user-avatar";
import type { IconType } from "@/lib/db/enums";

const DEFAULT_AVATAR_COLOR = "#4b8eff";

export type AvatarSavePayload = {
  icon_type: IconType;
  icon_value: string;
  color_hex: string;
};

/**
 * Modal popup that wraps the shared IconPicker with avatar preview + save.
 * Caller decides where the data goes by implementing `onSave`.
 */
export function EditAvatarDialog({
  title,
  initial,
  email,
  onSave,
  onClose,
  onError,
}: {
  title: string;
  initial: UserAvatarData;
  email: string | null;
  onSave: (payload: AvatarSavePayload) => Promise<void>;
  onClose: () => void;
  onError?: (message: string) => void;
}) {
  const [iconType, setIconType] = useState<IconType>(
    initial.avatar_icon_type ?? "animal"
  );
  const [iconValue, setIconValue] = useState<string>(
    initial.avatar_icon_value ?? ""
  );
  const [colorHex, setColorHex] = useState<string>(
    initial.avatar_color_hex ?? DEFAULT_AVATAR_COLOR
  );
  const [pending, startTransition] = useTransition();

  const preview: UserAvatarData = {
    display_name: initial.display_name,
    avatar_icon_type: iconValue ? iconType : null,
    avatar_icon_value: iconValue || null,
    avatar_color_hex: colorHex,
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await onSave({
          icon_type: iconType,
          icon_value: iconValue.trim(),
          color_hex: colorHex,
        });
        onClose();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to save avatar");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>

        <div className="mb-4 flex items-center gap-3">
          <UserAvatar user={preview} email={email} size={48} />
          <div className="text-xs text-muted-foreground">Preview</div>
        </div>

        <div className="rounded-md border border-border bg-accent/10 px-3 py-3">
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
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
