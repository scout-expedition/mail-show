"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPassword } from "./actions";

type State =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: string };

export function ChangePasswordSection() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({ status: "idle" });

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await changeOwnPassword(formData);
        setState({ status: "success" });
        formRef.current?.reset();
      } catch (e) {
        setState({
          status: "error",
          error: e instanceof Error ? e.message : "Failed to update password",
        });
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          type="password"
          name="currentPassword"
          id="currentPassword"
          required
          autoComplete="current-password"
          className="max-w-xs"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          type="password"
          name="password"
          id="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="max-w-xs"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          type="password"
          name="confirm"
          id="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="max-w-xs"
        />
      </div>
      {state.status === "success" ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          Password updated.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
