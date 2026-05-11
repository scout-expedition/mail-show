"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithMagicLink, signInWithPassword } from "./actions";

function PrimarySubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function MagicLinkSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      formAction={signInWithMagicLink}
      disabled={pending}
      variant="secondary"
      className="w-full"
    >
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
    <form action={signInWithPassword} className="flex flex-col gap-3">
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          type="password"
          name="password"
          id="password"
          autoComplete="current-password"
          placeholder="Leave empty to use magic link"
        />
      </div>
      {sent ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          If that email is registered, a sign-in link is on its way.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <PrimarySubmit />
      <MagicLinkSubmit />
    </form>
  );
}
