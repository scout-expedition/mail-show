-- Rename the `description` column on storylines to `notes` to be consistent
-- with the naming convention used on letter_groups, report_groups, and other
-- tables in the schema (all of which call this field `notes`).
--
-- No view selects from storylines by column (they join to it by id only),
-- so no view drop+recreate is required.

alter table public.storylines rename column description to notes;
