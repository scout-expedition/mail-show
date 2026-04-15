import { redirect } from "next/navigation";

export default async function DayIndex({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  redirect(`/days/${identifier}/overview`);
}
