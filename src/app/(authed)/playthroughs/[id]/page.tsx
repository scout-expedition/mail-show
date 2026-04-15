import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VariableHud } from "@/components/variable-hud";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PHASES, PHASE_LABELS } from "@/lib/db/enums";
import type {
  ActionRow,
  Day,
  InspectionLetterView,
  Playthrough,
  PlaythroughActionChoice,
  PlaythroughVariables,
  Storyline,
} from "@/lib/db/types";
import {
  chooseAction,
  clearChoice,
  deletePlaythrough,
  setActivePlaythrough,
  updatePlaythrough,
} from "../actions";

export default async function PlaythroughDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [
    { data: pData },
    { data: dData },
    { data: lData },
    { data: aData },
    { data: cData },
    { data: vData },
    { data: sData },
  ] = await Promise.all([
    supabase.from("playthroughs").select("*").eq("id", id).maybeSingle(),
    supabase.from("days").select("*").order("number"),
    supabase
      .from("inspection_letters_view")
      .select("*")
      .order("storyline_abbreviation")
      .order("group_sequence"),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("playthrough_action_choices").select("*").eq("playthrough_id", id),
    supabase
      .from("playthrough_variables")
      .select("*")
      .eq("playthrough_id", id)
      .maybeSingle(),
    supabase.from("storylines").select("*").order("sort_order"),
  ]);
  if (!pData) notFound();
  const p = pData as Playthrough;
  const days = (dData ?? []) as Day[];
  const letters = (lData ?? []) as InspectionLetterView[];
  const allActions = (aData ?? []) as ActionRow[];
  const choices = (cData ?? []) as PlaythroughActionChoice[];
  const storylines = (sData ?? []) as Storyline[];
  const vars = (vData as PlaythroughVariables | null) ?? null;
  const choiceMap = new Map(choices.map((c) => [c.inspection_letter_id, c.chosen_action_id]));

  // Group letters by storyline → letter group.
  const byStoryline = new Map<string, InspectionLetterView[]>();
  for (const l of letters) {
    const arr = byStoryline.get(l.storyline_id) ?? [];
    arr.push(l);
    byStoryline.set(l.storyline_id, arr);
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {p.name}
            {p.is_active ? <Badge variant="success">active</Badge> : null}
          </span>
        }
        description={p.notes ?? undefined}
        actions={
          <div className="flex gap-2">
            <Link href="/playthroughs">
              <Button variant="ghost" size="sm">
                All
              </Button>
            </Link>
            {!p.is_active ? (
              <form action={setActivePlaythrough}>
                <input type="hidden" name="id" value={p.id} />
                <Button type="submit" size="sm">
                  Make active
                </Button>
              </form>
            ) : null}
            <form action={deletePlaythrough}>
              <input type="hidden" name="id" value={p.id} />
              <Button type="submit" size="sm" variant="destructive">
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={updatePlaythrough} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="id" value={p.id} />
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" defaultValue={p.name} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Current day</Label>
              <Select
                name="current_day_id"
                defaultValue={p.current_day_id ?? ""}
              >
                <option value="">—</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phase</Label>
              <Select name="current_phase" defaultValue={p.current_phase}>
                {PHASES.map((ph) => (
                  <option key={ph} value={ph}>
                    {PHASE_LABELS[ph]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Textarea name="notes" defaultValue={p.notes ?? ""} rows={2} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="pt-5">
          <VariableHud
            vars={vars ?? undefined}
            playthroughName={p.name}
            className="text-base"
          />
        </CardContent>
      </Card>

      {storylines
        .filter((s) => byStoryline.has(s.id))
        .map((s) => (
          <Card key={s.id} className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: s.color_hex }}
                />
                {s.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {(byStoryline.get(s.id) ?? []).map((l) => {
                const letterActions = allActions.filter(
                  (a) => a.inspection_letter_id === l.id
                );
                const chosenId = choiceMap.get(l.id);
                return (
                  <div
                    key={l.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {l.content_id}
                        </Badge>
                        <span className="text-sm font-medium">
                          {l.summary ?? "(no summary)"}
                        </span>
                      </div>
                      {chosenId ? (
                        <form action={clearChoice}>
                          <input
                            type="hidden"
                            name="playthrough_id"
                            value={p.id}
                          />
                          <input
                            type="hidden"
                            name="inspection_letter_id"
                            value={l.id}
                          />
                          <Button type="submit" size="sm" variant="ghost">
                            Clear choice
                          </Button>
                        </form>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {letterActions.map((a) => {
                        const isChosen = chosenId === a.id;
                        return (
                          <form
                            key={a.id}
                            action={chooseAction}
                            className="inline-flex"
                          >
                            <input
                              type="hidden"
                              name="playthrough_id"
                              value={p.id}
                            />
                            <input
                              type="hidden"
                              name="inspection_letter_id"
                              value={l.id}
                            />
                            <input
                              type="hidden"
                              name="chosen_action_id"
                              value={a.id}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant={isChosen ? "default" : "outline"}
                              style={
                                isChosen
                                  ? {
                                      background: a.color_hex,
                                      borderColor: a.color_hex,
                                      color: "#0b0d10",
                                    }
                                  : undefined
                              }
                            >
                              {a.name}
                            </Button>
                          </form>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}

      {letters.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No inspection letters authored yet. Create storylines + letter groups + letters first.
        </p>
      ) : null}
    </div>
  );
}
