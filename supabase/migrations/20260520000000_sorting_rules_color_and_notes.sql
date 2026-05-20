-- Per-rule color (used by the rule pill in the list row + panel header) and a
-- free-form notes field shown at the bottom of the inspection panel. Both
-- nullable -- existing rules keep rendering with the default muted-foreground
-- pill until a color is picked.

alter table public.sorting_rules
  add column if not exists color_hex text,
  add column if not exists notes text;
