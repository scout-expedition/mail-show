alter table public.inspection_letters
  add column sort_order int not null default 0;

update public.inspection_letters il
set sort_order = sub.rn
from (
  select id,
         row_number() over (
           partition by letter_group_id
           order by variant nulls first, piece nulls first, created_at
         ) as rn
  from public.inspection_letters
) sub
where il.id = sub.id;

create index inspection_letters_group_sort_idx
  on public.inspection_letters(letter_group_id, sort_order);
