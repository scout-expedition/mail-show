-- Smart Variables: user-created variables defined by a condition-block
-- tree that resolves to a free-text string. Modeled as ending_documents
-- of kind='smart_variable' paired 1:1 with an ending_variables row of
-- kind='smart_ref'. Each pair has a fallback block (singleton) but no
-- starting-value block — fallback wins if no condition matches.

-- 1) Extend the ending_document_kind enum.
--
-- `alter type ... add value` cannot run inside a transaction that also
-- references the new value in the same statement, so this is done in its
-- own `do` block. The check uses pg_enum to stay idempotent (running this
-- migration twice is a no-op).
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'smart_variable'
      and enumtypid = 'ending_document_kind'::regtype
  ) then
    alter type ending_document_kind add value 'smart_variable';
  end if;
end $$;

-- 2) Relax the name_shape constraint so smart_variable docs carry a name.
--
-- Previously: name not null iff kind='framework'. Now: name not null
-- iff kind in ('framework','smart_variable'); the four logic singletons
-- stay anonymous (name is null) as before.
alter table public.ending_documents
  drop constraint if exists ending_documents_name_shape;
alter table public.ending_documents
  add constraint ending_documents_name_shape
    check (
      (kind in ('framework','smart_variable') and name is not null)
      or (kind not in ('framework','smart_variable') and name is null)
    );

-- 3) Relax the per-kind singleton index so users can create many
-- smart_variable docs alongside the seed-immortal logic singletons.
drop index if exists public.ending_documents_singleton_kinds;
create unique index if not exists ending_documents_singleton_kinds
  on public.ending_documents (kind)
  where kind not in ('framework','smart_variable');

-- 4) Smart variable names are unique across smart variables (so the
-- variable picker doesn't show duplicates and `@[Name]` substitution
-- resolves unambiguously).
create unique index if not exists ending_documents_smart_variable_name_unique
  on public.ending_documents (name)
  where kind = 'smart_variable';

-- 5) Extend ending_variables.kind to allow 'smart_ref' and add the
-- pairing FK column. The variable row is the public-facing identity of a
-- smart variable (it's what shows up in chip pickers); the doc holds the
-- condition-block tree.
alter table public.ending_variables
  drop constraint if exists ending_variables_kind_check;
alter table public.ending_variables
  add constraint ending_variables_kind_check
    check (kind in ('text','number_ref','aggregate_ref','smart_ref'));

alter table public.ending_variables
  add column if not exists smart_variable_doc_id uuid;

-- FK separately so we can name it deterministically and onto a soft delete
-- cascade. The pair lives or dies together: deleting the doc cascades to
-- the variable row.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ending_variables_smart_variable_doc_fk'
  ) then
    alter table public.ending_variables
      add constraint ending_variables_smart_variable_doc_fk
        foreign key (smart_variable_doc_id)
        references public.ending_documents(id)
        on delete cascade;
  end if;
end $$;

-- Reshape the shape CHECK so smart_ref rows have exactly the
-- smart_variable_doc_id slot populated, mirroring how text/number_ref/
-- aggregate_ref each populate exactly one of their fields.
alter table public.ending_variables
  drop constraint if exists ending_variables_kind_shape;
alter table public.ending_variables
  add constraint ending_variables_kind_shape
    check (
      (kind = 'text'           and number_ref is null and aggregate_ref is null and smart_variable_doc_id is null)
      or (kind = 'number_ref'    and number_ref is not null and aggregate_ref is null and smart_variable_doc_id is null)
      or (kind = 'aggregate_ref' and number_ref is null     and aggregate_ref is not null and smart_variable_doc_id is null)
      or (kind = 'smart_ref'     and number_ref is null     and aggregate_ref is null     and smart_variable_doc_id is not null)
    );
