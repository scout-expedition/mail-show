import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent("Missing auth code")}`, url)
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, url)
    );
  }

  // Defense in depth: if a non-allow-listed email somehow got through, sign them out.
  const email = data.session?.user.email;
  if (!(await isEmailAllowed(email))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL(
        `/sign-in?error=${encodeURIComponent("Email is not on the allow-list")}`,
        url
      )
    );
  }

  return NextResponse.redirect(new URL(next, url));
}
