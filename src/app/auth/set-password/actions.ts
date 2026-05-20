"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/auth/validation";

function buildRedirect(error?: string): string {
  if (!error) return "/auth/set-password";
  const params = new URLSearchParams({ error });
  return `/auth/set-password?${params.toString()}`;
}

export async function setPassword(formData: FormData) {
  const check = validatePassword(formData.get("password"), formData.get("confirm"));
  if (!check.ok) {
    redirect(buildRedirect(check.error));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: String(formData.get("password")),
  });
  if (error) {
    redirect(buildRedirect(error.message));
  }
  redirect("/");
}
