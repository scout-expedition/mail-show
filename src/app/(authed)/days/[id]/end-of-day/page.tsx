import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { updateDay } from "../../actions";

export default async function EndOfDayTab({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("days").select("*").eq("id", id).maybeSingle();
  const day = data as Day | null;
  if (!day) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>End of Day sign-off</CardTitle>
        <CardDescription>The message read at the end of the day.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateDay} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={day.id} />
          <input type="hidden" name="number" value={day.number} />
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
          <div className="flex justify-end">
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
