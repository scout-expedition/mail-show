/**
 * Email allow-list gate. Reads from the `allowed_emails` table first, then
 * falls back to ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS env vars for bootstrap.
 * The env fallback lets you sign in the very first admin before the table
 * has any rows.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function envAllowed(normalized: string): boolean {
  const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (allowedEmails.includes(normalized)) return true;
  const domain = normalized.split("@")[1];
  if (domain && allowedDomains.includes(domain)) return true;
  return false;
}

export async function isEmailAllowed(
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] ?? "";

  try {
    const supabase = createSupabaseServiceClient();
    const { data } = await supabase
      .from("allowed_emails")
      .select("kind,value")
      .or(`and(kind.eq.email,value.eq.${normalized}),and(kind.eq.domain,value.eq.${domain})`)
      .limit(1);
    if (data && data.length > 0) return true;
  } catch {
    // Service client not configured — fall through to env bootstrap.
  }

  return envAllowed(normalized);
}
