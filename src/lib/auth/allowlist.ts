/**
 * Simple email allow-list gate. Reads from ALLOWED_EMAILS and ALLOWED_EMAIL_DOMAINS env vars.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
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
