import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { signOut } from "@/app/sign-in/actions";
import { UsersSection, type UserRow } from "./users-section";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: me } = await supabase.auth.getUser();
  const currentEmail = me.user?.email ?? null;
  const currentUserId = me.user?.id ?? null;

  let users: UserRow[] = [];
  let usersError: string | null = null;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;
    users = data.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? "(no email)",
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  } catch (e) {
    usersError = e instanceof Error ? e.message : "Failed to load users";
  }

  return (
    <div>
      <PageHeader title="Settings" description="Environment and account." />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
          <CardDescription>{currentEmail ?? "(no session)"}</CardDescription>
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
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Invite people by email. They&apos;ll get a link to set a password and
            sign in. Delete a user to revoke their access immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersError ? (
            <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
              {usersError}
            </p>
          ) : (
            <UsersSection users={users} currentUserId={currentUserId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
