-- Rename the seeded "Working" impact variable to "Working Class" to match
-- the label authors expect when grouping it under Class Affinity in the
-- chip picker. Identified by number_ref so we don't depend on the prior
-- name string.

update public.ending_variables
set name = 'Working Class'
where kind = 'number_ref'
  and number_ref = 'proletariat'
  and name = 'Working';
