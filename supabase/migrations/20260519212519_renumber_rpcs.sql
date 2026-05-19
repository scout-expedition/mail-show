-- 0041: transactional renumber RPCs.
--
-- The Edit-ID popup and "Renumber sequentially" actions reassign display-ID
-- columns that carry UNIQUE constraints (letter_groups.sequence,
-- inspection_letters.variant/piece, report_segments.variant). They need a
-- park -> final two-pass so a row-by-row reassignment never trips the
-- constraint mid-flight. Doing that two-pass from the client is NOT atomic:
-- a failure between passes strands rows on placeholder values and the
-- content-ID views render broken until a re-run heals them.
--
-- These PL/pgSQL functions run the whole two-pass inside one transaction
-- (a function body is atomic), so a renumber either fully applies or fully
-- rolls back. They are SECURITY INVOKER, so RLS applies exactly as it does
-- to the equivalent inline UPDATEs.
--
-- Each takes a jsonb array of assignments that the caller has already made
-- collision-free; the temp-park only guards the intermediate row-by-row
-- states, not the final set.

create or replace function public.apply_letter_group_sequences(
  p_storyline_id uuid,
  p_assignments jsonb
)
returns void
language plpgsql
as $$
declare
  a jsonb;
  idx int := 0;
begin
  -- Pass 1: park every affected group on a distinct negative sequence.
  for a in select value from jsonb_array_elements(p_assignments) loop
    idx := idx + 1;
    update public.letter_groups
      set sequence = -idx
      where id = (a->>'groupId')::uuid
        and storyline_id = p_storyline_id;
  end loop;
  -- Pass 2: write final sequences; mirror onto report_groups.display_order.
  for a in select value from jsonb_array_elements(p_assignments) loop
    update public.letter_groups
      set sequence = (a->>'newSequence')::int
      where id = (a->>'groupId')::uuid
        and storyline_id = p_storyline_id;
    update public.report_groups
      set display_order = (a->>'newSequence')::int
      where letter_group_id = (a->>'groupId')::uuid;
  end loop;
end;
$$;

create or replace function public.apply_inspection_letter_variants(
  p_group_id uuid,
  p_assignments jsonb,
  p_updated_by text
)
returns void
language plpgsql
as $$
declare
  a jsonb;
begin
  -- Pass 1: park variant + piece on NULL (NULLs are distinct in the
  -- (letter_group_id, variant, piece) unique index).
  for a in select value from jsonb_array_elements(p_assignments) loop
    update public.inspection_letters
      set variant = null, piece = null
      where id = (a->>'letterId')::uuid
        and letter_group_id = p_group_id;
  end loop;
  -- Pass 2: write final variant + piece.
  for a in select value from jsonb_array_elements(p_assignments) loop
    update public.inspection_letters
      set variant = a->>'newVariant',
          piece = (a->>'newPiece')::int,
          updated_by = p_updated_by
      where id = (a->>'letterId')::uuid
        and letter_group_id = p_group_id;
  end loop;
end;
$$;

create or replace function public.apply_report_segment_variants(
  p_report_group_id uuid,
  p_assignments jsonb,
  p_updated_by text
)
returns void
language plpgsql
as $$
declare
  a jsonb;
begin
  -- Pass 1: park on globally-unique tmp tokens (variant is text NOT NULL).
  for a in select value from jsonb_array_elements(p_assignments) loop
    update public.report_segments
      set variant = 'tmp-' || (a->>'segmentId')
      where id = (a->>'segmentId')::uuid
        and report_group_id = p_report_group_id;
  end loop;
  -- Pass 2: write final variants.
  for a in select value from jsonb_array_elements(p_assignments) loop
    update public.report_segments
      set variant = a->>'newVariant',
          updated_by = p_updated_by
      where id = (a->>'segmentId')::uuid
        and report_group_id = p_report_group_id;
  end loop;
end;
$$;
