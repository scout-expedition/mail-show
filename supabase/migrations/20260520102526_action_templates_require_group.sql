-- Backfill: every action_template without a group_id gets its own solo group,
-- with the group inheriting the template's sort_order so the visual ordering
-- of the top-level list is preserved.
--
-- After this migration, the admin UI guarantees `group_id IS NOT NULL` for
-- newly-created templates (the server actions wrap each insert in a group).
-- Existing rows are reconciled here.

do $$
declare
  tpl record;
  gid uuid;
begin
  for tpl in
    select id, sort_order
    from public.action_templates
    where group_id is null
    order by sort_order
  loop
    insert into public.action_template_groups (name, sort_order)
      values (null, tpl.sort_order)
      returning id into gid;
    update public.action_templates
      set group_id = gid
      where id = tpl.id;
  end loop;
end $$;
