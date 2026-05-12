"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconPicker } from "@/components/icon-picker";
import { UserAvatar, type UserAvatarData } from "@/components/user-avatar";
import { signOut } from "@/app/sign-in/actions";
import type { IconType } from "@/lib/db/enums";
import { updateOwnProfile } from "./actions";

const DEFAULT_COLOR = "#4b8eff";

export function AccountSection({
  email,
  profile,
}: {
  email: string | null;
  profile: UserAvatarData;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [iconType, setIconType] = useState<IconType>(
    profile.avatar_icon_type ?? "lucide"
  );
  const [iconValue, setIconValue] = useState<string>(
    profile.avatar_icon_value ?? ""
  );
  const [colorHex, setColorHex] = useState<string>(
    profile.avatar_color_hex ?? DEFAULT_COLOR
  );
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; error: string }
  >({ kind: "idle" });

  const preview: UserAvatarData = {
    display_name: displayName.trim() || null,
    avatar_icon_type: iconValue ? iconType : null,
    avatar_icon_value: iconValue || null,
    avatar_color_hex: colorHex,
  };

  function handleSave() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("display_name", displayName.trim());
        fd.set("avatar_icon_type", iconType);
        fd.set("avatar_icon_value", iconValue.trim());
        fd.set("avatar_color_hex", colorHex);
        await updateOwnProfile(fd);
        setStatus({ kind: "success", message: "Profile saved." });
      } catch (e) {
        setStatus({
          kind: "error",
          error: e instanceof Error ? e.message : "Failed to save profile",
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <UserAvatar user={preview} email={email} size={48} />
        <div className="flex flex-1 flex-col">
          <div className="text-sm text-foreground">
            {displayName.trim() || "(no display name)"}
          </div>
          <div className="text-xs text-muted-foreground">
            {email ?? "(no session)"}
          </div>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="account-display-name">Display name</Label>
        <Input
          id="account-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How you appear to others"
          className="max-w-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label>Avatar</Label>
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
      </div>

      {status.kind === "success" ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          {status.message}
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}

      <div>
        <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
