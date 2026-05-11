"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassword } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : "Save password"}
    </Button>
  );
}

export function SetPasswordForm({ error }: { error?: string }) {
  return (
    <form action={setPassword} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          type="password"
          name="password"
          id="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          type="password"
          name="confirm"
          id="confirm"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {error ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
