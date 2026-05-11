const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidEmail = { ok: true; email: string };
export type EmailError = { ok: false; error: string };

export function validateEmail(value: unknown): ValidEmail | EmailError {
  if (typeof value !== "string") return { ok: false, error: "Email is required" };
  const email = value.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address" };
  return { ok: true, email };
}

export type PasswordError = { ok: false; error: string };
export type ValidPassword = { ok: true };

export function validatePassword(
  password: unknown,
  confirm: unknown
): ValidPassword | PasswordError {
  if (typeof password !== "string" || typeof confirm !== "string") {
    return { ok: false, error: "Password is required" };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (password !== confirm) return { ok: false, error: "Passwords don't match" };
  return { ok: true };
}

export function canDeleteUser(currentUserId: string, targetUserId: string): boolean {
  return currentUserId !== targetUserId;
}
