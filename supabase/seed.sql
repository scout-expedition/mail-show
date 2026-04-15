-- Seed the five nations with default colors matching --nation-* CSS tokens.
insert into public.nations (name, abbreviation, color_hex, sort_order)
values
  ('Epicenter', 'E', '#c84a4a', 1),
  ('Folos',     'F', '#4bb4e0', 2),
  ('Emberlyn',  'M', '#d18a2e', 3),
  ('Spokgrad',  'S', '#7a7fbf', 4),
  ('Pelico',    'P', '#4fb07a', 5)
on conflict (name) do nothing;
