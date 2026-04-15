import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/sign-in/actions";

export default async function SettingsPage() {
  let email: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
  } catch {
    // env not set
  }
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Environment and account."
      />

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
            Controlled by environment variables. Edit{" "}
            <code className="font-mono text-xs">ALLOWED_EMAILS</code> and{" "}
            <code className="font-mono text-xs">ALLOWED_EMAIL_DOMAINS</code> in{" "}
            <code className="font-mono text-xs">.env.local</code> (or your Vercel env).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Emails
            </div>
            {allowed.length > 0 ? (
              <ul className="mt-1 list-inside list-disc font-mono text-xs">
                {allowed.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">(none configured)</p>
            )}
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Domains
            </div>
            {domains.length > 0 ? (
              <ul className="mt-1 list-inside list-disc font-mono text-xs">
                {domains.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">(none configured)</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
