import { notFound } from "next/navigation";
import { profileFromMetadata } from "@/lib/auth/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Day,
  Playthrough,
  PlaythroughVariables,
} from "@/lib/db/types";
import { PlayModeShell } from "./_components/play-mode-shell";

export default async function PlaythroughDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: pData }, { data: me }] = await Promise.all([
    supabase.from("playthroughs").select("*").eq("id", id).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!pData) notFound();
  const playthrough = pData as Playthrough;

  const [{ data: dayData }, { data: varsData }] = await Promise.all([
    playthrough.current_day_id
      ? supabase
          .from("days")
          .select("*")
          .eq("id", playthrough.current_day_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("playthrough_variables")
      .select("*")
      .eq("playthrough_id", id)
      .maybeSingle(),
  ]);
  const currentDay = (dayData as Day | null) ?? null;
  const vars = (varsData as PlaythroughVariables | null) ?? null;

  const user = me.user;
  const profile = user ? profileFromMetadata(user.user_metadata) : null;

  return (
    <PlayModeShell
      playthrough={playthrough}
      currentDay={currentDay}
      vars={vars}
      currentUserId={user?.id}
      currentEmail={user?.email ?? undefined}
      currentProfile={
        profile
          ? {
              displayName: profile.display_name,
              avatarIconType: profile.avatar_icon_type,
              avatarIconValue: profile.avatar_icon_value,
              avatarColorHex: profile.avatar_color_hex,
            }
          : null
      }
    />
  );
}
