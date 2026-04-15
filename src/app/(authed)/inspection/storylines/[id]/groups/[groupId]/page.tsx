import { redirect } from "next/navigation";

export default async function OldGroupRedirect({
  params,
}: {
  params: Promise<{ id: string; groupId: string }>;
}) {
  const { groupId } = await params;
  redirect(`/inspection/letters/${groupId}`);
}
