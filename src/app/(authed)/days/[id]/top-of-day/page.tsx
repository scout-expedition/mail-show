import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Day,
  ReportSegmentView,
  Playthrough,
  PlaythroughActionChoice,
  InspectionLetterView,
  ReportGroup,
} from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { updateDay } from "../../actions";

export default async function TopOfDayTab({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show_unused?: string }>;
}) {
  const { id } = await params;
  const { show_unused } = await searchParams;
  const showUnused = show_unused === "1";

  const supabase = await createSupabaseServerClient();

  const { data: dayData } = await supabase
    .from("days")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const day = dayData as Day | null;
  if (!day) return null;

  const { data: segmentData } = await supabase
    .from("report_segments_view")
    .select("*")
    .order("sort_order", { ascending: true });
  const segments = (segmentData ?? []) as ReportSegmentView[];

  const { data: groupData } = await supabase
    .from("report_groups")
    .select("*")
    .order("display_order");
  const groups = (groupData ?? []) as ReportGroup[];

  // Active playthrough + its choices to determine highlighting.
  const { data: playthroughData } = await supabase
    .from("playthroughs")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  const active = playthroughData as Playthrough | null;

  let choices: PlaythroughActionChoice[] = [];
  const letterMap = new Map<string, InspectionLetterView>();
  if (active) {
    const { data: choiceData } = await supabase
      .from("playthrough_action_choices")
      .select("*")
      .eq("playthrough_id", active.id);
    choices = (choiceData ?? []) as PlaythroughActionChoice[];
    const { data: letters } = await supabase
      .from("inspection_letters_view")
      .select("*");
    (letters as InspectionLetterView[] | null)?.forEach((l) =>
      letterMap.set(l.id, l)
    );
  }

  // Build: for each active choice, look up the action's report_segment_id.
  const chosenSegmentByGroup = new Map<string, string>();
  if (active && choices.length > 0) {
    const actionIds = choices.map((c) => c.chosen_action_id);
    if (actionIds.length > 0) {
      const { data: acts } = await supabase
        .from("actions")
        .select("id, inspection_letter_id, report_segment_id");
      (acts as Array<{
        id: string;
        inspection_letter_id: string;
        report_segment_id: string | null;
      }> | null)?.forEach((a) => {
        const choice = choices.find((c) => c.chosen_action_id === a.id);
        if (!choice || !a.report_segment_id) return;
        const seg = segments.find((s) => s.id === a.report_segment_id);
        if (!seg) return;
        chosenSegmentByGroup.set(seg.report_group_id, a.report_segment_id);
      });
    }
  }

  // Groups to show: only those whose segments include at least one with effective_day_id = this day.
  const visibleGroups = groups.filter((g) =>
    segments.some(
      (s) => s.report_group_id === g.id && s.effective_day_id === day.id
    )
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Base report</CardTitle>
          <CardDescription>Read before any report group segments.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateDay} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={day.id} />
            <input type="hidden" name="number" value={day.number} />
            <input type="hidden" name="notes" value={day.notes ?? ""} />
            <input type="hidden" name="until_qup" value={day.until_qup ?? ""} />
            <input type="hidden" name="month" value={day.month ?? ""} />
            <input
              type="hidden"
              name="day_of_month"
              value={day.day_of_month ?? ""}
            />
            <input type="hidden" name="year" value={day.year ?? ""} />
            <input
              type="hidden"
              name="day_of_week"
              value={day.day_of_week ?? ""}
            />
            <input
              type="hidden"
              name="sort_phase_length_seconds"
              value={day.sort_phase_length_seconds ?? ""}
            />
            <input
              type="hidden"
              name="inspection_phase_length_seconds"
              value={day.inspection_phase_length_seconds ?? ""}
            />
            <input
              type="hidden"
              name="end_of_day_sign_off"
              value={day.end_of_day_sign_off ?? ""}
            />
            <Textarea
              name="base_report"
              defaultValue={day.base_report ?? ""}
              rows={5}
              className="font-mono"
            />
            <Label>Sign-off</Label>
            <Textarea
              name="report_sign_off"
              defaultValue={day.report_sign_off ?? ""}
              rows={2}
              className="font-mono"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Report groups
          </h2>
          <a
            href={`/days/${day.id}/top-of-day?${showUnused ? "" : "show_unused=1"}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showUnused ? "Hide unused segments" : "Show unused segments"}
          </a>
        </div>

        {visibleGroups.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No report groups are scheduled on this day yet.
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          {visibleGroups.map((g) => {
            const groupSegments = segments.filter(
              (s) => s.report_group_id === g.id
            );
            const chosen = chosenSegmentByGroup.get(g.id);
            return (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {g.name}
                    <Badge variant="muted" className="font-mono">
                      order {g.display_order}
                    </Badge>
                  </CardTitle>
                  {g.notes ? <CardDescription>{g.notes}</CardDescription> : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {groupSegments.map((s) => {
                    const wrongDay = s.effective_day_id !== day.id;
                    const isChosen = chosen === s.id;
                    const greyed =
                      wrongDay ||
                      (active != null && chosen != null && !isChosen);
                    if (wrongDay && !showUnused) return null;
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "rounded-md border border-border p-3",
                          isChosen && "border-primary ring-1 ring-primary",
                          greyed && "opacity-40"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {s.report_id}
                          </span>
                          {wrongDay ? (
                            <Badge variant="warning">different day</Badge>
                          ) : null}
                          {isChosen ? (
                            <Badge variant="success">chosen</Badge>
                          ) : null}
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">
                          {s.content ?? (
                            <span className="text-muted-foreground italic">
                              (empty)
                            </span>
                          )}
                        </pre>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
