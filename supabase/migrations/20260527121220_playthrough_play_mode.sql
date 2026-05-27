-- Play-through mode foundation (Phase 1A of docs/plans/active/play-through-mode-plan.md).
--
-- Adds the server-time-authoritative timer columns to playthroughs, the
-- fallback-applied flag on action choices, four new log/history/firing
-- tables, the reference-settings singleton, the reference storage bucket
-- with RLS, realtime publication wiring, and the delivered-letters view.
--
-- Idempotent-friendly: every create uses `if not exists`, policies are
-- recreated, triggers/indexes are guarded.

-- ----------------------------------------------------------------------
-- 1) playthroughs — timer + furthest-progress + ended-state columns.
-- ----------------------------------------------------------------------
alter table public.playthroughs
  add column if not exists started_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists total_paused_ms bigint not null default 0,
  add column if not exists phase_started_at timestamptz,
  add column if not exists phase_paused_at timestamptz,
  add column if not exists phase_total_paused_ms bigint not null default 0,
  add column if not exists phase_allotted_override_ms bigint,
  add column if not exists furthest_day_id uuid references public.days(id) on delete set null,
  add column if not exists furthest_phase public.phase,
  add column if not exists started boolean not null default false,
  add column if not exists ended boolean not null default false,
  add column if not exists ending_document_id uuid references public.ending_documents(id) on delete set null;

-- Only one active playthrough at a time (closes the race in setActivePlaythrough).
create unique index if not exists playthroughs_one_active
  on public.playthroughs ((true))
  where is_active = true;

-- ending_document_id must point at an ending_documents row with kind='framework'.
create or replace function public.playthroughs_validate_ending_document()
returns trigger
language plpgsql
as $$
declare
  doc_kind public.ending_document_kind;
begin
  if new.ending_document_id is null then
    return new;
  end if;
  select kind into doc_kind from public.ending_documents where id = new.ending_document_id;
  if doc_kind is null then
    raise exception 'ending_document_id % does not exist', new.ending_document_id;
  end if;
  if doc_kind <> 'framework' then
    raise exception 'ending_document_id must reference an ending_documents row with kind=framework (got %)', doc_kind;
  end if;
  return new;
end
$$;

drop trigger if exists playthroughs_validate_ending_document on public.playthroughs;
create trigger playthroughs_validate_ending_document
  before insert or update on public.playthroughs
  for each row execute function public.playthroughs_validate_ending_document();

-- ----------------------------------------------------------------------
-- 2) playthrough_action_choices — applied_via_fallback flag.
-- ----------------------------------------------------------------------
alter table public.playthrough_action_choices
  add column if not exists applied_via_fallback boolean not null default false;

-- ----------------------------------------------------------------------
-- 3) playthrough_phase_log — one row per (playthrough, day, phase) entry.
-- ----------------------------------------------------------------------
create table if not exists public.playthrough_phase_log (
  id uuid primary key default uuid_generate_v4(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  day_id uuid not null references public.days(id) on delete cascade,
  phase public.phase not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  elapsed_ms bigint,
  allotted_ms bigint,
  overtime_ms bigint,
  superseded_at timestamptz,
  version int not null default 1
);

-- At most one open row per playthrough/day/phase at any time.
create unique index if not exists playthrough_phase_log_one_open
  on public.playthrough_phase_log (playthrough_id, day_id, phase)
  where superseded_at is null and exited_at is null;

-- ----------------------------------------------------------------------
-- 4) playthrough_phase_timer_adjustments — +/- second buttons + restarts.
-- ----------------------------------------------------------------------
create table if not exists public.playthrough_phase_timer_adjustments (
  id uuid primary key default uuid_generate_v4(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  day_id uuid not null references public.days(id) on delete cascade,
  phase public.phase not null,
  delta_ms bigint not null,
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete set null
);

-- ----------------------------------------------------------------------
-- 5) playthrough_action_choice_history — audit of overridden choices.
-- ----------------------------------------------------------------------
create table if not exists public.playthrough_action_choice_history (
  id uuid primary key default uuid_generate_v4(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  inspection_letter_id uuid not null references public.inspection_letters(id) on delete cascade,
  chosen_action_id uuid references public.actions(id) on delete set null,
  set_at timestamptz not null,
  unset_at timestamptz not null default now(),
  set_by uuid references auth.users(id) on delete set null,
  was_fallback boolean not null default false
);

-- ----------------------------------------------------------------------
-- 6) playthrough_report_segments_fired — TOD fire-once log.
-- ----------------------------------------------------------------------
create table if not exists public.playthrough_report_segments_fired (
  id uuid primary key default uuid_generate_v4(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  day_id uuid not null references public.days(id) on delete cascade,
  report_segment_id uuid not null references public.report_segments(id) on delete cascade,
  fired_at timestamptz not null default now(),
  unique (playthrough_id, day_id, report_segment_id)
);

-- ----------------------------------------------------------------------
-- 7) playthrough_reference_settings — singleton; map_image_url.
-- ----------------------------------------------------------------------
create table if not exists public.playthrough_reference_settings (
  id uuid primary key default uuid_generate_v4(),
  map_image_url text,
  updated_at timestamptz not null default now()
);

