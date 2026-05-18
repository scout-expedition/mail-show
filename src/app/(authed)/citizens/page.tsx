import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { Citizen, City, Nation } from "@/lib/db/types";
import { bulkCreateCitizens, createCitizen } from "./actions";
import { CitizensEditor } from "./citizens-editor";

export default async function CitizensPage() {
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
  const [{ data: citizenData }, { data: nationData }, { data: cityData }] =
    await Promise.all([
      supabase.from("citizens").select("*").order("name"),
      supabase.from("nations").select("*").order("sort_order"),
      supabase.from("cities").select("*").order("name"),
    ]);
  const citizens = (citizenData ?? []) as Citizen[];
  const nations = (nationData ?? []) as Nation[];
  const cities = (cityData ?? []) as City[];

  return (
    <div>
      <PageHeader
        title="Citizens"
        description="Hero and NPC characters referenced by letter senders, recipients, and addresses."
      />

      <CitizensEditor
        citizens={citizens}
        cities={cities}
        nations={nations}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

      <div className="mt-4 flex justify-center">
        <form action={createCitizen}>
          <Button type="submit" variant="outline" size="sm">
            + Citizen
          </Button>
        </form>
      </div>

      <details className="mt-10">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
          Bulk paste
        </summary>
        <form action={bulkCreateCitizens} className="mt-3 flex flex-col gap-2">
          <Label>
            Paste rows — one per line,{" "}
            <span className="font-mono">Type, Name, CitizenID, City</span>
          </Label>
          <Textarea
            name="paste"
            rows={8}
            className="text-xs"
            placeholder={`npc, Rani Ostov, #0042, Riverside\nhero, Juno Vex, #0103, Hilltop`}
          />
          <p className="text-xs text-muted-foreground">
            Tab, comma, or pipe separated. Type is <span className="font-mono">hero</span>{" "}
            or <span className="font-mono">npc</span> (defaults to npc). Nation is
            auto-filled from the city. Unknown cities are skipped silently.
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="secondary">
              Import
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
