create table public.action_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  icon_type public.icon_type not null default 'lucide',
  icon_value text,
  color_hex text not null default '#888888',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger action_templates_set_updated_at before update on public.action_templates
  for each row execute function public.set_updated_at();

alter table public.actions
  add column action_template_id uuid references public.action_templates(id) on delete set null;
create index actions_template_idx on public.actions(action_template_id);

alter table public.action_templates enable row level security;
create policy "action_templates_read" on public.action_templates for select using (true);
create policy "action_templates_write" on public.action_templates for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into public.action_templates (name, icon_type, icon_value, color_hex, sort_order) values
  ('Deliver', 'lucide', 'Mail', '#3b82f6', 1),
  ('Flag',    'lucide', 'Flag', '#ef4444', 2),
  ('Return',  'lucide', 'Undo2', '#f59e0b', 3),
  ('Redirect','lucide', 'Forward', '#8b5cf6', 4),
  ('Destroy', 'lucide', 'Trash2', '#64748b', 5);
