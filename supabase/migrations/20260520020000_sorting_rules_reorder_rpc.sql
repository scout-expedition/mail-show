-- Bulk-reorder RPC: one round-trip to renumber every rule's sort_order
-- instead of N sequential UPDATE calls. Used by the rules list pane after
-- drag-and-drop and by the "Sort by ID" kebab action.

create or replace function public.reorder_sorting_rules(updates jsonb, updated_by_email text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sorting_rules s
  set sort_order = (u.value->>'sort_order')::int,
      updated_by = coalesce(updated_by_email, s.updated_by)
  from jsonb_array_elements(updates) as u
  where s.id = (u.value->>'id')::uuid;
end;
$$;
