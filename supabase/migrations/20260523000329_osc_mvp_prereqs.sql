-- OSC MVP prerequisite schema.
--
-- Adds the minimum schema the OSC bridge needs:
--   * phase timer state on playthroughs (started/paused timestamps)
--   * playthrough_slot_state to mirror RFID drops + sorting eval results
--   * slots reference table mapping slot_id -> role (report | sorting)
--   * realtime publication entries for the new + relevant tables
--
-- Canonical Deliver / Flag action templates already exist on the remote DB
-- and are referenced by the bridge by name (action_templates.name), so this
-- migration does not seed them.

-- 1. Phase timer state ------------------------------------------------------
alter table public.playthroughs
  add column if not exists phase_started_at timestamptz,
  add column if not exists phase_paused_at  timestamptz;

-- 2. Slots reference table --------------------------------------------------
-- Sorting rules already use destination_slot 1..8 plus a boolean
-- routes_to_reporting; the OSC bridge needs to look up a slot_id (as
-- transmitted by the RFID reader) and learn whether it's the report tray
-- (drives flagLetter during inspection) or a sorting destination
-- (drives chooseAction "deliver"). Slot 0 is the report tray by
-- convention; slots 1..8 mirror sorting_rules.destination_slot.
create table if not exists public.slots (
  slot_id smallint primary key,
  role text not null check (role in ('report', 'sorting')),
  notes text
);

insert into public.slots (slot_id, role, notes) values
  (0, 'report',  'Report tray — RFID drop here flags during inspection'),
  (1, 'sorting', null),
  (2, 'sorting', null),
  (3, 'sorting', null),
  (4, 'sorting', null),
  (5, 'sorting', null),
  (6, 'sorting', null),
  (7, 'sorting', null),
  (8, 'sorting', null)
on conflict (slot_id) do nothing;

alter table public.slots enable row level security;

drop policy if exists slots_select_authenticated on public.slots;
create policy slots_select_authenticated on public.slots
  for select to authenticated using (true);

-- 3. playthrough_slot_state ------------------------------------------------
-- Holds the current physical_letter dropped in each slot for a given
-- playthrough, plus the most recent sorting rule eval result. The OSC
-- bridge writes; the sorting UI reads via Supabase realtime.
create table if not exists public.playthrough_slot_state (
  id uuid primary key default gen_random_uuid(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  slot_id smallint not null references public.slots(slot_id),
  physical_letter_id uuid references public.physical_letters(id) on delete set null,
  sorting_rule_id uuid references public.sorting_rules(id) on delete set null,
  passed boolean,
  error_code text,
  evaluated_at timestamptz,
  observed_at timestamptz not null default now(),
  unique (playthrough_id, slot_id)
);

create index if not exists playthrough_slot_state_playthrough_idx
  on public.playthrough_slot_state (playthrough_id);

alter table public.playthrough_slot_state enable row level security;

drop policy if exists pss_select_authenticated on public.playthrough_slot_state;
create policy pss_select_authenticated on public.playthrough_slot_state
  for select to authenticated using (true);

drop policy if exists pss_modify_authenticated on public.playthrough_slot_state;
create policy pss_modify_authenticated on public.playthrough_slot_state
  for all to authenticated using (true) with check (true);

-- 4. Realtime publication ---------------------------------------------------
-- The bridge subscribes to postgres_changes; without REPLICA IDENTITY FULL
-- delete payloads omit prior column values, and tables not in the
-- publication emit nothing at all.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'playthroughs'
  ) then
    alter publication supabase_realtime add table public.playthroughs;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'playthrough_action_choices'
  ) then
    alter publication supabase_realtime add table public.playthrough_action_choices;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'playthrough_slot_state'
  ) then
    alter publication supabase_realtime add table public.playthrough_slot_state;
  end if;
end$$;

alter table public.playthroughs                replica identity full;
alter table public.playthrough_action_choices  replica identity full;
alter table public.playthrough_slot_state      replica identity full;
