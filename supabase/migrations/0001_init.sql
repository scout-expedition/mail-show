-- Mail Show — Phase 1 schema.
-- All authoring tables are readable/writable by any authenticated user.
-- Per the plan: http://claude.ai/code/session_01MCy3cU85XGyn6Lmvfo2uNy plan file.

-- ------------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------------
-- updated_at trigger helper
-- ------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------------
create type public.icon_type as enum ('lucide', 'svg', 'emoji');
create type public.citizen_type as enum ('hero', 'npc');
create type public.day_of_week as enum (
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
);
create type public.phase as enum (
  'top_of_day','sorting','inspection','end_of_day'
);
create type public.address_type as enum (
  'full','lookup_1','lookup_2','lookup_3'
);
create type public.content_ref_type as enum ('sorting','inspection');
create type public.rule_match_mode as enum ('all','any');
create type public.rule_target as enum (
  'sender_name','sender_citizen_id','sender_city_name','sender_city_code','sender_nation',
  'recipient_name','recipient_citizen_id','recipient_city_name','recipient_city_code','recipient_nation',
  'is_counterfeit','current_day_of_week'
);
create type public.rule_target_slice as enum ('whole','first_char','last_char');
create type public.rule_operator as enum ('equals','contains','is','gt','gte','lt','lte');
create type public.rule_reference_type as enum (
  'string','number','even','odd','letter','true','false'
);

-- ------------------------------------------------------------------
-- nations, cities, citizens (reference data)
-- ------------------------------------------------------------------
create table public.nations (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  abbreviation text,
  color_hex text not null default '#888888',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger nations_set_updated_at before update on public.nations
  for each row execute function public.set_updated_at();

create table public.cities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  code text not null,
  nation_id uuid not null references public.nations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, nation_id),
  unique (code, nation_id)
);
create trigger cities_set_updated_at before update on public.cities
  for each row execute function public.set_updated_at();
create index cities_nation_idx on public.cities(nation_id);

