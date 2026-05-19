import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { City, Nation } from "@/lib/db/types";
import { NationsEditor } from "./nations-editor";

export default async function NationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: meData } = await supabase.auth.getUser();
  const currentUserId = meData.user?.id;
  const currentEmail = meData.user?.email;
  const meProfile = profileFromMetadata(meData.user?.user_metadata);
  const presenceProfile = {
    displayName: meProfile.display_name,
    avatarIconType: meProfile.avatar_icon_type,
    avatarIconValue: meProfile.avatar_icon_value,
    avatarColorHex: meProfile.avatar_color_hex,
  };
  const [{ data: nationData }, { data: cityData }] = await Promise.all([
    supabase
      .from("nations")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("cities")
      .select("id, name, code, nation_id")
      .order("code"),
  ]);
  const nations = (nationData ?? []) as Nation[];
  const cities = (cityData ?? []) as City[];

  return (
    <div>
      <PageHeader
        title="Nations"
        description="The five nations of the game. Each has a display color and icon used across the app."
      />

      <NationsEditor
        nations={nations}
        cities={cities}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
