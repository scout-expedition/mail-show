import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set a password</CardTitle>
          <CardDescription>
            Pick a password to finish setting up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm error={error} />
        </CardContent>
      </Card>
    </div>
  );
}
