import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Golden flow for the v3 endings frameworks editor:
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

test("create multi-variable condition, save + reload, preview matches", async ({
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

  // Add the first chip: PERFORMER = WINTER. Picker exposes 3 dropdowns
  // (var, operator, value) plus a ✓ confirm.
  await page.getByRole("button", { name: "+ chip" }).first().click();
  await page.getByRole("combobox").nth(0).selectOption({ label: performerName });
  // operator defaults to '='
  await page.getByRole("combobox").nth(2).selectOption({ label: "WINTER" });
  await page.getByRole("button", { name: "✓" }).click();
  await expect(page.getByText(performerName)).toBeVisible();

  // Add the second chip: MOOD = STORMY.
  await page.getByRole("button", { name: "+ chip" }).first().click();
  await page.getByRole("combobox").nth(0).selectOption({ label: moodName });
  await page.getByRole("combobox").nth(2).selectOption({ label: "STORMY" });
  await page.getByRole("button", { name: "✓" }).click();
  await expect(page.getByText(moodName)).toBeVisible();

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

  // Reload and assert chips persist.
  await page.reload();
  await expect(page.getByText(performerName)).toBeVisible();
  await expect(page.getByText(moodName)).toBeVisible();
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

test("seeded impact variable + numeric operator drives preview", async ({
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

  // Pick the seeded "World Status" number_ref variable from the chip picker.
  // It lives in the "Impact" optgroup; selecting by exact label still works.
  await page.getByRole("button", { name: "+ chip" }).first().click();
  await page
    .getByRole("combobox")
    .nth(0)
    .selectOption({ label: numVarLabel });
  await page.getByRole("combobox").nth(1).selectOption("≥");
  // Variable is number_ref, so comparison value auto-fills to 0; no need
  // to type one. Confirm.
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
