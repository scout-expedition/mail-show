-- Rename the seeded "Gentry" impact variable to "Upper Class" so the
-- Class Affinity group reads "Working Class / Upper Class" instead of
-- "Working Class / Gentry".

update public.ending_variables
set name = 'Upper Class'
where kind = 'number_ref'
  and number_ref = 'gentry'
  and name = 'Gentry';
