import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AutoSaveForm } from "@/components/auto-save-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, LetterGroup, Storyline } from "@/lib/db/types";
import { createLetterGroup, deleteStoryline, updateStoryline } from "../actions";

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
          <Link href="/inspection/storylines">
            <Button variant="ghost" size="sm">
              All storylines
            </Button>
          </Link>
        }
      />

      <AutoSaveForm action={updateStoryline} className="grid grid-cols-6 gap-3">
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
        <div className="col-span-6 flex flex-col gap-1.5">
          <Label>Icon</Label>
          <IconPicker
            initialType={storyline.icon_type}
            initialValue={storyline.icon_value}
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
      </AutoSaveForm>

      <h2 className="mb-3 mt-8 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Letter groups
      </h2>

      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const day = days.find((d) => d.id === g.delivery_day_id);
          return (
            <Link
              key={g.id}
              href={`/inspection/letters/${g.id}`}
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

      <div className="mt-4 flex justify-center">
        <form action={createLetterGroup}>
          <input type="hidden" name="storyline_id" value={storyline.id} />
          <Button type="submit" variant="outline" size="sm">
            + Letter group
          </Button>
        </form>
      </div>

      <div className="mt-10 flex justify-center">
        <form action={deleteStoryline}>
          <input type="hidden" name="id" value={storyline.id} />
          <Button type="submit" variant="outline" size="sm">
            Delete storyline
          </Button>
        </form>
      </div>
    </div>
  );
}
