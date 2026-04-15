"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithMagicLink } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Sending…" : "Send magic link"}
    </Button>
  );
}

export function SignInForm({
  next,
  error,
  sent,
}: {
  next?: string;
  error?: string;
  sent?: boolean;
}) {
  return (
    <form action={signInWithMagicLink} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          type="email"
          name="email"
          id="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>
      {sent ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          Check your email for the sign-in link.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
