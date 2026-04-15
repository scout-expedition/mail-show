import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/sign-in/actions";
import { addAllowlistEntry, removeAllowlistEntry } from "./actions";

type AllowRow = { id: string; kind: "email" | "domain"; value: string };

export default async function SettingsPage() {
  let email: string | null = null;
  let rows: AllowRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data: u } = await supabase.auth.getUser();
    email = u.user?.email ?? null;
    const { data } = await supabase
      .from("allowed_emails")
      .select("id,kind,value")
      .order("kind", { ascending: true })
      .order("value", { ascending: true });
    rows = (data as AllowRow[] | null) ?? [];
  } catch {
    // env not set
  }
  const emails = rows.filter((r) => r.kind === "email");
  const domains = rows.filter((r) => r.kind === "domain");

  const envEmails = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const envDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div>
      <PageHeader title="Settings" description="Environment and account." />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
          <CardDescription>{email ?? "(no session)"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allow-list</CardTitle>
          <CardDescription>
            Stored in the <code className="font-mono text-xs">allowed_emails</code>{" "}
            table. Env vars{" "}
            <code className="font-mono text-xs">ALLOWED_EMAILS</code> /{" "}
            <code className="font-mono text-xs">ALLOWED_EMAIL_DOMAINS</code> remain
            a bootstrap fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 text-sm">
          <AllowSection
            title="Emails"
            kind="email"
            placeholder="someone@example.com"
            rows={emails}
            envValues={envEmails}
          />
          <AllowSection
            title="Domains"
            kind="domain"
            placeholder="example.com"
            rows={domains}
            envValues={envDomains}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function AllowSection({
  title,
  kind,
  placeholder,
  rows,
  envValues,
}: {
  title: string;
  kind: "email" | "domain";
  placeholder: string;
  rows: AllowRow[];
  envValues: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </div>

      <form action={addAllowlistEntry} className="flex gap-2">
        <input type="hidden" name="kind" value={kind} />
        <Input
          name="value"
          placeholder={placeholder}
          required
          className="max-w-xs font-mono text-xs"
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>

      {rows.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span>{r.value}</span>
              <form action={removeAllowlistEntry}>
                <input type="hidden" name="id" value={r.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-0 text-muted-foreground hover:text-destructive"
                >
                  remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">(none in database)</p>
      )}

      {envValues.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Env bootstrap:{" "}
          <span className="font-mono">{envValues.join(", ")}</span>
        </p>
      ) : null}
    </div>
  );
}
