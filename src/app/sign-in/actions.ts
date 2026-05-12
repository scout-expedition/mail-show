"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateEmail } from "@/lib/auth/validation";

function buildRedirect(qs: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const s = params.toString();
  return `/sign-in${s ? `?${s}` : ""}`;
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${host}`;
}

export async function signInWithMagicLink(formData: FormData) {
  const next = String(formData.get("next") ?? "/dashboard");
  const emailCheck = validateEmail(formData.get("email"));
  if (!emailCheck.ok) {
    redirect(buildRedirect({ error: emailCheck.error, next }));
  }

  const supabase = await createSupabaseServerClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email: emailCheck.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  // Treat any failure as "maybe-sent" to avoid leaking which emails are registered.
  // Supabase returns an error when shouldCreateUser:false hits an unknown email.
  if (error) {
    redirect(buildRedirect({ sent: "1", next }));
  }
  redirect(buildRedirect({ sent: "1", next }));
}

export async function signInWithPassword(formData: FormData) {
  const next = String(formData.get("next") ?? "/dashboard");
  const emailCheck = validateEmail(formData.get("email"));
  if (!emailCheck.ok) {
    redirect(buildRedirect({ error: "Invalid email or password", next }));
  }
  const password = String(formData.get("password") ?? "");
  if (!password) {
    redirect(buildRedirect({ error: "Invalid email or password", next }));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: emailCheck.email,
    password,
  });
  if (error) {
    redirect(buildRedirect({ error: "Invalid email or password", next }));
  }
  redirect(next);
}

export async function requestPasswordReset(formData: FormData) {
  const next = String(formData.get("next") ?? "/dashboard");
  const emailCheck = validateEmail(formData.get("email"));

  // Always land on /sign-in?reset=1 — generic banner avoids leaking which
  // emails are registered. We only actually call Supabase when the input
  // looks like a valid email.
  if (emailCheck.ok) {
    const supabase = await createSupabaseServerClient();
    const origin = await siteOrigin();
    await supabase.auth.resetPasswordForEmail(emailCheck.email, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
        "/auth/set-password"
      )}`,
    });
  }

  redirect(buildRedirect({ reset: "1", next }));
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
