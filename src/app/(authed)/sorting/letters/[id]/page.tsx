import { redirect } from "next/navigation";

/**
 * The sorting letter detail page is now the editor panel on the letters
 * workspace. This route stays as a redirect so existing links keep landing on
 * the right letter; the workspace drops the param if the letter is gone.
 */
export default async function SortingLetterDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sorting/letters?letter=${encodeURIComponent(id)}`);
}
