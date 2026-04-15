import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  Citizen,
  Day,
  InspectionLetterView,
  LetterGroup,
  ReportGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { toRoman } from "@/lib/utils";
import {
  deleteLetterGroup,
  updateLetterGroup,
} from "../../../actions";
import {
  createAction,
  createInspectionLetter,
  createReportSegment,
  deleteAction,
  deleteInspectionLetter,
  deleteReportSegment,
  updateAction,
  updateInspectionLetter,
  updateReportSegment,
} from "./actions";

export default async function GroupDetail({
  params,
}: {
  params: Promise<{ id: string; groupId: string }>;
}) {
  const { id, groupId } = await params;
  const supabase = await createSupabaseServerClient();
  const [
    { data: sData },
    { data: gData },
    { data: rgData },
    { data: lettersData },
    { data: actionsData },
    { data: segmentsData },
    { data: daysData },
    { data: citData },
  ] = await Promise.all([
    supabase.from("storylines").select("*").eq("id", id).maybeSingle(),
    supabase.from("letter_groups").select("*").eq("id", groupId).maybeSingle(),
    supabase
      .from("report_groups")
      .select("*")
      .eq("letter_group_id", groupId)
      .maybeSingle(),
    supabase
      .from("inspection_letters_view")
      .select("*")
      .eq("letter_group_id", groupId)
      .order("variant", { ascending: true, nullsFirst: true })
      .order("piece", { ascending: true, nullsFirst: true }),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("report_segments_view").select("*"),
    supabase.from("days").select("*").order("number"),
    supabase.from("citizens").select("*").order("name"),
  ]);
  if (!sData || !gData) notFound();

  const storyline = sData as Storyline;
  const group = gData as LetterGroup;
  const reportGroup = rgData as ReportGroup | null;
  const letters = (lettersData ?? []) as InspectionLetterView[];
  const allActions = (actionsData ?? []) as ActionRow[];
  const segments = ((segmentsData ?? []) as ReportSegmentView[]).filter(
    (s) => s.report_group_id === reportGroup?.id
  );
  const days = (daysData ?? []) as Day[];
  const citizens = (citData ?? []) as Citizen[];

  const actionsByLetter = new Map<string, ActionRow[]>();
  for (const a of allActions) {
    const arr = actionsByLetter.get(a.inspection_letter_id) ?? [];
    arr.push(a);
    actionsByLetter.set(a.inspection_letter_id, arr);
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {storyline.abbreviation}
              {group.sequence}
            </Badge>
            {group.name}
          </span>
        }
        description={group.notes ?? undefined}
        actions={
          <div className="flex gap-2">
            <Link href={`/storylines/${storyline.id}`}>
              <Button variant="ghost" size="sm">
                Back to {storyline.name}
              </Button>
            </Link>
            <form action={deleteLetterGroup}>
              <input type="hidden" name="id" value={group.id} />
              <input type="hidden" name="storyline_id" value={storyline.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete group
              </Button>
            </form>
          </div>
        }
      />

      {/* Group settings */}
      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={updateLetterGroup} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="id" value={group.id} />
            <input type="hidden" name="storyline_id" value={storyline.id} />
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" defaultValue={group.name} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sequence</Label>
              <Input
                type="number"
                name="sequence"
                defaultValue={group.sequence}
                required
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Default delivery day</Label>
              <Select
                name="delivery_day_id"
                defaultValue={group.delivery_day_id ?? ""}
              >
                <option value="">—</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Textarea name="notes" defaultValue={group.notes ?? ""} rows={2} />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Save group
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Inspection letters */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Inspection letters
      </h2>
      <Card className="mb-4">
        <CardContent className="pt-5">
          <form action={createInspectionLetter} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="storyline_id" value={storyline.id} />
            <input type="hidden" name="letter_group_id" value={group.id} />
            <div className="flex flex-col gap-1.5">
              <Label>Variant</Label>
              <Input name="variant" maxLength={1} placeholder="a" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Piece</Label>
              <Input type="number" name="piece" min={1} placeholder="1" />
            </div>
            <div className="col-span-4 flex flex-col gap-1.5">
              <Label>Summary</Label>
              <Input name="summary" placeholder="One-line summary" />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Add inspection letter (with default Deliver/Flag actions)
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {letters.map((l) => (
          <LetterCard
            key={l.id}
            letter={l}
            storyline={storyline}
            group={group}
            actions={actionsByLetter.get(l.id) ?? []}
            segments={segments}
            days={days}
            citizens={citizens}
          />
        ))}
        {letters.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No inspection letters in this group yet.
          </p>
        ) : null}
      </div>

      {/* Report segments */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Report segments
      </h2>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Report group: {reportGroup?.name ?? "(missing)"}</CardTitle>
          <CardDescription>
            Segments read during Top of Day the day after this letter group is delivered.
          </CardDescription>
        </CardHeader>
        {reportGroup ? (
          <CardContent>
            <form action={createReportSegment} className="mb-4 grid grid-cols-6 gap-3">
              <input type="hidden" name="report_group_id" value={reportGroup.id} />
              <div className="flex flex-col gap-1.5">
                <Label>Variant</Label>
                <Input
                  name="variant"
                  required
                  placeholder={toRoman(segments.length + 1)}
                />
              </div>
              <div className="col-span-5 flex flex-col gap-1.5">
                <Label>Content</Label>
                <Input name="content" />
              </div>
              <div className="col-span-6 flex justify-end">
                <Button type="submit" size="sm">
                  Add segment
                </Button>
              </div>
            </form>

            <div className="flex flex-col gap-3">
              {segments.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border border-border p-3"
                >
                  <form action={updateReportSegment} className="flex flex-col gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono">
                        {s.report_id}
                      </Badge>
                      <Input
                        name="variant"
                        defaultValue={s.variant}
                        className="h-7 w-20"
                      />
                      <Label className="ml-2">Day override</Label>
                      <Select
                        name="delivery_day_override_id"
                        defaultValue={s.delivery_day_override_id ?? ""}
                        className="h-7 w-32"
                      >
                        <option value="">—</option>
                        {days.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.identifier}
                          </option>
                        ))}
                      </Select>
                      <Label className="ml-2">Sort</Label>
                      <Input
                        type="number"
                        name="sort_order"
                        defaultValue={s.sort_order}
                        className="h-7 w-16"
                      />
                      <div className="ml-auto flex gap-2">
                        <Button type="submit" size="sm" variant="secondary">
                          Save
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      name="content"
                      defaultValue={s.content ?? ""}
                      rows={3}
                      className="font-mono"
                    />
                  </form>
                  <form action={deleteReportSegment} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Delete segment
                    </Button>
                  </form>
                </div>
              ))}
              {segments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No segments yet.
                </p>
              ) : null}
            </div>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function LetterCard({
  letter,
  storyline,
  group,
  actions,
  segments,
  days,
  citizens,
}: {
  letter: InspectionLetterView;
  storyline: Storyline;
  group: LetterGroup;
  actions: ActionRow[];
  segments: ReportSegmentView[];
  days: Day[];
  citizens: Citizen[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {letter.content_id}
            </Badge>
            {letter.summary || (
              <span className="text-muted-foreground italic">(no summary)</span>
            )}
          </CardTitle>
        </div>
        <form action={deleteInspectionLetter}>
          <input type="hidden" name="id" value={letter.id} />
          <input type="hidden" name="storyline_id" value={storyline.id} />
          <input type="hidden" name="letter_group_id" value={group.id} />
          <Button type="submit" size="sm" variant="ghost">
            Delete
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        <form action={updateInspectionLetter} className="grid grid-cols-6 gap-3">
          <input type="hidden" name="id" value={letter.id} />
          <input type="hidden" name="storyline_id" value={storyline.id} />
          <input type="hidden" name="letter_group_id" value={group.id} />

          <div className="flex flex-col gap-1.5">
            <Label>Variant</Label>
            <Input name="variant" defaultValue={letter.variant ?? ""} maxLength={1} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Piece</Label>
            <Input type="number" name="piece" defaultValue={letter.piece ?? ""} />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Delivery day override</Label>
            <Select
              name="delivery_day_override_id"
              defaultValue={letter.delivery_day_override_id ?? ""}
            >
              <option value="">Use group default</option>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.identifier}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Effective day</Label>
            <Input
              value={
                days.find((d) => d.id === letter.effective_day_id)?.identifier ??
                "—"
              }
              disabled
              readOnly
            />
          </div>

          <div className="col-span-6 flex flex-col gap-1.5">
            <Label>Summary</Label>
            <Input name="summary" defaultValue={letter.summary ?? ""} />
          </div>
          <div className="col-span-6 flex flex-col gap-1.5">
            <Label>Content (markdown)</Label>
            <Textarea
              name="content"
              defaultValue={letter.content ?? ""}
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          <div className="col-span-3 flex flex-col gap-1.5">
            <Label>Sender</Label>
            <Select
              name="sender_citizen_id"
              defaultValue={letter.sender_citizen_id ?? ""}
            >
              <option value="">—</option>
              {citizens.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-3 flex flex-col gap-1.5">
            <Label>Receiver</Label>
            <Select
              name="receiver_citizen_id"
              defaultValue={letter.receiver_citizen_id ?? ""}
            >
              <option value="">—</option>
              {citizens.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="col-span-6 flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea name="notes" defaultValue={letter.notes ?? ""} rows={2} />
          </div>

          <div className="col-span-6 flex justify-end">
            <Button type="submit" size="sm">Save letter</Button>
          </div>
        </form>

        {/* Actions */}
        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Actions ({actions.length})
            </h3>
            <form action={createAction}>
              <input
                type="hidden"
                name="inspection_letter_id"
                value={letter.id}
              />
              <input type="hidden" name="name" value="New action" />
              <Button size="sm" variant="secondary" type="submit">
                Add action
              </Button>
            </form>
          </div>
          <div className="flex flex-col gap-3">
            {actions.map((a) => (
              <ActionEditor
                key={a.id}
                action={a}
                segments={segments}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionEditor({
  action,
  segments,
}: {
  action: ActionRow;
  segments: ReportSegmentView[];
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <form action={updateAction} className="grid grid-cols-12 gap-2">
        <input type="hidden" name="id" value={action.id} />
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Name</Label>
          <Input name="name" defaultValue={action.name} className="h-8" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Icon (lucide)</Label>
          <Input
            name="icon_value"
            defaultValue={action.icon_value ?? ""}
            className="h-8"
          />
        </div>
        <div className="col-span-1 flex flex-col gap-1">
          <Label>Color</Label>
          <Input
            type="color"
            name="color_hex"
            defaultValue={action.color_hex}
            className="h-8 p-1"
          />
        </div>
        <input type="hidden" name="icon_type" value="lucide" />
        <div className="col-span-3 flex flex-col gap-1">
          <Label>Triggers report</Label>
          <Select
            name="report_segment_id"
            defaultValue={action.report_segment_id ?? ""}
            className="h-8"
          >
            <option value="">—</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.report_id}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Next letter variant</Label>
          <Input
            name="next_letter_variant"
            defaultValue={action.next_letter_variant ?? ""}
            maxLength={1}
            className="h-8"
          />
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="submit" size="sm" variant="secondary">
            Save
          </Button>
        </div>

        <div className="col-span-12 grid grid-cols-9 gap-2 rounded-md bg-muted/30 p-2">
          {[
            ["impact_world_status", "WS"],
            ["impact_demerits", "Dm"],
            ["impact_proletariat", "Pr"],
            ["impact_gentry", "Gt"],
            ["impact_epicenter", "Ep"],
            ["impact_folos", "Fo"],
            ["impact_emberlyn", "Em"],
            ["impact_spokgrad", "Sp"],
            ["impact_pelico", "Pe"],
          ].map(([name, short]) => (
            <label key={name} className="flex flex-col items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {short}
              </span>
              <Input
                type="number"
                name={name}
                defaultValue={
                  (action as unknown as Record<string, number>)[name] ?? 0
                }
                className="h-7 w-14 text-center"
              />
            </label>
          ))}
        </div>
      </form>

      <form action={deleteAction} className="mt-2 flex justify-end">
        <input type="hidden" name="id" value={action.id} />
        <Button type="submit" size="sm" variant="ghost">
          Delete action
        </Button>
      </form>
    </div>
  );
}
