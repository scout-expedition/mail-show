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
import type { Storyline } from "@/lib/db/types";
import { deleteStoryline, updateStoryline } from "../actions";

export default async function StorylineDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: sData } = await supabase
    .from("storylines")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!sData) notFound();
  const storyline = sData as Storyline;

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
        description={storyline.notes ?? undefined}
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
          <Label>Notes</Label>
          <Textarea
            name="notes"
            defaultValue={storyline.notes ?? ""}
            rows={2}
          />
        </div>
      </AutoSaveForm>

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
