import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { City, Nation } from "@/lib/db/types";
import { bulkCreateCities, createCity } from "./actions";
import { CitiesEditor } from "./cities-editor";

export default async function CitiesPage() {
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
  const [{ data: cityData }, { data: nationData }] = await Promise.all([
    supabase.from("cities").select("*").order("name"),
    supabase.from("nations").select("*").order("sort_order"),
  ]);
  const cities = (cityData ?? []) as City[];
  const nations = (nationData ?? []) as Nation[];

  return (
    <div>
      <PageHeader
        title="Cities"
        description="Each city has a code and belongs to a nation."
      />

      <CitiesEditor
        cities={cities}
        nations={nations}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

      <div className="mt-4 flex justify-center">
        <form action={createCity}>
          <Button type="submit" variant="outline" size="sm">
            + City
          </Button>
        </form>
      </div>

      <details className="mt-10">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
          Bulk paste
        </summary>
        <form action={bulkCreateCities} className="mt-3 flex flex-col gap-2">
          <Label>Paste rows — one per line, <span className="font-mono">City, Code, Nation</span></Label>
          <Textarea
            name="paste"
            rows={8}
            className="font-mono text-xs"
            placeholder={`Riverside, RVS, Folos\nHilltop, HLT, Epicenter`}
          />
          <p className="text-xs text-muted-foreground">
            Tab, comma, or pipe separated. Nation matches by name or abbreviation
            (case-insensitive). Invalid lines are skipped.
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
