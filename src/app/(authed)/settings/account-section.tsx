"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditAvatarDialog } from "@/components/edit-avatar-dialog";
import { UserAvatar, type UserAvatarData } from "@/components/user-avatar";
import { signOut } from "@/app/sign-in/actions";
import { updateOwnProfile } from "./actions";

export function AccountSection({
  email,
  profile,
}: {
  email: string | null;
  profile: UserAvatarData;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [avatar, setAvatar] = useState<UserAvatarData>(profile);
  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; error: string }
  >({ kind: "idle" });

  function persist(next: {
    display_name: string;
    avatar: UserAvatarData;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("display_name", next.display_name.trim());
          fd.set("avatar_icon_type", next.avatar.avatar_icon_type ?? "lucide");
          fd.set("avatar_icon_value", next.avatar.avatar_icon_value ?? "");
          fd.set("avatar_color_hex", next.avatar.avatar_color_hex ?? "");
          await updateOwnProfile(fd);
          setStatus({ kind: "success", message: "Profile saved." });
          resolve();
        } catch (e) {
          const error =
            e instanceof Error ? e.message : "Failed to save profile";
          setStatus({ kind: "error", error });
          reject(new Error(error));
        }
      });
    });
  }

  function handleSaveName() {
    void persist({ display_name: displayName, avatar });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowAvatarDialog(true)}
          aria-label="Edit avatar"
          className="rounded-full transition-shadow hover:ring-2 hover:ring-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <UserAvatar user={avatar} email={email} size={48} />
        </button>
        <div className="flex flex-1 flex-col">
          <div className="text-sm text-foreground">
            {avatar.display_name ?? displayName.trim() ?? "(no display name)"}
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

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="account-display-name">Display name</Label>
          <Input
            id="account-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How you appear to others"
            className="max-w-sm"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleSaveName}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
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

      {showAvatarDialog ? (
        <EditAvatarDialog
          title="Your avatar"
          initial={avatar}
          email={email}
          onClose={() => setShowAvatarDialog(false)}
          onError={(error) => setStatus({ kind: "error", error })}
          onSave={async ({ icon_type, icon_value, color_hex }) => {
            const nextAvatar: UserAvatarData = {
              display_name: avatar.display_name,
              avatar_icon_type: icon_value ? icon_type : null,
              avatar_icon_value: icon_value || null,
              avatar_color_hex: color_hex,
            };
            await persist({ display_name: displayName, avatar: nextAvatar });
            setAvatar(nextAvatar);
          }}
        />
      ) : null}
    </div>
  );
}
