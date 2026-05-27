import { AppShellHud } from "@/components/app-shell-hud";
import { AppShellMain } from "@/components/app-shell-main";
import { Nav } from "@/components/nav";
import { NavSpacer } from "@/components/nav-spacer";
import { NavStateProvider } from "@/components/nav-context";
import {
  PresenceUserProvider,
  type PresenceUser,
} from "@/components/presence-user-context";
import { profileFromMetadata } from "@/lib/auth/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, Playthrough, PlaythroughVariables } from "@/lib/db/types";

/** Top-level app chrome: left nav + sticky top bar with playthrough HUD.
 *  Fetches the current user once and exposes it via `PresenceUserProvider`
 *  so client components (AppPresence, workspace stacks) can read identity
 *  without each one re-running `auth.getUser()` or importing `next/headers`
 *  (which breaks Client Component bundling). */
export async function AppShell({ children }: { children: React.ReactNode }) {
  let activePlaythrough: Playthrough | null = null;
  let currentDay: Day | null = null;
  let vars: Omit<PlaythroughVariables, "playthrough_id"> | undefined;
  let presenceUser: PresenceUser | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: me } = await supabase.auth.getUser();
    if (me.user?.email) {
      const profile = profileFromMetadata(me.user.user_metadata);
      presenceUser = {
        userId: me.user.id,
        email: me.user.email,
        profile: {
          displayName: profile.display_name,
          avatarIconType: profile.avatar_icon_type,
          avatarIconValue: profile.avatar_icon_value,
          avatarColorHex: profile.avatar_color_hex,
        },
      };
    }
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
    // env not configured yet — HUD just shows zeros and presence stays null.
  }

  return (
    <PresenceUserProvider value={presenceUser}>
      <NavStateProvider>
      {/* Page content is rendered BEFORE <Nav /> in the DOM so Tab walks
          the page's form fields first; the nav is placed back on the
          left visually via `lg:order-1` (see nav.tsx). Keyboard users
          reach the nav only after cycling the page. */}
      <div className="flex h-screen w-screen overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden lg:order-2">
          {/* Reserves room for the fixed nav Menu toggle so it doesn't
              overlap page content at narrow viewports. At lg+ the nav is
              inline and the toggle is hidden, so the spacer collapses —
              except on routes that force the nav into hamburger mode at
              every viewport (e.g. `/graph`). */}
          <NavSpacer />
          <AppShellHud
            activePlaythrough={activePlaythrough}
            currentDay={currentDay}
            vars={vars}
          />
          <AppShellMain>{children}</AppShellMain>
        </div>
        <Nav />
      </div>
      </NavStateProvider>
    </PresenceUserProvider>
  );
}
