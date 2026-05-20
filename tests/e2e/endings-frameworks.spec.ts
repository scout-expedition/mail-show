import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * SKIPPED until step 6 of docs/plans/active/endings-logic-v2-plan.md rewrites this
 * spec for the unified ending_documents schema. The setup hooks below
 * still reference the dropped ending_frameworks table; restoring this
 * file means rewriting it against the new shape (and adding logic-tab
 * coverage), not flipping the .skip back off.
 *
 * Original golden flow for the v3 endings frameworks editor:
 *   1. Seed two text variables + values via the service-role client (faster
 *      and less brittle than driving the variables tab UI).
 *   2. Open /endings/frameworks, create a framework.
 *   3. Add a condition block, two chips on its row (PERFORMER=WINTER and
 *      MOOD=STORMY), and a text block under the row.
 *   4. Save, reload, assert chips persist.
 *   5. Toggle preview, set both vars to matching values → content renders.
 *      Flip MOOD → content disappears.
 */

const PREFIX = "__E2E_FW__";

function makeAdmin() {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("e2e: missing SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.beforeEach(async () => {
  const admin = makeAdmin();
  // Cascades clean up rows/chips/blocks via FK on delete.
  await admin.from("ending_frameworks").delete().like("name", `${PREFIX}%`);
  await admin.from("ending_variables").delete().like("name", `${PREFIX}%`);
});

test.afterEach(async () => {
  const admin = makeAdmin();
  await admin.from("ending_frameworks").delete().like("name", `${PREFIX}%`);
  await admin.from("ending_variables").delete().like("name", `${PREFIX}%`);
});

