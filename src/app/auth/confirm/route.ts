import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Token-hash verification endpoint for Supabase email links (invite, magic
// link, recovery, signup, email change). Email templates must use:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next={{ .RedirectTo }}
// This works for both admin-generated links (invites, dashboard reset) and
// user-initiated flows, since verifyOtp({ token_hash }) doesn't require a
// PKCE code_verifier cookie in the recipient's browser.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next");

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=${encodeURIComponent("Missing or invalid link")}`,
        url
      )
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, url)
    );
  }

  const fallback =
    type === "recovery" || type === "invite" || type === "signup"
      ? "/auth/set-password"
      : "/";
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : fallback;
  return NextResponse.redirect(new URL(next, url));
}
