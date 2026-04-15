import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  let counts = {
    storylines: 0,
    letterGroups: 0,
    inspectionLetters: 0,
    sortingLetters: 0,
    rules: 0,
    playthroughs: 0,
  };
  let envError: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const tables = [
      ["storylines", "storylines"],
      ["letter_groups", "letterGroups"],
      ["inspection_letters", "inspectionLetters"],
      ["sorting_letters", "sortingLetters"],
      ["sorting_rules", "rules"],
      ["playthroughs", "playthroughs"],
    ] as const;
    await Promise.all(
      tables.map(async ([table, key]) => {
        const { count } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        (counts as Record<string, number>)[key] = count ?? 0;
      })
    );
  } catch (err) {
    envError =
      err instanceof Error
        ? err.message
        : "Could not reach Supabase. Check .env.local.";
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of the game data and active playthrough."
      />
      {envError ? (
        <Card className="mb-6 border-warning/50">
          <CardHeader>
            <CardTitle className="text-warning">Database not reachable</CardTitle>
            <CardDescription>{envError}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Copy <code className="font-mono">.env.local.example</code> to{" "}
            <code className="font-mono">.env.local</code> and fill in the
            Supabase URL, publishable key, service-role key, and DATABASE_URL.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Storylines" value={counts.storylines} href="/storylines" />
        <StatCard
          label="Letter groups"
          value={counts.letterGroups}
          href="/storylines"
        />
        <StatCard
          label="Inspection letters"
          value={counts.inspectionLetters}
          href="/storylines"
        />
        <StatCard
          label="Sorting letters"
          value={counts.sortingLetters}
          href="/sorting/letters"
        />
        <StatCard label="Sorting rules" value={counts.rules} href="/sorting/rules" />
        <StatCard
          label="Playthroughs"
          value={counts.playthroughs}
          href="/playthroughs"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums group-hover:text-primary">
        {value}
      </div>
    </Link>
  );
}
