import { redirect } from "next/navigation";

export default async function LegacyGroupRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/inspection/letters?group=${encodeURIComponent(slug)}`);
}
