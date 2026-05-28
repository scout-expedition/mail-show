"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Citizen } from "@/lib/db/types";

type CitizenWithCityCode = Pick<
  Citizen,
  "id" | "first_name" | "last_name" | "citizen_id" | "city_id"
> & {
  city_code: string | null;
};

/** Right-side panel listing all citizens ordered by citizen_id.
 *  Fetches via the browser Supabase client on first render. */
export function ReferenceCitizenDirectory() {
  const [citizens, setCitizens] = useState<CitizenWithCityCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        // Join cities to get the code. Use a left join via the FK.
        const { data, error: err } = await supabase
          .from("citizens")
          .select("id, first_name, last_name, citizen_id, city_id, cities(code)")
          .order("citizen_id");
        if (cancelled) return;
        if (err) throw err;
        const rows: CitizenWithCityCode[] = (data ?? []).map((row) => ({
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          citizen_id: row.citizen_id,
          city_id: row.city_id,
          // Supabase returns the joined table as an object or null.
          city_code:
            row.cities && !Array.isArray(row.cities)
              ? (row.cities as { code: string }).code
              : Array.isArray(row.cities) && row.cities.length > 0
                ? (row.cities[0] as { code: string }).code
                : null,
        }));
        setCitizens(rows);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load citizens");
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

  if (citizens === null) {
    return (
      <p className="text-center text-xs text-muted-foreground">Loading…</p>
    );
  }

  if (citizens.length === 0) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        No citizens found.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border text-xs">
      {citizens.map((c) => (
        <li key={c.id} className="flex items-center gap-2 py-1.5">
          <span className="w-14 shrink-0 font-mono text-muted-foreground">
            {c.citizen_id ?? "—"}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {c.first_name} {c.last_name}
          </span>
          {c.city_code ? (
            <span className="shrink-0 text-muted-foreground">{c.city_code}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
