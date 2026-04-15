import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, LetterGroup, Storyline } from "@/lib/db/types";
import {
  createLetterGroup,
  deleteStoryline,
  updateStoryline,
} from "../actions";

export default async function StorylineDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: sData }, { data: gData }, { data: dayData }] = await Promise.all([
    supabase.from("storylines").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("letter_groups")
      .select("*")
      .eq("storyline_id", id)
      .order("sequence"),
    supabase.from("days").select("*").order("number"),
  ]);
  if (!sData) notFound();
  const storyline = sData as Storyline;
  const groups = (gData ?? []) as LetterGroup[];
  const days = (dayData ?? []) as Day[];

  const nextSeq =
    groups.length > 0 ? Math.max(...groups.map((g) => g.sequence)) + 1 : 1;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {storyline.abbreviation}
            </Badge>
            {storyline.name}
          </span>
        }
        description={storyline.description ?? undefined}
        actions={
          <div className="flex gap-2">
            <Link href="/storylines">
              <Button variant="ghost" size="sm">
                All storylines
              </Button>
            </Link>
            <form action={deleteStoryline}>
              <input type="hidden" name="id" value={storyline.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={updateStoryline} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="id" value={storyline.id} />
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" defaultValue={storyline.name} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Abbr</Label>
              <Input
                name="abbreviation"
                defaultValue={storyline.abbreviation}
                maxLength={1}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <Input
                type="color"
                name="color_hex"
                defaultValue={storyline.color_hex}
                className="h-9 p-1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sort</Label>
              <Input
                type="number"
                name="sort_order"
                defaultValue={storyline.sort_order}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Icon type</Label>
              <Select name="icon_type" defaultValue={storyline.icon_type}>
                <option value="lucide">Lucide</option>
                <option value="emoji">Emoji</option>
                <option value="svg">Custom SVG</option>
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Icon value</Label>
              <Input
                name="icon_value"
                defaultValue={storyline.icon_value ?? ""}
              />
            </div>
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea
                name="description"
                defaultValue={storyline.description ?? ""}
                rows={2}
              />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Save storyline
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Letter groups
      </h2>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <form action={createLetterGroup} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="storyline_id" value={storyline.id} />
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Group name</Label>
              <Input name="name" required placeholder="Opening briefing" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sequence</Label>
              <Input
                type="number"
                name="sequence"
                defaultValue={nextSeq}
                required
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Delivery day</Label>
              <Select name="delivery_day_id" defaultValue="">
                <option value="">—</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Add letter group
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const day = days.find((d) => d.id === g.delivery_day_id);
          return (
            <Link
              key={g.id}
              href={`/storylines/${storyline.id}/groups/${g.id}`}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 hover:border-primary/60"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="font-mono">
                  {storyline.abbreviation}
                  {g.sequence}
                </Badge>
                <span className="font-medium">{g.name}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {day ? <Badge variant="muted">{day.identifier}</Badge> : "no day"}
              </div>
            </Link>
          );
        })}
        {groups.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No letter groups yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
