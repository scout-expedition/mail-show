import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { Storyline } from "@/lib/db/types";
import { StorylinesEditor } from "./storylines-editor";
import { AddStorylineDialog } from "./add-storyline-dialog";

export default async function StorylinesPage() {
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
    .from("storylines")
    .select("*")
    .order("sort_order")
    .order("name");
  const storylines = (data ?? []) as Storyline[];

  return (
    <div>
      <PageHeader
        title="Storylines"
        description="Each storyline contains letter groups; each letter group contains inspection letters with player actions."
      />

      <StorylinesEditor
        storylines={storylines}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

      <div className="mt-4 flex justify-center">
        <AddStorylineDialog storylines={storylines} />
      </div>
    </div>
  );
}
