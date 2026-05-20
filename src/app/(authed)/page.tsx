import { PageHeader } from "@/components/page-header";
import { HomeTiles, type SubOptionsMap } from "@/components/home/home-tiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_TILE_HREFS, NAV_ITEMS } from "@/lib/nav-items";
import { ENDING_LOGIC_TABS } from "@/lib/db/enums";
import type { UserHomeTiles } from "@/lib/db/types";

const VALID_PATHS = new Set(NAV_ITEMS.map((item) => item.href));

function pathnameOf(raw: string): string {
  const noHash = raw.split("#")[0] ?? "";
  return noHash.split("?")[0] ?? "";
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  const [savedRow, daysRow, frameworksRow] = await Promise.all([
    userId
      ? supabase
          .from("user_home_tiles")
          .select("tile_hrefs")
          .eq("user_id", userId)
          .maybeSingle<Pick<UserHomeTiles, "tile_hrefs">>()
      : Promise.resolve({ data: null } as const),
    supabase
      .from("days")
      .select("id, number, identifier, name")
      .order("number"),
    supabase
      .from("ending_documents")
      .select("id, name, kind, sort_order")
      .eq("kind", "framework")
      .order("sort_order"),
  ]);

  const days = (daysRow.data ?? []) as Array<{
    id: string;
    number: number;
    identifier: string;
    name: string | null;
  }>;
  const frameworks = (frameworksRow.data ?? []) as Array<{
    id: string;
    name: string | null;
  }>;

  const subOptions: SubOptionsMap = {
    "/top-of-day/morning-reports": days.map((d) => ({
      href: `/top-of-day/morning-reports?day=${encodeURIComponent(d.identifier)}`,
      label: d.name ? `Day ${d.number} — ${d.name}` : `Day ${d.number}`,
    })),
    "/endings/frameworks": frameworks.map((f) => ({
      href: `/endings/frameworks?framework=${encodeURIComponent(f.id)}`,
      label: f.name ?? "(untitled)",
    })),
    "/endings/logic": ENDING_LOGIC_TABS.map((t) => ({
      href: `/endings/logic?tab=${encodeURIComponent(t.id)}`,
      label: t.label,
    })),
  };

  const saved = savedRow.data?.tile_hrefs ?? null;
  const source = saved ?? [...DEFAULT_TILE_HREFS];
  const initialHrefs = source.filter((href) =>
    VALID_PATHS.has(pathnameOf(href))
  );

  return (
    <div>
      <PageHeader
        title="Home"
        description="Your shortcuts to the pages you use most. Edit to customize."
      />
      <HomeTiles initialHrefs={initialHrefs} subOptions={subOptions} />
    </div>
  );
}
