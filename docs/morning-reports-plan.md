# Morning Reports — plan & status

Branch: `corey/report-page`.

## What this is

A new **Top of Day › Morning Reports** page (route `/top-of-day/morning-reports`, nav
section "Top of Day") — a day-centric authoring surface for the report a
player reads at the top of each day. It mirrors the Endings › Frameworks page
shell (sidebar list + working area + preview).

## Shipped

- **Nav** — new "Top of Day" section + "Morning Reports" item (Megaphone icon).
- **Schema** — `0038_morning_reports.sql`: `day_report_blocks` table (single
  table discriminated by `kind` = `generic` | `letter_group`), `day_report_blocks_view`
  (adds `day_number` + `R-D{n}/{variant}` `report_id`), RLS, partial unique
  indexes, realtime publication for `day_report_blocks` + `days`.
  `0039_storyline_abbreviation_not_d.sql`: CHECK forbidding storyline
  abbreviation `D` (collides with day ids).
- **Page** — `src/app/(authed)/top-of-day/morning-reports/`:
  - Pinned **intro / sign-off** blocks editing `days.base_report` /
    `days.report_sign_off` — fixed ids `R-D{n}/a` and `R-D{n}/z`, non-deletable,
    non-repositionable (a lock icon marks them).
  - **Letter-group blocks** (auto-derived, reorderable) nesting **Story Report
    Segments** — one per `report_segments` row landing on the day, with the
    `R-W2/i` pill, markdown content + summary editors, and a Trigger list of
    Letter+Action pills that deep-link into Inspection › Letters.
  - **Report Segments** (`R-D3/i`) — free-standing per-day segments;
    user-created (hover "+" insert zones), deletable, reorderable.
  - Shared per-day order across both block kinds; letter-group anchor rows are
    created lazily on first reorder (`reorderDayReportBlocks`), never at render.
  - Three collapse modes (expand / groups-only / collapse); kebab → renumber
    report segments.
  - **Preview** — per previous-day letter group pick one delivered letter +
    one action; resolves to report segments and renders the morning report.
    Local state only.
- **Existing day tab** — `days/[identifier]/top-of-day` made read-only for the
  report intro / sign-off (editing moved to the new page).
- Extracted `MarkdownTextarea` to `src/components/markdown-textarea.tsx`; added
  `ActionPill` to `src/components/pills.tsx`.

## Verification done

`pnpm typecheck`, `pnpm lint` (new files clean), `pnpm build` all pass.
Migrations `0038`/`0039` applied and verified (table, view, indexes, RLS,
constraints, realtime publication).

## Followups / not done

- `pnpm db:migrate` re-runs every migration and fails on the pre-existing
  non-idempotent `0020_endings_aggregate.sql` against a populated DB — `0038`/
  `0039` were applied directly instead. Unrelated to this feature; worth fixing
  the migrator or `0020` separately.
- Peer field edits surface via a 300ms-debounced `router.refresh()` on
  postgres_changes (no per-row local mirror) — fine for this low-traffic tool;
  revisit if it feels heavy.
- No automated tests added for the new surface yet.
