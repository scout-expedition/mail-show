create table if not exists public.keep_alive (
  id bigint generated always as identity primary key,
  inserted_at timestamptz not null default now()
);
