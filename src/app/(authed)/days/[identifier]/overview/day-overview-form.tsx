"use client";

import { useMemo, useState } from "react";
import { AutoSaveForm } from "@/components/auto-save-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseDurationToSeconds, formatDurationMMSS } from "@/lib/utils";
import { DAYS_OF_WEEK, type DayOfWeek } from "@/lib/db/enums";
import type { Day } from "@/lib/db/types";
import { updateDay, deleteDay } from "../../actions";

export function DayOverviewForm({ day }: { day: Day }) {
  return (
    <>
      <AutoSaveForm action={updateDay} className="grid grid-cols-6 gap-4">
        <input type="hidden" name="id" value={day.id} />

        <div className="col-span-6 grid grid-cols-6 gap-4">
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Day Number</Label>
            <Input type="number" name="number" defaultValue={day.number} />
          </div>
          <div className="flex flex-col gap-1.5 col-span-4">
            <Label>Name</Label>
            <Input
              name="name"
              defaultValue={day.name ?? ""}
              placeholder="e.g. Unity Day"
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-1">
            <Label>Days Until QUP</Label>
            <Input
              type="number"
              name="until_qup"
              defaultValue={day.until_qup ?? ""}
            />
          </div>
        </div>

        <Card className="col-span-6 bg-muted/30">
          <CardContent className="pt-4">
            <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In-world date
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Month</Label>
                <Input type="number" name="month" defaultValue={day.month ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Day</Label>
                <Input
                  type="number"
                  name="day_of_month"
                  defaultValue={day.day_of_month ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Year</Label>
                <Input type="number" name="year" defaultValue={day.year ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Day of week</Label>
                <Select name="day_of_week" defaultValue={day.day_of_week ?? ""}>
                  <option value="">—</option>
                  {DAYS_OF_WEEK.map((d: DayOfWeek) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <DurationField
          label="Sorting Phase Length"
          name="sort_phase_length_seconds"
          initialSeconds={day.sort_phase_length_seconds}
        />
        <DurationField
          label="Inspection Phase Length"
          name="inspection_phase_length_seconds"
          initialSeconds={day.inspection_phase_length_seconds}
        />

        <div className="flex flex-col gap-1.5 col-span-6">
          <Label>Notes</Label>
          <Textarea name="notes" defaultValue={day.notes ?? ""} rows={3} />
        </div>

        <input type="hidden" name="base_report" value={day.base_report ?? ""} />
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
      </AutoSaveForm>

      <div className="mt-10 flex justify-center">
        <form
          action={deleteDay}
          onSubmit={(e) => {
            if (!confirm("Delete this day? This cannot be undone.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={day.id} />
          <Button type="submit" variant="outline" size="sm">
            Delete day
          </Button>
        </form>
      </div>
    </>
  );
}

function DurationField({
  label,
  name,
  initialSeconds,
}: {
  label: string;
  name: string;
  initialSeconds: number | null;
}) {
  const initialDisplay = useMemo(
    () => formatDurationMMSS(initialSeconds),
    [initialSeconds]
  );
  const [display, setDisplay] = useState(initialDisplay);
  const [seconds, setSeconds] = useState<number | null>(initialSeconds);

  function handleBlur() {
    const parsed = parseDurationToSeconds(display);
    setSeconds(parsed);
    setDisplay(parsed == null ? "" : formatDurationMMSS(parsed));
  }

  return (
    <div className="flex flex-col gap-1.5 col-span-3">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        onBlur={handleBlur}
        placeholder="MM:SS (e.g. 10:00)"
      />
      <input type="hidden" name={name} value={seconds ?? ""} />
    </div>
  );
}
