"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { City } from "@/lib/db/types";

/** Right-side panel listing all cities ordered by name.
 *  Fetches via the browser Supabase client on first render (lazy, inside the
 *  popover so it only runs when the user actually opens the Cities tab). */
export function ReferenceCityList() {
  const [cities, setCities] = useState<City[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: err } = await supabase
          .from("cities")
          .select("id, name, code, nation_id")
          .order("name");
        if (cancelled) return;
        if (err) throw err;
        setCities(data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load cities");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-md bg-destructive/15 px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }

  if (cities === null) {
    return (
      <p className="text-center text-xs text-muted-foreground">Loading…</p>
    );
  }

  if (cities.length === 0) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        No cities found.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border text-xs">
      {cities.map((city) => (
        <li key={city.id} className="flex items-center gap-2 py-1.5">
          <span className="w-10 shrink-0 font-mono text-muted-foreground">
            {city.code}
          </span>
          <span className="truncate">{city.name}</span>
        </li>
      ))}
    </ul>
  );
}
