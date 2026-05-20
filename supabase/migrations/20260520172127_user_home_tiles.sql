-- Per-user home page tile selections + order.
-- Each row is one user's customized list of nav hrefs shown as tiles on `/`.
-- Depends on public.set_updated_at() defined in 0001_init.sql.

create table if not exists public.user_home_tiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tile_hrefs text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create or replace trigger user_home_tiles_set_updated_at
  before update on public.user_home_tiles
  for each row execute function public.set_updated_at();

alter table public.user_home_tiles enable row level security;

-- Postgres has no `create policy if not exists`; drop-then-create keeps the
-- migration safe to re-run.
drop policy if exists "user_home_tiles_select_own" on public.user_home_tiles;
create policy "user_home_tiles_select_own" on public.user_home_tiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_home_tiles_insert_own" on public.user_home_tiles;
create policy "user_home_tiles_insert_own" on public.user_home_tiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_home_tiles_update_own" on public.user_home_tiles;
create policy "user_home_tiles_update_own" on public.user_home_tiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