create or replace trigger playthrough_reference_settings_set_updated_at
  before update on public.playthrough_reference_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------
-- 8) Reference-map storage bucket + RLS policies.
-- ----------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('playthrough-reference', 'playthrough-reference', true)
on conflict (id) do nothing;

drop policy if exists "playthrough_reference_public_read" on storage.objects;
create policy "playthrough_reference_public_read" on storage.objects
  for select to public
  using (bucket_id = 'playthrough-reference');

drop policy if exists "playthrough_reference_authed_write" on storage.objects;
create policy "playthrough_reference_authed_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'playthrough-reference');

drop policy if exists "playthrough_reference_authed_update" on storage.objects;
create policy "playthrough_reference_authed_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'playthrough-reference')
  with check (bucket_id = 'playthrough-reference');

drop policy if exists "playthrough_reference_authed_delete" on storage.objects;
create policy "playthrough_reference_authed_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'playthrough-reference');

-- ----------------------------------------------------------------------
-- 9) RLS on the new tables — authenticated full access (mirrors 0001).
-- ----------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'playthrough_phase_log',
    'playthrough_phase_timer_adjustments',
    'playthrough_action_choice_history',
    'playthrough_report_segments_fired',
    'playthrough_reference_settings'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all', t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------
-- 10) Realtime publication — playthroughs + action choices (not yet in)
--     and all four new mutable tables. replica identity full so update
--     payloads include the prior row.
-- ----------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'playthroughs',
    'playthrough_action_choices',
    'playthrough_phase_log',
    'playthrough_phase_timer_adjustments',
    'playthrough_action_choice_history',
    'playthrough_report_segments_fired'
  ]) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------
-- 11) playthrough_delivered_letters_view — letters available on the
--     current day, resolved across scheduled effective_day_id and
--     prior-day branches (next_letter_id from chosen actions).
--
-- Per-playthrough; queries always filter `where playthrough_id = $1`.
-- ----------------------------------------------------------------------
drop view if exists public.playthrough_delivered_letters_view;
create view public.playthrough_delivered_letters_view as
with scheduled as (
  select p.id as playthrough_id, ilv.*
  from public.playthroughs p
  join public.inspection_letters_view ilv
    on ilv.effective_day_id = p.current_day_id
),
branch_seeds as (
  select pac.playthrough_id, a.next_letter_id as letter_id
  from public.playthrough_action_choices pac
  join public.actions a on a.id = pac.chosen_action_id
  join public.inspection_letters il on il.id = a.inspection_letter_id
  join public.inspection_letters_view ilv on ilv.id = il.id
  join public.playthroughs p on p.id = pac.playthrough_id
  join public.days d_src on d_src.id = ilv.effective_day_id
  join public.days d_cur on d_cur.id = p.current_day_id
  where a.next_letter_id is not null
    and d_src.number < d_cur.number
),
branch as (
  select bs.playthrough_id, ilv.*
  from branch_seeds bs
  join public.inspection_letters_view ilv on ilv.id = bs.letter_id
)
select * from scheduled
union
select * from branch;
