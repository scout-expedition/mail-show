# E2E test patterns

Playwright. Two specs, period — one per editor surface. Read
`docs/testing-protocol.md` for why we keep this layer this small.

## The two golden paths

### `tests/e2e/inspection-letters.spec.ts`

1. Sign in (programmatic — set the Supabase auth cookie via API, don't drive
   the OAuth flow).
2. Visit `/inspection/letters`.
3. Click into a seeded storyline.
4. Click into a group, then into a letter.
5. Edit the `summary` field, save.
6. Navigate away and back; assert the new summary persisted.
7. Assert URL deep-link params (`?group=...&letter=...`) survive a reload.

Why this path: it exercises all five panels of the slide, the auto-save form,
URL deep-linking, and the confirm/discard flow.

### `tests/e2e/narrative-graph.spec.ts`

1. Sign in.
2. Visit `/graph`.
3. Drag a letter group from day N to day N+1.
4. Assert the node's column×day position updated.
5. Reload; assert it stayed.
6. Drag back; assert the move reverts cleanly.

Why this path: it exercises React Flow, the drag-and-drop server actions
(`moveLetterGroupToDay` and friends), and the props-driven re-render that
makes invalid drops snap back.

## Selector conventions

- Prefer **roles and accessible names** (`getByRole`, `getByLabel`). They
  survive Tailwind churn.
- For xyflow nodes, fall back to `data-testid="graph-node-{groupId}"`. xyflow
  doesn't expose stable accessible names. Add the `data-testid` in
  `src/app/(authed)/graph/nodes/letter-group.tsx` if it isn't there yet.
- Avoid `nth-child`, raw class selectors, or anything keyed on Tailwind
  utility classes.

## Wait conventions

- Use Playwright auto-waiting (`expect(locator).toBeVisible()`). No
  `page.waitForTimeout`.
- For animations on the 5-panel slide, wait on the **transform** value of the
  wrapper or on the visibility of an element inside the destination panel —
  not on a fixed sleep.
- For server actions, wait on the post-condition (the new value rendered) not
  on a network request.

## Auth

Sign-in is allow-list + magic link in dev. For E2E, bypass the UI:

```ts
import { test as base } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const test = base.extend({
  authedPage: async ({ page }, use) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    const { data } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email: "test@example.com",
    });
    // Set the cookie directly from data.properties.action_link or the issued session.
    await page.context().addCookies([/* sb-access-token, sb-refresh-token */]);
    await use(page);
  },
});
```

Keep the helper in `tests/e2e/fixtures.ts`. If the auth flow changes (per the
proxy.ts redirect rules in CLAUDE.md), update there once.

## Running

```sh
pnpm dev          # in one terminal
pnpm test:e2e     # in another
```

Don't try to run the dev server inside Playwright's `webServer` config unless
we add a `pnpm test:e2e:ci` profile that takes the time hit deliberately.

## Playwright agent loop (optional)

If you want to use the `npx playwright init-agents --loop=claude` agents:

- Adopt the **Generator** agent only. Useful for first-pass selectors on
  xyflow nodes.
- Skip the **Planner** — the two specs above are the plan.
- Skip the **Healer** — fix flake by hand. We don't have enough volume to
  justify automated patching, and silent selector rewrites hide real
  regressions.

## Anti-patterns

- Adding a third E2E spec without deleting one. The budget is two.
- Asserting on Tailwind classes (`expect(locator).toHaveClass(/bg-zinc-900/)`).
  Test behaviour, not styling.
- Using `page.waitForTimeout`. Always wait on a real condition.
- Sharing test state between specs. Each spec seeds and tears down its own
  data on the integration branch.
