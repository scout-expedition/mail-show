import { Nav } from "@/components/nav";
import { VariableHud } from "@/components/variable-hud";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PHASE_LABELS } from "@/lib/db/enums";
import type { Day, Playthrough, PlaythroughVariables } from "@/lib/db/types";

/** Top-level app chrome: left nav + sticky top bar with playthrough HUD. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  let activePlaythrough: Playthrough | null = null;
  let currentDay: Day | null = null;
  let vars: Omit<PlaythroughVariables, "playthrough_id"> | undefined;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: active } = await supabase
      .from("playthroughs")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    activePlaythrough = (active as Playthrough | null) ?? null;

    if (activePlaythrough?.current_day_id) {
      const { data: day } = await supabase
        .from("days")
        .select("*")
        .eq("id", activePlaythrough.current_day_id)
        .maybeSingle();
      currentDay = (day as Day | null) ?? null;
    }
    if (activePlaythrough) {
      const { data: v } = await supabase
        .from("playthrough_variables")
        .select("*")
        .eq("playthrough_id", activePlaythrough.id)
        .maybeSingle();
      if (v) {
        // strip playthrough_id
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { playthrough_id: _, ...rest } = v as PlaythroughVariables;
        vars = rest;
      }
    }
  } catch {
    // env not configured yet — HUD just shows zeros.
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Nav />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Reserves room for the fixed nav Menu toggle so it doesn't
            overlap page content at narrow viewports. At lg+ the nav is
            inline and the toggle is hidden, so the spacer collapses. */}
        <div className="h-12 shrink-0 lg:hidden" aria-hidden />
        {activePlaythrough ? (
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 backdrop-blur">
            <div className="flex items-center gap-3 text-sm">
              {currentDay ? (
                <>
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                    {currentDay.identifier}
                  </span>
                  <span className="text-muted-foreground">
                    {PHASE_LABELS[activePlaythrough.current_phase]}
                  </span>
                </>
              ) : null}
            </div>
            <VariableHud
              vars={vars}
              playthroughName={activePlaythrough.name}
            />
          </header>
        ) : null}
        <main
          className="flex-1 overflow-y-auto px-8 py-6"
          style={{ scrollbarGutter: "stable" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
