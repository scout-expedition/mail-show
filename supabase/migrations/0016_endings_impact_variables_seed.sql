-- Auto-seed the 10 impact-column variables so authors can compare against
-- them without having to define them by hand. They're invisible in the
-- variables tab (filtered out client-side) but show up in the frameworks
-- chip picker alongside text variables.
--
-- IDs are deterministic via uuid_generate_v5 over a fixed namespace, so
-- re-running the migration (or applying it on a fresh project) produces
-- the same row ids and chips referencing them stay valid across resets.

-- Namespace UUID (any fixed value works — it just has to be stable).
-- Generated once and pinned here.
do $$
declare
  ns uuid := '0e3f1c00-0000-0000-0000-000000000000';
  -- (column, label, color_index, sort_order) tuples.
  rows record;
begin
  for rows in
    select * from (values
      ('world_status'::text, 'World Status'::text, 0, 10000),
      ('demerits',           'Demerits',           1, 10001),
      ('proletariat',        'Working',            2, 10002),
      ('gentry',             'Gentry',             3, 10003),
      ('epicenter',          'Epicenter',          4, 10004),
      ('folos',              'Folos',              5, 10005),
      ('emberlyn',           'Emberlyn',           6, 10006),
      ('spokgrad',           'Spokgrad',           7, 10007),
      ('pelico',             'Pelico',             8, 10008),
      ('combined_national',  'Combined Nat''l',    9, 10009)
    ) as t(col, label, color_idx, sort_idx)
  loop
    insert into public.ending_variables
      (id, name, kind, number_ref, color_index, sort_order)
    values (
      uuid_generate_v5(ns, rows.col),
      rows.label,
      'number_ref',
      rows.col,
      rows.color_idx,
      rows.sort_idx
    )
    on conflict (name) do nothing;
  end loop;
end $$;

-- Clean up any user-created number_ref variables that aren't in the seed.
-- Cascades through chips referencing them (chip→variable FK is ON DELETE
-- CASCADE per migration 0015). This is intentional: the manual-creation
-- path is being removed, so leftovers from the prior UX get cleared so
-- the picker doesn't show duplicates.
delete from public.ending_variables
where kind = 'number_ref'
  and id not in (
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'world_status'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'demerits'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'proletariat'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'gentry'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'epicenter'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'folos'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'emberlyn'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'spokgrad'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'pelico'),
    uuid_generate_v5('0e3f1c00-0000-0000-0000-000000000000'::uuid, 'combined_national')
  );
