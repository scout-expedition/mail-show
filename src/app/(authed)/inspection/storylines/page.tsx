import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { IconDisplay } from "@/components/icon-display";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Storyline } from "@/lib/db/types";
import { createStoryline } from "./actions";

/** Pick white or black text depending on the bg luminance. */
function readableOn(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0b0d10" : "#ffffff";
}

export default async function StorylinesPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("storylines")
    .select("*")
    .order("sort_order")
    .order("name");
  const storylines = (data ?? []) as Storyline[];

  return (
    <div>
      <PageHeader
        title="Storylines"
        description="Each storyline contains letter groups; each letter group contains inspection letters with player actions."
      />

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 60 }} />
            <TH>Name</TH>
            <TH>Description</TH>
          </tr>
        </THead>
        <TBody>
          {storylines.map((s) => (
            <tr
              key={s.id}
              className="cursor-pointer transition-colors hover:bg-accent/40"
            >
              <TD className="p-0">
                <Link
                  href={`/inspection/storylines/${s.id}`}
                  className="flex items-center justify-center px-3 py-2"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[--fg]"
                    style={{
                      background: s.color_hex,
                      // dark/light readable text based on the bg
                      color: readableOn(s.color_hex),
                    }}
                    title={s.abbreviation}
                  >
                    <IconDisplay
                      type={s.icon_type}
                      value={s.icon_value}
                      size={16}
                    />
                  </span>
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/inspection/storylines/${s.id}`}
                  className="block px-3 py-2 font-medium"
                >
                  {s.name}
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/inspection/storylines/${s.id}`}
                  className="block max-w-md truncate px-3 py-2 text-xs text-muted-foreground"
                >
                  {s.description ?? ""}
                </Link>
              </TD>
            </tr>
          ))}
          {storylines.length === 0 ? (
            <tr>
              <TD colSpan={3} className="text-center text-muted-foreground">
                No storylines yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>

      <div className="mt-4 flex justify-center">
        <form action={createStoryline}>
          <Button type="submit" variant="outline" size="sm">
            + Storyline
          </Button>
        </form>
      </div>
    </div>
  );
}
