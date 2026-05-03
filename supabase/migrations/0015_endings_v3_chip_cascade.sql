-- Match the v2 variable-delete UX: deleting a variable cascades into the
-- chips that reference it. v3 originally set this FK to ON DELETE RESTRICT,
-- but the variables tab confirmation already promises a cascading delete and
-- the editor handles a row losing all its chips gracefully (the row simply
-- never matches and the author re-chips it).

alter table public.ending_condition_row_chips
  drop constraint ending_condition_row_chips_variable_id_fkey;

alter table public.ending_condition_row_chips
  add constraint ending_condition_row_chips_variable_id_fkey
    foreign key (variable_id) references public.ending_variables(id) on delete cascade;
