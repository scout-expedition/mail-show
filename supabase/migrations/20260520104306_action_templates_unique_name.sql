-- Enforce case-insensitive uniqueness of action template names. The admin
-- UI auto-suffixes new "New action" inserts to side-step the conflict; this
-- index is the structural backstop that also rejects inline-rename
-- collisions.
create unique index if not exists action_templates_name_lower_unique
  on public.action_templates (lower(name));
