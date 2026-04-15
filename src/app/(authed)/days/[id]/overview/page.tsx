import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { DAYS_OF_WEEK } from "@/lib/db/enums";
import { updateDay } from "../../actions";

export default async function OverviewTab({
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
      <CardContent className="pt-5">
        <form action={updateDay} className="grid grid-cols-6 gap-4">
          <input type="hidden" name="id" value={day.id} />

          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Number</Label>
            <Input type="number" name="number" defaultValue={day.number} />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Until Q-up</Label>
            <Input
              type="number"
              name="until_qup"
              defaultValue={day.until_qup ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Month</Label>
            <Input type="number" name="month" defaultValue={day.month ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Day</Label>
            <Input
              type="number"
              name="day_of_month"
              defaultValue={day.day_of_month ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Year</Label>
            <Input type="number" name="year" defaultValue={day.year ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Day of week</Label>
            <Select name="day_of_week" defaultValue={day.day_of_week ?? ""}>
              <option value="">—</option>
              {DAYS_OF_WEEK.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 col-span-3">
            <Label>Sorting phase length (seconds)</Label>
            <Input
              type="number"
              name="sort_phase_length_seconds"
              defaultValue={day.sort_phase_length_seconds ?? ""}
              placeholder="e.g. 600 for 10:00"
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-3">
            <Label>Inspection phase length (seconds)</Label>
            <Input
              type="number"
              name="inspection_phase_length_seconds"
              defaultValue={day.inspection_phase_length_seconds ?? ""}
              placeholder="e.g. 900 for 15:00"
            />
          </div>

          <div className="flex flex-col gap-1.5 col-span-6">
            <Label>Notes</Label>
            <Textarea name="notes" defaultValue={day.notes ?? ""} rows={3} />
          </div>

          {/* Keep existing report fields when saving from overview */}
          <input
            type="hidden"
            name="base_report"
            value={day.base_report ?? ""}
          />
          <input
            type="hidden"
            name="report_sign_off"
            value={day.report_sign_off ?? ""}
          />
          <input
            type="hidden"
            name="end_of_day_sign_off"
            value={day.end_of_day_sign_off ?? ""}
          />

          <div className="col-span-6 flex justify-end">
            <Button type="submit">Save day</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
