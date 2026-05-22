-- Endings followup: slug-based uniqueness across frameworks, smart variables,
-- variables, and folders so the `?name=<slug>` URL scheme on the endings pages
-- resolves unambiguously.
--
-- Replaces the older `lower(name)` partial-unique indexes that left slug
-- aliases like `Foo!` vs `Foo?` colliding under the new URL contract.
-- Cross-table (variables ↔ folders) uniqueness is enforced via server-action
-- validation since a single SQL unique index can't span two tables.

-- 1) Slugify helper: must mirror src/lib/slug.ts exactly so client-side
-- pre-flight checks and the DB constraint agree.
create or replace function public.slugify(name text) returns text
  language sql immutable as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(trim(name), '')), '[^a-z0-9]+', '-', 'g'),
    '^-+|-+$', '', 'g'
  )
$$;

-- 2) Drop the old name-based partial indexes that the new slug-based ones
-- supersede. `if exists` keeps the migration idempotent.
drop index if exists public.ending_documents_framework_name_unique;
drop index if exists public.ending_documents_smart_variable_name_unique;

-- 3) Slug-based unique indexes. Partial on kind for the doc-shared table.
create unique index if not exists ending_documents_framework_slug_unique
  on public.ending_documents (public.slugify(name))
  where kind = 'framework';

create unique index if not exists ending_documents_smart_variable_slug_unique
  on public.ending_documents (public.slugify(name))
  where kind = 'smart_variable';

create unique index if not exists ending_variables_slug_unique
  on public.ending_variables (public.slugify(name));

create unique index if not exists ending_variable_folders_slug_unique
  on public.ending_variable_folders (public.slugify(name));