create table public.citizens (
  id uuid primary key default uuid_generate_v4(),
  type public.citizen_type not null default 'npc',
  name text not null,
  citizen_id text,
  nation_id uuid references public.nations(id) on delete set null,
  city_id uuid references public.cities(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger citizens_set_updated_at before update on public.citizens
  for each row execute function public.set_updated_at();
create index citizens_nation_idx on public.citizens(nation_id);
create index citizens_city_idx on public.citizens(city_id);
create unique index citizens_citizen_id_unique
  on public.citizens(citizen_id) where citizen_id is not null;

-- ------------------------------------------------------------------
-- days
-- ------------------------------------------------------------------
create table public.days (
  id uuid primary key default uuid_generate_v4(),
  number int not null unique,
  identifier text generated always as ('D' || number) stored,
  notes text,
  until_qup int,
  month int,
  day_of_month int,
  year int,
  day_of_week public.day_of_week,
  sort_phase_length_seconds int,
  inspection_phase_length_seconds int,
  base_report text,
  report_sign_off text,
  end_of_day_sign_off text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger days_set_updated_at before update on public.days
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- storylines, letter_groups, report_groups
-- ------------------------------------------------------------------
create table public.storylines (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  abbreviation char(1) not null unique,
  description text,
  icon_type public.icon_type not null default 'lucide',
  icon_value text,
  color_hex text not null default '#888888',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger storylines_set_updated_at before update on public.storylines
  for each row execute function public.set_updated_at();

create table public.letter_groups (
  id uuid primary key default uuid_generate_v4(),
  storyline_id uuid not null references public.storylines(id) on delete cascade,
  name text not null,
  notes text,
  sequence int not null,
  delivery_day_id uuid references public.days(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storyline_id, sequence)
);
create trigger letter_groups_set_updated_at before update on public.letter_groups
  for each row execute function public.set_updated_at();

create table public.report_groups (
  id uuid primary key default uuid_generate_v4(),
  letter_group_id uuid not null unique references public.letter_groups(id) on delete cascade,
  name text not null,
  notes text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger report_groups_set_updated_at before update on public.report_groups
  for each row execute function public.set_updated_at();

-- Auto-create a report_group whenever a letter_group is created.
create or replace function public.auto_create_report_group() returns trigger
language plpgsql as $$
begin
  insert into public.report_groups (letter_group_id, name, display_order)
  values (new.id, new.name, new.sequence);
  return new;
end;
$$;
create trigger letter_groups_auto_report_group
  after insert on public.letter_groups
  for each row execute function public.auto_create_report_group();

-- ------------------------------------------------------------------
-- inspection_letters, actions
-- ------------------------------------------------------------------
create table public.inspection_letters (
  id uuid primary key default uuid_generate_v4(),
  letter_group_id uuid not null references public.letter_groups(id) on delete cascade,
  variant char(1),
  piece int,
  delivery_day_override_id uuid references public.days(id) on delete set null,
  summary text,
  content text,
  sender_citizen_id uuid references public.citizens(id) on delete set null,
  receiver_citizen_id uuid references public.citizens(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (letter_group_id, variant, piece)
);
create trigger inspection_letters_set_updated_at before update on public.inspection_letters
  for each row execute function public.set_updated_at();
create index inspection_letters_group_idx on public.inspection_letters(letter_group_id);

-- Typed-impact action rows (9 fixed impact columns per the plan).
create table public.actions (
  id uuid primary key default uuid_generate_v4(),
  inspection_letter_id uuid not null references public.inspection_letters(id) on delete cascade,
  name text not null,
  icon_type public.icon_type not null default 'lucide',
  icon_value text,
  color_hex text not null default '#888888',
  report_segment_id uuid, -- fk added later (circular with report_segments)
  next_letter_variant char(1),
  impact_world_status int not null default 0,
  impact_demerits int not null default 0,
  impact_proletariat int not null default 0,
  impact_gentry int not null default 0,
  impact_epicenter int not null default 0,
  impact_folos int not null default 0,
  impact_emberlyn int not null default 0,
  impact_spokgrad int not null default 0,
  impact_pelico int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger actions_set_updated_at before update on public.actions
  for each row execute function public.set_updated_at();
create index actions_letter_idx on public.actions(inspection_letter_id);

-- ------------------------------------------------------------------
-- report_segments
-- ------------------------------------------------------------------
create table public.report_segments (
  id uuid primary key default uuid_generate_v4(),
  report_group_id uuid not null references public.report_groups(id) on delete cascade,
  variant text not null, -- roman numeral: i, ii, iii...
  content text,
  delivery_day_override_id uuid references public.days(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_group_id, variant)
);
create trigger report_segments_set_updated_at before update on public.report_segments
  for each row execute function public.set_updated_at();

alter table public.actions
  add constraint actions_report_segment_fk
  foreign key (report_segment_id) references public.report_segments(id) on delete set null;

-- ------------------------------------------------------------------
-- sorting_letters, physical_letters
-- ------------------------------------------------------------------
create table public.sorting_letters (
  id uuid primary key default uuid_generate_v4(),
  day_id uuid not null references public.days(id) on delete cascade,
  sort_id int not null check (sort_id between 0 and 99),
  storage_location text,
  is_counterfeit boolean not null default false,

  recipient_type public.address_type not null default 'full',
  recipient_citizen_id uuid references public.citizens(id) on delete set null,
  recipient_name text,
  recipient_citizen_number text,
  recipient_city_id uuid references public.cities(id) on delete set null,
  recipient_city_name text,
  recipient_city_code text,
  recipient_nation_id uuid references public.nations(id) on delete set null,

  sender_type public.address_type not null default 'full',
  sender_citizen_id uuid references public.citizens(id) on delete set null,
  sender_name text,
  sender_citizen_number text,
  sender_city_id uuid references public.cities(id) on delete set null,
  sender_city_name text,
  sender_city_code text,
  sender_nation_id uuid references public.nations(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, sort_id)
);
create trigger sorting_letters_set_updated_at before update on public.sorting_letters
  for each row execute function public.set_updated_at();

create table public.physical_letters (
  id uuid primary key default uuid_generate_v4(),
  letter_id int not null unique check (letter_id between 0 and 999999),
  rfid_payload text generated always as ('SL' || lpad(letter_id::text, 6, '0')) stored,
  content_ref_type public.content_ref_type not null,
  content_ref_id uuid not null,
  storage_location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger physical_letters_set_updated_at before update on public.physical_letters
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- sorting_rules + conditions
-- ------------------------------------------------------------------
create table public.sorting_rules (
  id uuid primary key default uuid_generate_v4(),
  letter char(1) not null unique check (letter between 'A' and 'Z'),
  storage_location text,
  summary text,
  day_implemented_id uuid references public.days(id) on delete set null,
  destination_slot int check (destination_slot between 1 and 8),
  match_mode public.rule_match_mode not null default 'all',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sorting_rules_set_updated_at before update on public.sorting_rules
  for each row execute function public.set_updated_at();

create table public.sorting_rule_conditions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.sorting_rules(id) on delete cascade,
  position int not null check (position between 1 and 3),
  target public.rule_target not null,
  target_slice public.rule_target_slice not null default 'whole',
  operator public.rule_operator not null,
  reference_value text,
  reference_type public.rule_reference_type not null default 'string',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, position)
);
create trigger sorting_rule_conditions_set_updated_at before update on public.sorting_rule_conditions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- playthroughs + action choices
-- ------------------------------------------------------------------
create table public.playthroughs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  notes text,
  current_day_id uuid references public.days(id) on delete set null,
  current_phase public.phase not null default 'top_of_day',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger playthroughs_set_updated_at before update on public.playthroughs
  for each row execute function public.set_updated_at();

create table public.playthrough_action_choices (
  id uuid primary key default uuid_generate_v4(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  inspection_letter_id uuid not null references public.inspection_letters(id) on delete cascade,
  chosen_action_id uuid not null references public.actions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playthrough_id, inspection_letter_id)
);
create trigger playthrough_choices_set_updated_at before update on public.playthrough_action_choices
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Views: computed IDs (IL-W2/b3 etc.) and effective delivery days
-- ------------------------------------------------------------------

-- Inspection-letter view: effective_day_id plus formatted content_id.
create view public.inspection_letters_view as
select
  il.*,
  coalesce(il.delivery_day_override_id, lg.delivery_day_id) as effective_day_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  sl.id as storyline_id,
  'IL-' ||
    sl.abbreviation ||
    lg.sequence::text ||
    case when il.variant is not null then '/' || il.variant else '' end ||
    case when il.piece is not null then il.piece::text else '' end
    as content_id
from public.inspection_letters il
join public.letter_groups lg on lg.id = il.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;

-- Report-segment view: effective_day_id (triggering-letter day + 1) and report_id.
create view public.report_segments_view as
select
  rs.*,
  rg.letter_group_id,
  lg.storyline_id,
  sl.abbreviation as storyline_abbreviation,
  lg.sequence as group_sequence,
  'R-' || sl.abbreviation || lg.sequence::text || '/' || rs.variant as report_id,
  -- effective day = triggering letter's effective day + 1, or manual override, or null.
  coalesce(
    rs.delivery_day_override_id,
    (
      select d2.id from public.days d2
      where d2.number = (
        select min(d.number) + 1 from public.days d
        where d.id = coalesce(
          (select min(il2.delivery_day_override_id)
            from public.inspection_letters il2
            where il2.letter_group_id = rg.letter_group_id
              and il2.delivery_day_override_id is not null),
          lg.delivery_day_id
        )
      )
    )
  ) as effective_day_id
from public.report_segments rs
join public.report_groups rg on rg.id = rs.report_group_id
join public.letter_groups lg on lg.id = rg.letter_group_id
join public.storylines sl on sl.id = lg.storyline_id;

-- Sorting-letter view: computed content_id.
create view public.sorting_letters_view as
select
  sl.*,
  d.number as day_number,
  'S' || d.number::text || '-' || lpad(sl.sort_id::text, 2, '0') as content_id
from public.sorting_letters sl
join public.days d on d.id = sl.day_id;

-- ------------------------------------------------------------------
-- Playthrough variable tally (view)
-- ------------------------------------------------------------------
create view public.playthrough_variables as
select
  p.id as playthrough_id,
  coalesce(sum(a.impact_world_status), 0) as world_status,
  coalesce(sum(a.impact_demerits), 0) as demerits,
  coalesce(sum(a.impact_proletariat), 0) as proletariat,
  coalesce(sum(a.impact_gentry), 0) as gentry,
  coalesce(sum(a.impact_epicenter), 0) as epicenter,
  coalesce(sum(a.impact_folos), 0) as folos,
  coalesce(sum(a.impact_emberlyn), 0) as emberlyn,
  coalesce(sum(a.impact_spokgrad), 0) as spokgrad,
  coalesce(sum(a.impact_pelico), 0) as pelico,
  -- combined national affinity excludes epicenter
  coalesce(sum(a.impact_folos + a.impact_emberlyn + a.impact_spokgrad + a.impact_pelico), 0)
    as combined_national
from public.playthroughs p
left join public.playthrough_action_choices pac on pac.playthrough_id = p.id
left join public.actions a on a.id = pac.chosen_action_id
group by p.id;

-- ------------------------------------------------------------------
-- Row Level Security — authenticated users can read/write all tables.
-- ------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'nations','cities','citizens','days','storylines','letter_groups','report_groups',
    'inspection_letters','actions','report_segments','sorting_letters','physical_letters',
    'sorting_rules','sorting_rule_conditions','playthroughs','playthrough_action_choices'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (auth.role() = ''authenticated'')',
      t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (auth.role() = ''authenticated'')',
      t || '_insert', t);
    execute format('create policy %I on public.%I for update using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t || '_update', t);
    execute format('create policy %I on public.%I for delete using (auth.role() = ''authenticated'')',
      t || '_delete', t);
  end loop;
end $$;
