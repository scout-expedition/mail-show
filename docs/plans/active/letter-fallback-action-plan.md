# Inspection letter fallback action (mirror-only)

## Context

Each inspection letter currently has exactly two action options (e.g. "Flag and Deliver", "Refuse"), modeled positionally by `actions.sort_order` ascending. There is no representation of what happens when the player makes no choice — `playthrough_action_choices` stays empty and downstream tallies see zero impacts.

Authors need a third row below the two options in the actions panel that lets them declare a fallback. For this initial change the dropdown has only two states:

- **None** — no fallback.
- **Mirror** — pick one of the existing actions on this letter (e.g. "Flag and Deliver"); the fallback behaves identically. If the mirrored row is later deleted, the fallback automatically reverts to None.

A **Custom** fallback row (full action editor: own impacts, next letter, report) is an explicit follow-up; see §5.

Scope of this change is **editor only** — data model, server actions, and ActionsPanel UI. Playthrough auto-apply and graph rendering are explicit follow-ups too.

## Storage model

With only None and Mirror, mode is fully derivable from a single nullable column: NULL ⇒ None, set ⇒ Mirror. No enum, no flag on `actions`, no rebuilt indexes.

New migration `supabase/migrations/<YYYYMMDDHHMMSS>_letter_fallback_mirror.sql` (generate with `supabase migration new letter_fallback_mirror`):

```sql
alter table public.inspection_letters
  add column if not exists fallback_mirror_action_id uuid
    references public.actions(id) on delete set null;

-- Mirror pointer must target an action that lives on THIS letter.
-- FK alone can't express that join condition, so use a trigger.
create or replace function public.inspection_letters_validate_fallback_mirror()
  returns trigger language plpgsql as $$
declare row_letter uuid;
begin
  if new.fallback_mirror_action_id is null then return new; end if;
  select inspection_letter_id into row_letter
    from public.actions where id = new.fallback_mirror_action_id;
  if row_letter is null or row_letter <> new.id then
    raise exception 'fallback_mirror_action_id must reference an action on this letter';
  end if;
  return new;
end $$;

create or replace trigger inspection_letters_validate_fallback_mirror
  before insert or update on public.inspection_letters
  for each row execute function public.inspection_letters_validate_fallback_mirror();
```

The `on delete set null` on the FK gives us the "deleted action → fallback reverts to None" behavior for free. No extra cleanup logic needed in `deleteActionRow`.

## Code changes

### Types

`src/lib/db/types.ts` — extend `InspectionLetter` and `InspectionLetterView` (around line 109) with `fallback_mirror_action_id: string | null`. No change to `ActionRow`. No new enum.

### Server action (`src/app/(authed)/inspection/letters/actions.ts`)

New `setLetterFallbackMirror(letterId, mirrorActionId | null)`:
- If `mirrorActionId` is non-null, verify in JS that the target action's `inspection_letter_id` equals `letterId` (defense-in-depth on top of the trigger).
- Write `fallback_mirror_action_id` on `inspection_letters`.
- `revalidatePath` `/inspection/letters` and `/graph` (match the pattern of other actions in this file).

No changes needed to `deleteActionRow`, `patchAction`, or any of the existing per-letter action server actions — they're unaffected.

### ActionsPanel UI (`src/app/(authed)/inspection/letters/workspace.tsx`)

- `LetterState` (around line 297) gains `fallback_mirror_action_id: string | null`.
- Reducer: extend the existing letter-patch debounce pattern (used by `patchLetter`, see references around line 8144) to cover the new field, dispatching to `setLetterFallbackMirror`.
- `ActionsPanel` (around line 4008): after the existing `sortedIndices.map` of option rows, render a single `<FallbackActionRow>` with a dashed top border / muted background to demarcate it from the option rows.
- New `<FallbackActionRow>` — one row containing:
  - A "Fallback:" label.
  - A single dropdown built from `LinkField` (`workspace.tsx:5996`), with `PillSelectItem[]` containing:
    - "None" (active when `fallback_mirror_action_id` is null; picking it writes null).
    - One item per existing action on this letter (label = action's name + icon pill; picking it writes that action's id).
  - When set, render a dimmed read-only preview of the mirrored action — its impacts grid + report pill + next-letter pill — by reusing `ImpactBlock` / `ImpactTile` (~line 6234) and the existing pill renderers wrapped with `pointer-events-none opacity-70`.

That's it — no new column on `actions`, no `ActionEditor` variant, no mode enum, no extra delete-cleanup. The whole feature is one column, one trigger, one server action, one dropdown + preview.

### Reusable pieces

- `LinkField` — `src/app/(authed)/inspection/letters/workspace.tsx:5996` — for the dropdown.
- `ImpactBlock` / `ImpactTile` (~line 6234) and the existing report / next-letter pill renderers — for the read-only preview.
- The existing letter-patch debounce reducer — extend, don't replace.

## Out of scope (explicit follow-ups)

- **Custom fallback row.** Adds `fallback_mode` enum on `inspection_letters` and `is_fallback boolean` on `actions`, a new partial unique index for one-fallback-per-letter, an `ActionEditor` `variant="fallback"`, and the rebuild of `actions_letter_template_unique` (from `20260520091211_action_template_groups.sql`) to exclude fallback rows. Separate change.
- **Playthrough auto-apply.** Resolving the fallback into actual impacts and a next-letter when the player advances without choosing — requires a new "lock in choices" gesture and either a sentinel row in `playthrough_action_choices` or a `passed_at` concept. Separate change.
- **Graph dashed edge.** Surfacing the mirrored fallback in `src/app/(authed)/graph/graph-view.tsx` (the mirror points at an existing action whose `next_letter_id` edge is already drawn, so this is purely a visual annotation question). Separate change.
- **Duplicate / clone RPCs.** Audit duplicate-letter and clone-group RPCs to carry `fallback_mirror_action_id` and re-point it at the cloned action when relevant. Separate change.

## Verification

1. Apply the migration locally (`pnpm db:migrate` or `supabase db reset`).
2. Run `pnpm typecheck` and `pnpm lint`.
3. Open `/inspection/letters`, navigate to any letter's Actions panel. Confirm a fallback row appears below the two option rows, demarcated, defaulting to None.
4. **Set mirror:** pick "Flag and Deliver" (or whichever option exists) from the dropdown; dimmed preview of that action's impacts/report/next-letter renders. Reload; persists.
5. **Reset to None:** pick "None"; preview disappears; DB column is NULL.
6. **Auto-revert on delete:** with the fallback mirroring option 1, delete option 1 via its kebab. The fallback dropdown returns to None and `select fallback_mirror_action_id from inspection_letters where id = '<id>'` returns NULL (FK `on delete set null`).
7. **Cross-letter rejected:** `update inspection_letters set fallback_mirror_action_id = '<action on a different letter>'` raises from the trigger.
8. **Options unaffected:** the option-action rows above the fallback row continue to render and edit exactly as before; the playthrough page still shows only two option buttons.
