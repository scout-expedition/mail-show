alter table public.action_templates
  add column paired_template_id uuid references public.action_templates(id) on delete set null;
create index action_templates_paired_idx
  on public.action_templates(paired_template_id);
