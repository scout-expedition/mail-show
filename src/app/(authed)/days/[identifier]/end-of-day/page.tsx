import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AutoSaveForm } from "@/components/auto-save-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { normalizeDayIdentifier } from "@/lib/db/days";
import { updateDay } from "../../actions";

export default async function EndOfDayTab({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const ident = normalizeDayIdentifier(identifier);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("days")
    .select("*")
    .eq("identifier", ident)
    .maybeSingle();
  const day = data as Day | null;
  if (!day) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>End of Day sign-off</CardTitle>
        <CardDescription>The message read at the end of the day.</CardDescription>
      </CardHeader>
      <CardContent>
        <AutoSaveForm action={updateDay} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={day.id} />
          <input type="hidden" name="number" value={day.number} />
          <input type="hidden" name="name" value={day.name ?? ""} />
          <input type="hidden" name="notes" value={day.notes ?? ""} />
          <input type="hidden" name="until_qup" value={day.until_qup ?? ""} />
          <input type="hidden" name="month" value={day.month ?? ""} />
          <input type="hidden" name="day_of_month" value={day.day_of_month ?? ""} />
          <input type="hidden" name="year" value={day.year ?? ""} />
          <input type="hidden" name="day_of_week" value={day.day_of_week ?? ""} />
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
          <input type="hidden" name="base_report" value={day.base_report ?? ""} />
          <input
            type="hidden"
            name="report_sign_off"
            value={day.report_sign_off ?? ""}
          />
          <Textarea
            name="end_of_day_sign_off"
            defaultValue={day.end_of_day_sign_off ?? ""}
            rows={6}
            className="font-mono"
          />
        </AutoSaveForm>
      </CardContent>
    </Card>
  );
}
