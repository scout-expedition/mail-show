-- Endings: optional custom color override on ending_variables.
--
-- `color_index` (added in 0014) keeps the auto-assigned palette index;
-- `color_hex` is a user-set override that takes precedence in the UI.
-- Null = use the palette color. Format is a 7-char hex string with `#`
-- prefix (matching storylines.color_hex).
--
-- The chip + preview render code already prefers `color_hex` over the
-- palette (see VariableState.color_hex in src/lib/endings/block-state.ts);
-- this migration adds the storage column.
--
-- Idempotent-friendly per project convention.

alter table public.ending_variables
  add column if not exists color_hex text;

alter table public.ending_variables
  drop constraint if exists ending_variables_color_hex_format;

alter table public.ending_variables
  add constraint ending_variables_color_hex_format
    check (
      color_hex is null
      or color_hex ~ '^#[0-9a-fA-F]{6}$'
    );
