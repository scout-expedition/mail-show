"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  canDeleteUser,
  validateEmail,
  validatePassword,
} from "@/lib/auth/validation";
import { ICON_TYPES, type IconType } from "@/lib/db/enums";

function parseAvatarFields(formData: FormData): {
  avatar_icon_type: IconType | null;
  avatar_icon_value: string | null;
  avatar_color_hex: string | null;
} {
  const rawType = String(formData.get("avatar_icon_type") ?? "");
  const rawValue = String(formData.get("avatar_icon_value") ?? "").trim();
  const rawColor = String(formData.get("avatar_color_hex") ?? "").trim();
  const iconType = (ICON_TYPES as readonly string[]).includes(rawType)
    ? (rawType as IconType)
    : null;
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : null;
  return {
    avatar_icon_type: iconType,
    avatar_icon_value: rawValue ? rawValue : null,
    avatar_color_hex: color,
  };
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${host}`;
}

function confirmUrl(origin: string, next: string): string {
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return `${origin}/auth/confirm?next=${encodeURIComponent(safeNext)}`;
}

export type InviteState =
  | { status: "idle" }
  | { status: "success"; email: string }
  | { status: "error"; error: string };

export async function inviteUser(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const check = validateEmail(formData.get("email"));
  if (!check.ok) return { status: "error", error: check.error };

  const origin = await siteOrigin();
  const redirectTo = confirmUrl(origin, "/auth/set-password");

  const service = createSupabaseServiceClient();
  const { error } = await service.auth.admin.inviteUserByEmail(check.email, {
    redirectTo,
  });
  if (error) return { status: "error", error: error.message };

  revalidatePath("/settings");
  return { status: "success", email: check.email };
}

export async function adminResetPassword(formData: FormData) {
  const check = validateEmail(formData.get("email"));
  if (!check.ok) throw new Error(check.error);

  const origin = await siteOrigin();
  const redirectTo = confirmUrl(origin, "/auth/set-password");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(check.email, {
    redirectTo,
  });
  if (error) throw new Error(error.message);
}

export async function adminSendMagicLink(formData: FormData) {
  const check = validateEmail(formData.get("email"));
  if (!check.ok) throw new Error(check.error);

  const origin = await siteOrigin();
  const emailRedirectTo = confirmUrl(origin, "/dashboard");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: check.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
    },
  });
  if (error) throw new Error(error.message);
}

export async function changeOwnPassword(formData: FormData) {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const passwordCheck = validatePassword(
    formData.get("password"),
    formData.get("confirm")
  );
  if (!passwordCheck.ok) throw new Error(passwordCheck.error);

  const supabase = await createSupabaseServerClient();
  const { data: me } = await supabase.auth.getUser();
  const email = me.user?.email;
  if (!email) throw new Error("Not signed in");

  // Verify current password by signing in (refreshes session as a side effect).
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInErr) throw new Error("Current password is incorrect");

  const { error: updateErr } = await supabase.auth.updateUser({
    password: String(formData.get("password")),
  });
  if (updateErr) throw new Error(updateErr.message);
}

export async function updateOwnProfile(formData: FormData) {
  const display_name = String(formData.get("display_name") ?? "").trim();
  const avatar = parseAvatarFields(formData);

  const supabase = await createSupabaseServerClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) throw new Error("Not signed in");

  const merged = {
    ...(me.user.user_metadata ?? {}),
    display_name: display_name || null,
    ...avatar,
  };

  const { error } = await supabase.auth.updateUser({ data: merged });
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

export async function adminUpdateUserDisplayName(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing userId");
  const display_name = String(formData.get("display_name") ?? "").trim();

  const service = createSupabaseServiceClient();
  const { data: existing, error: getErr } =
    await service.auth.admin.getUserById(userId);
  if (getErr) throw new Error(getErr.message);

  const merged = {
    ...(existing.user?.user_metadata ?? {}),
    display_name: display_name || null,
  };

  const { error } = await service.auth.admin.updateUserById(userId, {
    user_metadata: merged,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

export async function adminUpdateUserAvatar(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing userId");
  const avatar = parseAvatarFields(formData);

  const service = createSupabaseServiceClient();
  const { data: existing, error: getErr } =
    await service.auth.admin.getUserById(userId);
  if (getErr) throw new Error(getErr.message);

  const merged = {
    ...(existing.user?.user_metadata ?? {}),
    ...avatar,
  };

  const { error } = await service.auth.admin.updateUserById(userId, {
    user_metadata: merged,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

export async function deleteUser(formData: FormData) {
  const targetUserId = String(formData.get("userId") ?? "");
  if (!targetUserId) throw new Error("Missing userId");

  const server = await createSupabaseServerClient();
  const { data: me } = await server.auth.getUser();
  const currentUserId = me.user?.id;
  if (!currentUserId) throw new Error("Not signed in");
  if (!canDeleteUser(currentUserId, targetUserId)) {
    throw new Error("You can't delete your own account here");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service.auth.admin.deleteUser(targetUserId);
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
}