test.skip("create multi-variable condition, save + reload, preview matches", async ({
  page,
}) => {
  const admin = makeAdmin();

  // Seed variables. Use UUIDs the server actions would also generate.
  const performerName = `${PREFIX}PERFORMER`;
  const moodName = `${PREFIX}MOOD`;

  const { data: performer, error: pErr } = await admin
    .from("ending_variables")
    .insert({
      name: performerName,
      kind: "text",
      sort_order: 9999,
      // color_index left at default 0 — Phase 1 only renders it.
    })
    .select("id")
    .single();
  if (pErr || !performer) throw new Error(`seed performer: ${pErr?.message}`);

  const { data: mood, error: mErr } = await admin
    .from("ending_variables")
    .insert({
      name: moodName,
      kind: "text",
      sort_order: 9999,
    })
    .select("id")
    .single();
  if (mErr || !mood) throw new Error(`seed mood: ${mErr?.message}`);

  const performerId = performer.id as string;
  const moodId = mood.id as string;

  const { data: winter } = await admin
    .from("ending_variable_values")
    .insert({ variable_id: performerId, value: "WINTER", sort_order: 0 })
    .select("id")
    .single();
  await admin
    .from("ending_variable_values")
    .insert({ variable_id: performerId, value: "SUMMER", sort_order: 1 });

  const { data: stormy } = await admin
    .from("ending_variable_values")
    .insert({ variable_id: moodId, value: "STORMY", sort_order: 0 })
    .select("id")
    .single();
  await admin
    .from("ending_variable_values")
    .insert({ variable_id: moodId, value: "CALM", sort_order: 1 });

  if (!winter || !stormy) throw new Error("seed values");

  // Seed the framework via the admin client too — keeps the E2E focused on
  // the new chip/row UI rather than the (unchanged) "+ Framework" button.
  const frameworkName = `${PREFIX}fw-${Date.now()}`;
  const { data: fw, error: fwErr } = await admin
    .from("ending_frameworks")
    .insert({ name: frameworkName, sort_order: 9999 })
    .select("id")
    .single();
  if (fwErr || !fw) throw new Error(`seed framework: ${fwErr?.message}`);

  await page.goto(`/endings/frameworks?framework=${fw.id}`);
  await expect(page.getByPlaceholder("Framework name")).toHaveValue(
    frameworkName
  );

  // Add a condition block. Server-action revalidation may take a beat in
  // dev mode, so allow extra wait time for the new row to render.
  await page.getByRole("button", { name: "condition", exact: true }).click();
  await expect(page.getByText(/Condition · 1 row/i)).toBeVisible({
    timeout: 20000,
  });

  // Phase 6: declare PERFORMER + MOOD on the header before chips can
  // be added. The "+ var" pill is the header's add-variable picker.
  await page.getByRole("button", { name: "+ var" }).first().click();
  await page.getByRole("combobox").last().selectOption({ label: performerName });
  await expect(
    page.getByRole("button", { name: `Add ${performerName} chip` }).first()
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "+ var" }).first().click();
  await page.getByRole("combobox").last().selectOption({ label: moodName });
  // With 2 declared vars, the row "+" relabels to generic "Add chip".
  await expect(
    page.getByRole("button", { name: "Add chip" }).first()
  ).toBeVisible({ timeout: 20000 });

  // With 2 declared vars, the row "+" opens a chooser. Pick PERFORMER,
  // set WINTER, confirm. Then again for MOOD = STORMY.
  await page.getByRole("button", { name: "Add chip" }).first().click();
  await page
    .getByRole("button", { name: `Add ${performerName} chip` })
    .click();
  await page.getByRole("combobox").nth(1).selectOption({ label: "WINTER" });
  await page.getByRole("button", { name: "✓" }).click();
  await page.getByRole("button", { name: "Add chip" }).first().click();
  await page.getByRole("button", { name: `Add ${moodName} chip` }).click();
  await page.getByRole("combobox").nth(1).selectOption({ label: "STORMY" });
  await page.getByRole("button", { name: "✓" }).click();

  // Add a text block under the row. The row's nested list renders before
  // root in DOM order, so its "+ text" pill is the first one.
  await page.getByRole("button", { name: "text", exact: true }).first().click();
  // Fill the textarea that just appeared under the row.
  const rowTextarea = page.getByPlaceholder("Paragraph text…").first();
  await expect(rowTextarea).toBeVisible();
  await rowTextarea.fill("the winter rose blooms in the storm");

  // Save.
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1500);

  // Reload and assert chips persist. Each variable appears twice (header
  // chip + row chip pill), so .first() to disambiguate.
  await page.reload();
  await expect(page.getByText(performerName).first()).toBeVisible();
  await expect(page.getByText(moodName).first()).toBeVisible();
  // The text block's content lives in a <textarea> — check its value.
  await expect(page.getByPlaceholder("Paragraph text…").first()).toHaveValue(
    "the winter rose blooms in the storm"
  );

  // Enter preview.
  await page.getByRole("button", { name: "Preview" }).click();

  // Set both variables to matching values → content renders.
  await page.getByLabel(performerName).selectOption({ label: "WINTER" });
  await page.getByLabel(moodName).selectOption({ label: "STORMY" });
  await expect(
    page.getByText("the winter rose blooms in the storm")
  ).toBeVisible();

  // Flip MOOD to a non-matching value → content disappears.
  await page.getByLabel(moodName).selectOption({ label: "CALM" });
  await expect(
    page.getByText("the winter rose blooms in the storm")
  ).toHaveCount(0);
});

