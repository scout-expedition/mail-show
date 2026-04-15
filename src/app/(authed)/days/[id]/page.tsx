import { redirect } from "next/navigation";

export default async function DayIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/days/${id}/overview`);
}
