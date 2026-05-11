"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { canDeleteUser, validateEmail } from "@/lib/auth/validation";

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

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const redirectTo = `${protocol}://${host}/auth/callback?next=${encodeURIComponent(
    "/auth/set-password"
  )}`;

  const service = createSupabaseServiceClient();
  const { error } = await service.auth.admin.inviteUserByEmail(check.email, {
    redirectTo,
  });
  if (error) return { status: "error", error: error.message };

  revalidatePath("/settings");
  return { status: "success", email: check.email };
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
