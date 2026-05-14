import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { Nation } from "@/lib/db/types";
import { createNation } from "./actions";
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
  const { data } = await supabase
    .from("nations")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const nations = (data ?? []) as Nation[];

  return (
    <div>
      <PageHeader
        title="Nations"
        description="The five nations of the game. Each has a display color and icon used across the app."
      />

      <NationsEditor
        nations={nations}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

      <div className="mt-4 flex justify-center">
        <form action={createNation}>
          <Button type="submit" variant="outline" size="sm">
            + Nation
          </Button>
        </form>
      </div>
    </div>
  );
}