test.skip("aggregate (Class Affinity top=) drives preview", async ({ page }) => {
  // Migration 0020 seeds Class Affinity / Nation Affinity. Build a
  // framework with one aggregate row and verify the underlying
  // proletariat / gentry inputs in the preview drive the row state.
  const admin = makeAdmin();
  const frameworkName = `${PREFIX}aggfw-${Date.now()}`;
  const { data: fw } = await admin
    .from("ending_frameworks")
    .insert({ name: frameworkName, sort_order: 9999 })
    .select("id")
    .single();
  if (!fw) throw new Error("seed framework");

  await page.goto(`/endings/frameworks?framework=${fw.id}`);
  await expect(page.getByPlaceholder("Framework name")).toHaveValue(
    frameworkName
  );

  await page.getByRole("button", { name: "condition", exact: true }).click();
  await expect(page.getByText(/Condition · 1 row/i)).toBeVisible({
    timeout: 20000,
  });

  // Declare Class Affinity on the header, then click its row slot to
  // confirm the default chip (top is Working Class).
  await page.getByRole("button", { name: "+ var" }).first().click();
  await page
    .getByRole("combobox")
    .last()
    .selectOption({ label: "Class Affinity" });
  await expect(
    page.getByRole("button", { name: "Add Class Affinity chip" }).first()
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Add Class Affinity chip" })
    .first()
    .click();
  // Operator defaults to "top=" and value to proletariat (Working Class)
  // for class_affinity, so we can confirm directly.
  await page.getByRole("button", { name: "✓" }).click();
  await expect(page.getByText("CLASS AFFINITY").first()).toBeVisible();

  // Add row content.
  await page.getByRole("button", { name: "text", exact: true }).first().click();
  const rowTextarea = page.getByPlaceholder("Paragraph text…").first();
  await expect(rowTextarea).toBeVisible();
  await rowTextarea.fill("the working class is on top");

  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1500);

  await page.reload();
  await expect(page.getByText("CLASS AFFINITY").first()).toBeVisible();
  await expect(page.getByPlaceholder("Paragraph text…").first()).toHaveValue(
    "the working class is on top"
  );

  // Preview: the chip's underlying scores (proletariat + gentry) should
  // surface as numeric inputs even though the chip itself is aggregate.
  // The seeded variables are labeled "Working Class" and "Upper Class".
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByLabel("Working Class", { exact: true }).fill("5");
  await page.getByLabel("Upper Class", { exact: true }).fill("2");
  await expect(page.getByText("the working class is on top")).toBeVisible();

  // Flip the scores so gentry wins → row should stop firing.
  await page.getByLabel("Working Class", { exact: true }).fill("2");
  await page.getByLabel("Upper Class", { exact: true }).fill("5");
  await expect(page.getByText("the working class is on top")).toHaveCount(0);
});

test.skip("static analysis: shadowed row + uncovered assignment badges", async ({
  page,
}) => {
  // Phase 5: build a framework where row 2 is fully shadowed by row 1
  // (identical chip), and a third value falls through (uncovered).
  // Asserts both the "shadowed by row 1" badge and the
  // "N assignments uncovered" header badge.
  const admin = makeAdmin();

  const performerName = `${PREFIX}PERFORMER_S`;
  const { data: performer } = await admin
    .from("ending_variables")
    .insert({ name: performerName, kind: "text", sort_order: 9999 })
    .select("id")
    .single();
  if (!performer) throw new Error("seed performer");
  await admin
    .from("ending_variable_values")
    .insert([
      { variable_id: performer.id, value: "WINTER", sort_order: 0 },
      { variable_id: performer.id, value: "SUMMER", sort_order: 1 },
      { variable_id: performer.id, value: "AUTUMN", sort_order: 2 },
    ]);

  const frameworkName = `${PREFIX}staticfw-${Date.now()}`;
  const { data: fw } = await admin
    .from("ending_frameworks")
    .insert({ name: frameworkName, sort_order: 9999 })
    .select("id")
    .single();
  if (!fw) throw new Error("seed framework");

  await page.goto(`/endings/frameworks?framework=${fw.id}`);
  await expect(page.getByPlaceholder("Framework name")).toHaveValue(
    frameworkName
  );

  // Add a condition block.
  await page.getByRole("button", { name: "condition", exact: true }).click();
  await expect(page.getByText(/Condition · 1 row/i)).toBeVisible({
    timeout: 20000,
  });

  // Phase 6: declare PERFORMER on the header.
  await page.getByRole("button", { name: "+ var" }).first().click();
  await page.getByRole("combobox").last().selectOption({ label: performerName });
  await expect(
    page.getByRole("button", { name: `Add ${performerName} chip` }).first()
  ).toBeVisible({ timeout: 20000 });

  // Row 1: PERFORMER = WINTER (slot picker)
  await page
    .getByRole("button", { name: `Add ${performerName} chip` })
    .first()
    .click();
  await page.getByRole("combobox").nth(1).selectOption({ label: "WINTER" });
  await page.getByRole("button", { name: "✓" }).click();
  await expect(page.getByText(performerName).first()).toBeVisible();

  // Add a second row.
  await page.getByRole("button", { name: "row", exact: true }).click();
  await expect(page.getByText(/Condition · 2 row/i)).toBeVisible();

  // Row 2: PERFORMER = WINTER (identical → should be shadowed). After
  // row 1 has its chip, both rows have an "Add PERFORMER chip" button,
  // so target the second one (row 2) explicitly. The picker form's
  // value select is the last combobox on the page (existing chips' op +
  // value overlay selects sit before it in DOM order).
  await page
    .getByRole("button", { name: `Add ${performerName} chip` })
    .nth(1)
    .click();
  await page.getByRole("combobox").last().selectOption({ label: "WINTER" });
  await page.getByRole("button", { name: "✓" }).click();

  // Static analysis runs on every chipState change — the shadowed badge
  // should appear without saving or reloading.
  await expect(
    page.getByText(/shadowed by row 1/i)
  ).toBeVisible({ timeout: 5000 });

  // The header should also flag uncovered values: SUMMER and AUTUMN
  // both fall through. (The runtime "unset" state is intentionally
  // excluded from authoring analysis.)
  await expect(
    page.getByRole("button", { name: /2 assignments uncovered/i })
  ).toBeVisible();

  // Clicking the badge expands the list; it should mention SUMMER and AUTUMN.
  await page.getByRole("button", { name: /2 assignments uncovered/i }).click();
  await expect(page.getByText("Uncovered assignments")).toBeVisible();
  await expect(page.getByText(/SUMMER/).first()).toBeVisible();
  await expect(page.getByText(/AUTUMN/).first()).toBeVisible();
});

