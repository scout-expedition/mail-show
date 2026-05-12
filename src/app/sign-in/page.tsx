import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "./sign-in-form";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string; reset?: string }>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in with email and password, or get a magic link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInFormAsync searchParams={searchParams} />
        </CardContent>
      </Card>
    </div>
  );
}

async function SignInFormAsync({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sent?: string; reset?: string }>;
}) {
  const { next, error, sent, reset } = await searchParams;
  return (
    <SignInForm
      next={next}
      error={error}
      sent={sent === "1"}
      reset={reset === "1"}
    />
  );
}
