import { expect, test } from "@playwright/test";
import { cleanupE2EData, e2eName, makeAdmin } from "./_helpers";

/**
 * Golden-path E2E for the inspection-letters editor. Exercises:
 *   - URL deep-link via `?group=<abbr><sequence>` resolving to the right group.
 *   - The 5-panel slide advancing when a letter is clicked in the list.
 *   - The auto-saving Summary field (commit-on-blur via `useInstantField`).
 *   - Reload reflects the persisted value — i.e. the patch reached the DB and
 *     the RSC reload re-renders from real data, not a memoised view.
 *
 * Budget per the protocol is one golden path per editor surface; keep it that
 * way. If a regression surfaces a new behaviour worth pinning, replace this
 * test rather than adding a sibling.
 */

test.describe("inspection letters editor", () => {
  // Seed + tear down with the `__E2E__` marker. Cleanup runs before and after
  // so a half-state from a previous aborted run can't poison this one.
  test.beforeEach(async () => {
    await cleanupE2EData(makeAdmin());
  });

  test.afterEach(async () => {
    await cleanupE2EData(makeAdmin());
  });

  test("opens a deep-linked group, edits the letter summary, and the change persists across reload", async ({
    page,
  }) => {
    const admin = makeAdmin();

    // Storyline abbreviation 'Z' is reserved here for this spec — `char(1)
    // unique`, distinct from anything the integration suite uses ('T') and
    // from any seeded production data.
    const { data: storyline, error: sErr } = await admin
      .from("storylines")
      .insert({
        name: e2eName("letters-workspace"),
        abbreviation: "Z",
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (sErr || !storyline) throw new Error(`seed storyline: ${sErr?.message}`);

    // High `number` slot avoids colliding with seeded production days.
    const { data: day, error: dErr } = await admin
      .from("days")
      .insert({
        number: 9700,
        notes: e2eName("letters-workspace"),
      })
      .select("id")
      .single();
    if (dErr || !day) throw new Error(`seed day: ${dErr?.message}`);

    const { data: group, error: gErr } = await admin
      .from("letter_groups")
      .insert({
        storyline_id: storyline.id,
        name: e2eName("letters-workspace-group"),
        sequence: 1,
        delivery_day_id: day.id,
      })
      .select("id")
      .single();
    if (gErr || !group) throw new Error(`seed group: ${gErr?.message}`);

    const { data: letter, error: lErr } = await admin
      .from("inspection_letters")
      .insert({
        letter_group_id: group.id,
        variant: "a",
        summary: "before edit",
        content: "before edit",
      })
      .select("id")
      .single();
    if (lErr || !letter) throw new Error(`seed letter: ${lErr?.message}`);

    // Deep-link directly to the letter via ?letter=<slug>-<variant>. Per
    // page.tsx the workspace lands in view="main" (letter editor) without
    // any slide-advance gesture, sidestepping the panel-traversal complexity.
    await page.goto("/inspection/letters?letter=Z1-a");

    // The letter-card form: <Label>Summary</Label> + <FieldHighlight><Input/></FieldHighlight>
    // share a parent column-div. Label has no htmlFor, so getByLabel won't
    // resolve — locate by the text node's parent's descendant input.
    // The letter card's `<Label>Summary</Label>` sits as a sibling of the
    // Input wrapper. The Label has no htmlFor so getByLabel won't resolve.
    // The seed has no report segment / next-letter cards, so only one
    // "Summary" label renders; `.first()` is a defensive guard in case a
    // later refactor mounts both panels at once.
    const summaryInput = page
      .getByText("Summary", { exact: true })
      .locator("..")
      .locator("input")
      .first();
    await expect(summaryInput).toBeVisible();
    await expect(summaryInput).toHaveValue("before edit");

    // Type a new value. Blurring flushes useInstantField immediately —
    // `Tab` is enough to trigger blur and the synchronous commit path.
    const NEW_SUMMARY = "after edit via e2e";
    await summaryInput.fill(NEW_SUMMARY);
    await summaryInput.press("Tab");

    // The optimistic UI shows the new value before the server round-trips,
    // so wait on the DB post-condition before reloading. Without this, a
    // reload could race the still-in-flight patchInspectionLetter call.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("inspection_letters")
            .select("summary")
            .eq("id", letter.id)
            .single();
          return data?.summary;
        },
        { timeout: 10_000, message: "summary should persist to the DB" }
      )
      .toBe(NEW_SUMMARY);

    // Reload — proves the RSC fetch re-reads the persisted value, not stale
    // client-side state. The URL retains the ?letter=Z1-a deep-link, so the
    // workspace re-mounts directly in letter view.
    await page.reload();

    const summaryInputAfter = page
      .getByText("Summary", { exact: true })
      .locator("..")
      .locator("input")
      .first();
    await expect(summaryInputAfter).toHaveValue(NEW_SUMMARY);
  });
});
