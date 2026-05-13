"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditAvatarDialog } from "@/components/edit-avatar-dialog";
import { OverflowMenu, type OverflowMenuItem } from "@/components/panel";
import { UserAvatar, type UserAvatarData } from "@/components/user-avatar";
import { useConfirm } from "@/components/confirm-dialog";
import {
  adminResetPassword,
  adminSendMagicLink,
  adminUpdateUserAvatar,
  adminUpdateUserDisplayName,
  deleteUser,
  inviteUser,
  type InviteState,
} from "./actions";

export type UserRow = {
  id: string;
  email: string;
  lastSignInAt: string | null;
  createdAt: string;
  profile: UserAvatarData;
};

type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; error: string };

type EditState =
  | { kind: "none" }
  | { kind: "name"; user: UserRow }
  | { kind: "avatar"; user: UserRow };

const initialInvite: InviteState = { status: "idle" };

function fmt(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

export function UsersSection({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string | null;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteUser,
    initialInvite
  );
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  const [edit, setEdit] = useState<EditState>({ kind: "none" });

  async function onDelete(user: UserRow) {
    const ok = await confirm({
      title: "Delete user?",
      message: `${user.email} will lose access immediately. This can't be undone.`,
      confirmLabel: "Delete user",
      intent: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("userId", user.id);
        await deleteUser(fd);
        setActionState({ status: "success", message: `${user.email} deleted.` });
      } catch (e) {
        setActionState({
          status: "error",
          error: e instanceof Error ? e.message : "Failed to delete user",
        });
      }
    });
  }

  function runEmailAction(
    user: UserRow,
    action: (fd: FormData) => Promise<void>,
    successMessage: string
  ) {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("email", user.email);
        await action(fd);
        setActionState({ status: "success", message: successMessage });
      } catch (e) {
        setActionState({
          status: "error",
          error: e instanceof Error ? e.message : "Action failed",
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <form action={inviteAction} className="flex gap-2">
        <Input
          type="email"
          name="email"
          placeholder="invitee@example.com"
          required
          autoComplete="off"
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={invitePending}>
          {invitePending ? "Sending…" : "Send invite"}
        </Button>
      </form>

      {inviteState.status === "success" ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          Invite sent to {inviteState.email}.
        </p>
      ) : null}
      {inviteState.status === "error" ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {inviteState.error}
        </p>
      ) : null}

      {actionState.status === "success" ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          {actionState.message}
        </p>
      ) : null}
      {actionState.status === "error" ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {actionState.error}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {users.map((u) => {
          const isSelf = currentUserId === u.id;
          const items: OverflowMenuItem[] = [
            {
              label: "Set display name",
              onClick: () => setEdit({ kind: "name", user: u }),
            },
            {
              label: "Set avatar",
              onClick: () => setEdit({ kind: "avatar", user: u }),
            },
            { divider: true },
            {
              label: "Send magic link",
              onClick: () =>
                runEmailAction(
                  u,
                  adminSendMagicLink,
                  `Magic link sent to ${u.email}.`
                ),
              disabled: pending,
            },
            {
              label: "Send reset link",
              onClick: () =>
                runEmailAction(
                  u,
                  adminResetPassword,
                  `Reset link sent to ${u.email}.`
                ),
              disabled: pending,
            },
            ...(isSelf
              ? []
              : ([
                  { divider: true },
                  {
                    label: "Delete user",
                    onClick: () => onDelete(u),
                    intent: "destructive" as const,
                    disabled: pending,
                  },
                ] satisfies OverflowMenuItem[])),
          ];
          return (
            <li
              key={u.id}
              className="flex items-center gap-3 px-3 py-2 text-xs"
            >
              <UserAvatar user={u.profile} email={u.email} size={32} />
              <div className="flex-1 truncate">
                <div className="font-mono text-foreground">
                  {u.profile.display_name ?? u.email}
                  {u.profile.display_name ? (
                    <span className="ml-2 text-muted-foreground">
                      {u.email}
                    </span>
                  ) : null}
                  {isSelf ? (
                    <span className="ml-2 text-muted-foreground">(you)</span>
                  ) : null}
                </div>
                <div className="font-mono text-muted-foreground">
                  last sign-in: {fmt(u.lastSignInAt)} · created:{" "}
                  {fmt(u.createdAt)}
                </div>
              </div>
              <OverflowMenu items={items} />
            </li>
          );
        })}
      </ul>

      {edit.kind === "name" ? (
        <DisplayNameDialog
          user={edit.user}
          onClose={() => setEdit({ kind: "none" })}
          onResult={(state) => setActionState(state)}
        />
      ) : null}
      {edit.kind === "avatar" ? (
        <EditAvatarDialog
          title={`Avatar — ${edit.user.email}`}
          initial={edit.user.profile}
          email={edit.user.email}
          onClose={() => setEdit({ kind: "none" })}
          onError={(error) => setActionState({ status: "error", error })}
          onSave={async ({ icon_type, icon_value, color_hex }) => {
            const fd = new FormData();
            fd.set("userId", edit.user.id);
            fd.set("avatar_icon_type", icon_type);
            fd.set("avatar_icon_value", icon_value);
            fd.set("avatar_color_hex", color_hex);
            await adminUpdateUserAvatar(fd);
            setActionState({
              status: "success",
              message: `Avatar updated for ${edit.user.email}.`,
            });
          }}
        />
      ) : null}

      {dialog}
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
        {children}
      </div>
    </div>
  );
}

function DisplayNameDialog({
  user,
  onClose,
  onResult,
}: {
  user: UserRow;
  onClose: () => void;
  onResult: (state: ActionState) => void;
}) {
  const [value, setValue] = useState(user.profile.display_name ?? "");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("userId", user.id);
        fd.set("display_name", value.trim());
        await adminUpdateUserDisplayName(fd);
        onResult({
          status: "success",
          message: `Display name updated for ${user.email}.`,
        });
        onClose();
      } catch (e) {
        onResult({
          status: "error",
          error:
            e instanceof Error ? e.message : "Failed to update display name",
        });
      }
    });
  }

  return (
    <DialogShell title={`Display name — ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-display-name">Display name</Label>
          <Input
            id="admin-display-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="(leave blank to clear)"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
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
    </DialogShell>
  );
}

