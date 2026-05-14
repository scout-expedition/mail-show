import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { Day, SortingLetterView } from "@/lib/db/types";
import { createSortingLetter } from "./actions";
import { SortingLettersEditor } from "./sorting-letters-editor";

export default async function SortingLettersPage() {
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

  const [{ data: daysData }, { data: lettersData }] = await Promise.all([
    supabase.from("days").select("*").order("number"),
    supabase
      .from("sorting_letters_view")
      .select("*")
      .order("day_number")
      .order("sort_id"),
  ]);

  const days = (daysData ?? []) as Day[];
  const letters = (lettersData ?? []) as SortingLetterView[];

  return (
    <div>
      <PageHeader
        title="Sorting Letters"
        description="Letters the player must sort during the sorting phase of each day."
      />

      <SortingLettersEditor
        letters={letters}
        days={days}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

      <div className="mt-4 flex justify-center">
        <form action={createSortingLetter}>
          <Button type="submit" variant="outline" size="sm">
            + Sorting letter
          </Button>
        </form>
      </div>
    </div>
  );
}
