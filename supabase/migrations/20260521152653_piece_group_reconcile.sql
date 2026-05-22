-- reconcile_piece_group(letter_group_id, variant)
--
-- After any mutation that changes the membership of a piece cluster
-- (letter_group_id, variant) with piece >= 1, call this RPC to:
--   * auto-demote a lone survivor (set piece = NULL, making it standalone)
--   * rewrite actions.next_letter_id refs that targeted a removed / no-longer-
--     lowest piece to point at the new lowest-piece member
--
-- The function is idempotent and safe to call repeatedly.

create or replace function public.reconcile_piece_group(
  p_letter_group_id uuid,
  p_variant char(1)
) returns void
language plpgsql
security definer
as $$
declare
  v_count int;
  v_survivor_id uuid;
  v_new_lowest_id uuid;
begin
  -- Count current members of the cluster (piece >= 1).
  select count(*) into v_count
  from public.inspection_letters
  where letter_group_id = p_letter_group_id
    and variant = p_variant
    and piece >= 1;

  if v_count = 0 then
    return;
  elsif v_count = 1 then
    -- Demote the lone survivor to standalone.
    update public.inspection_letters
       set piece = null
     where letter_group_id = p_letter_group_id
       and variant = p_variant
       and piece >= 1
    returning id into v_survivor_id;
    return;
  else
    -- >=2 members. Identify the new lowest-piece survivor.
    select id into v_new_lowest_id
    from public.inspection_letters
    where letter_group_id = p_letter_group_id
      and variant = p_variant
      and piece >= 1
    order by piece asc
    limit 1;

    -- Rewrite any actions.next_letter_id that points at a non-lowest
    -- piece in this cluster to point at the new lowest.
    update public.actions a
       set next_letter_id = v_new_lowest_id
      from public.inspection_letters il
     where a.next_letter_id = il.id
       and il.letter_group_id = p_letter_group_id
       and il.variant = p_variant
       and il.piece >= 1
       and il.id <> v_new_lowest_id;
  end if;
end;
$$;

grant execute on function public.reconcile_piece_group(uuid, char) to authenticated, service_role;