test.skip("seeded impact variable + numeric operator drives preview", async ({
  page,
}) => {
  // Migration 0016 seeds the 10 impact-column variables. The chip picker
  // shows them automatically alongside text variables — no manual creation.
  const numVarLabel = "World Status";

  const admin = makeAdmin();
  const frameworkName = `${PREFIX}numfw-${Date.now()}`;
  const { data: fw } = await admin
    .from("ending_frameworks")
    .insert({ name: frameworkName, sort_order: 9999 })
    .select("id")
    .single();
  if (!fw) throw new Error("seed framework");

  await page.goto(`/endings/frameworks?framework=${fw.id}`);
  await expect(page.getByPlaceholder("Framework name")).toHaveValue(
    frameworkName
  );

  // Add condition block.
  await page.getByRole("button", { name: "condition", exact: true }).click();
  await expect(page.getByText(/Condition · 1 row/i)).toBeVisible({
    timeout: 20000,
  });

  // Phase 6: declare World Status on the header, then click the slot
  // and set operator to ≥. Default value = 0 (auto-fill for number_ref).
  await page.getByRole("button", { name: "+ var" }).first().click();
  await page.getByRole("combobox").last().selectOption({ label: numVarLabel });
  await expect(
    page.getByRole("button", { name: `Add ${numVarLabel} chip` }).first()
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: `Add ${numVarLabel} chip` })
    .first()
    .click();
  await page.getByRole("combobox").nth(0).selectOption("≥");
  await page.getByRole("button", { name: "✓" }).click();
  await expect(
    page.getByText(numVarLabel.toUpperCase()).first()
  ).toBeVisible();

  // Add row content.
  await page.getByRole("button", { name: "text", exact: true }).first().click();
  const rowTextarea = page.getByPlaceholder("Paragraph text…").first();
  await expect(rowTextarea).toBeVisible();
  await rowTextarea.fill("the world holds together");

  // Save.
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1500);

  // Preview.
  await page.getByRole("button", { name: "Preview" }).click();
  // For number_ref, the preview control is a number Input with aria-label
  // = the variable name.
  const numInput = page.getByLabel(numVarLabel);

  // Positive number → ≥ 0 fires.
  await numInput.fill("5");
  await expect(page.getByText("the world holds together")).toBeVisible();

  // Negative number → row doesn't match.
  await numInput.fill("-1");
  await expect(page.getByText("the world holds together")).toHaveCount(0);
});
