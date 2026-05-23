/**
 * Slugify a user-facing name into a stable URL slug.
 *
 * Mirrors the SQL `public.slugify(text)` function so client and DB agree
 * on uniqueness. Two distinct names whose slugs collide (e.g. "Foo!"
 * and "Foo?") are rejected by the unique indexes.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
