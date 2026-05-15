import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  DayReportBlockView,
  InspectionLetterView,
  LetterGroup,
  ReportGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { MorningReportsWorkspace } from "./workspace";

export default async function MorningReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day: selectedDayIdentifier } = await searchParams;
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

  const [
    { data: dayData },
    { data: blockData },
    { data: segmentData },
    { data: letterGroupData },
    { data: reportGroupData },
    { data: storylineData },
    { data: letterData },
    { data: actionData },
    { data: templateData },
  ] = await Promise.all([
    supabase.from("days").select("*").order("number"),
    supabase.from("day_report_blocks_view").select("*").order("sort_order"),
    supabase.from("report_segments_view").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*"),
    supabase.from("report_groups").select("*").order("display_order"),
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("inspection_letters_view").select("*"),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("action_templates").select("*"),
  ]);

  return (
    <div>
      <PageHeader
        title="Morning Reports"
        description="Compose the report a player reads at the top of each day — the storyline reports that land that morning plus free-standing day reports."
      />
      <MorningReportsWorkspace
        days={(dayData ?? []) as Day[]}
        dayBlocks={(blockData ?? []) as DayReportBlockView[]}
        segments={(segmentData ?? []) as ReportSegmentView[]}
        letterGroups={(letterGroupData ?? []) as LetterGroup[]}
        reportGroups={(reportGroupData ?? []) as ReportGroup[]}
        storylines={(storylineData ?? []) as Storyline[]}
        letters={(letterData ?? []) as InspectionLetterView[]}
        actions={(actionData ?? []) as ActionRow[]}
        templates={(templateData ?? []) as ActionTemplate[]}
        selectedDayIdentifier={selectedDayIdentifier ?? null}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
