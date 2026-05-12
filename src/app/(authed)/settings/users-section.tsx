"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import {
  adminResetPassword,
  adminSendMagicLink,
  deleteUser,
  inviteUser,
  type InviteState,
} from "./actions";

export type UserRow = {
  id: string;
  email: string;
  lastSignInAt: string | null;
  createdAt: string;
};

type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; error: string };

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
          return (
            <li
              key={u.id}
              className="flex items-center gap-3 px-3 py-2 font-mono text-xs"
            >
              <div className="flex-1 truncate">
                <div className="text-foreground">{u.email}</div>
                <div className="text-muted-foreground">
                  last sign-in: {fmt(u.lastSignInAt)} · created: {fmt(u.createdAt)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  runEmailAction(
                    u,
                    adminSendMagicLink,
                    `Magic link sent to ${u.email}.`
                  )
                }
                className="text-muted-foreground hover:text-foreground"
              >
                Send magic link
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  runEmailAction(
                    u,
                    adminResetPassword,
                    `Reset link sent to ${u.email}.`
                  )
                }
                className="text-muted-foreground hover:text-foreground"
              >
                Send reset link
              </Button>
              {isSelf ? (
                <span className="text-muted-foreground">you</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => onDelete(u)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Delete
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {dialog}
    </div>
  );
}
