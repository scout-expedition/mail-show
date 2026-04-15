import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, InspectionLetterView, LetterGroup, Storyline } from "@/lib/db/types";
import { normalizeDayIdentifier } from "@/lib/db/days";

export default async function InspectionTab({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const ident = normalizeDayIdentifier(identifier);
  const supabase = await createSupabaseServerClient();

  const { data: dayData } = await supabase
    .from("days")
    .select("*")
    .eq("identifier", ident)
    .maybeSingle();
  const day = dayData as Day | null;
  if (!day) return null;
  const id = day.id;

  const [{ data: letters }, { data: groups }, { data: storylines }] =
    await Promise.all([
      supabase
        .from("inspection_letters_view")
        .select("*")
        .eq("effective_day_id", id),
      supabase.from("letter_groups").select("*"),
      supabase.from("storylines").select("*").order("sort_order"),
    ]);

  const ls = (letters ?? []) as InspectionLetterView[];
  const gs = (groups ?? []) as LetterGroup[];
  const sls = (storylines ?? []) as Storyline[];
  const groupMap = new Map(gs.map((g) => [g.id, g]));
  const storylineMap = new Map(sls.map((s) => [s.id, s]));

  const byStoryline = new Map<string, InspectionLetterView[]>();
  for (const l of ls) {
    const arr = byStoryline.get(l.storyline_id) ?? [];
    arr.push(l);
    byStoryline.set(l.storyline_id, arr);
  }

  return (
    <div className="flex flex-col gap-4">
      {sls
        .filter((s) => byStoryline.has(s.id))
        .map((s) => {
          const letters = byStoryline.get(s.id) ?? [];
          return (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: s.color_hex }}
                  />
                  {s.name}
                </CardTitle>
                <CardDescription>
                  {letters.length} letter{letters.length === 1 ? "" : "s"} to inspect on this day
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {letters.map((l) => {
                  const g = groupMap.get(l.letter_group_id);
                  return (
                    <div
                      key={l.id}
                      className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono">
                            {l.content_id}
                          </Badge>
                          <span className="text-sm font-medium">
                            {g?.name ?? "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {l.summary ?? "(no summary)"}
                        </p>
                      </div>
                      <Link
                        href={`/inspection/letters/${g?.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

      {ls.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No inspection letters scheduled for this day yet.
        </p>
      ) : null}
    </div>
  );
}
