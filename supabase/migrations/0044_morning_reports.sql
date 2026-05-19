-- 0044_morning_reports.sql
--
-- Introduces `day_report_blocks`, the backing table for the Morning Reports
-- feature. Each row represents one block in a day's morning-report view:
--
--   kind = 'generic'       — freeform authored block; identified by a short
--                            variant slug (e.g. 'intro', 'weather'). Carries
--                            content + summary text columns. These blocks
--                            produce display IDs in the form R-D{n}/{variant}.
--
--   kind = 'letter_group'  — anchored to a specific letter_group_id; inherits
--                            its content from the group's inspection letters
--                            and carries no separate content/summary.
--
-- A CHECK constraint (`day_report_blocks_kind_payload`) enforces the
-- per-kind payload rules so the two shapes stay well-typed at the DB level.
--
-- Unique indexes prevent duplicate letter-group anchors and duplicate
-- generic-variant slugs within the same day.
--
-- Realtime publication + replica identity are added at the end following
-- the pattern established in 0031, 0040, 0041, 0043.
--
-- Idempotent: uses CREATE … IF NOT EXISTS, CREATE OR REPLACE, and
-- DROP … IF EXISTS guards throughout. Policies follow the repo convention:
-- drop-if-exists then create (matches 0001_init.sql pattern).

create table if not exists public.day_report_blocks (
  id uuid primary key default uuid_generate_v4(),
  day_id uuid not null references public.days(id) on delete cascade,
  kind text not null check (kind in ('generic','letter_group')),
  letter_group_id uuid references public.letter_groups(id) on delete cascade,
  variant text,
  content text,
  summary text,
  sort_order int not null default 0,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_report_blocks_kind_payload check (
    (kind = 'generic'
       and letter_group_id is null and variant is not null)
    or (kind = 'letter_group'
       and letter_group_id is not null
       and variant is null and content is null and summary is null)
  )
);
create or replace trigger day_report_blocks_set_updated_at
  before update on public.day_report_blocks
  for each row execute function public.set_updated_at();
create index if not exists day_report_blocks_day_idx
  on public.day_report_blocks(day_id);
create unique index if not exists day_report_blocks_lg_anchor_unique
  on public.day_report_blocks(day_id, letter_group_id) where kind = 'letter_group';
create unique index if not exists day_report_blocks_generic_variant_unique
  on public.day_report_blocks(day_id, variant) where kind = 'generic';

alter table public.day_report_blocks enable row level security;
drop policy if exists "day_report_blocks_authenticated" on public.day_report_blocks;
create policy "day_report_blocks_authenticated" on public.day_report_blocks
  for all to authenticated using (true) with check (true);

create or replace view public.day_report_blocks_view as
select drb.*, d.number as day_number,
  case when drb.kind = 'generic'
    then 'R-D' || d.number::text || '/' || drb.variant
    else null end as report_id
from public.day_report_blocks drb
join public.days d on d.id = drb.day_id;

do $$ declare t text; begin
  for t in select unnest(array['day_report_blocks','days']) loop
    if not exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t)
    then execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
