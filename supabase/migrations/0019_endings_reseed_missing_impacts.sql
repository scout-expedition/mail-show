-- Backfill three impact-column variables that 0016 skipped because the
-- author had already created same-named user variables (which the same
-- migration's cleanup pass then deleted, leaving the rows missing
-- entirely). Uses the same uuid_generate_v5 namespace so future runs
-- against fresh DBs stay deterministic.

do $$
declare
  ns uuid := '0e3f1c00-0000-0000-0000-000000000000';
  rows record;
begin
  for rows in
    select * from (values
      ('world_status'::text, 'World Status'::text, 0, 10000),
      ('spokgrad',           'Spokgrad',           7, 10007),
      ('pelico',             'Pelico',             8, 10008)
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
    on conflict (id) do nothing;
  end loop;
end $$;
