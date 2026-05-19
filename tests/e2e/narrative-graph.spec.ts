import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupE2EData, e2eName, makeAdmin } from "./_helpers";

/**
 * Golden-path E2E for the narrative graph editor — Phase 4 of the test-suite
 * remediation roadmap. The protocol budget for this surface is one drag,
 * one assertion:
 *
 *   1. Seed a storyline + two days + one letter group on day A.
 *   2. Drag the group's xyflow node from day A's row to day B's row.
 *   3. Assert the DB row reflects the move (`delivery_day_id = dayB`).
 *   4. Reload and re-query the DB to assert persistence (revalidatePath
 *      from `moveLetterGroupToDay` flushed both /graph and /inspection/letters).
 *
 * Why drive the assertion through the DB rather than xyflow's DOM:
 *   - xyflow node positions are derived from the React Flow store and a
 *     layout pass; pinning a test to pixel x/y is brittle and tells us
 *     nothing about durability.
 *   - The whole point of `moveLetterGroupToDay` is to mutate
 *     `letter_groups.delivery_day_id` and revalidate. That's the
 *     contract — the post-condition belongs in the DB.
 *
 * Selectors:
 *   - xyflow v12 renders every node wrapper with
 *     `data-testid="rf__node-<nodeId>"` (see
 *     node_modules/@xyflow/react/dist/esm/index.mjs line ~2240). For the
 *     letter-group node, `nodeId` is `group:<groupId>` (see
 *     `makeGroupNodeId` in src/app/(authed)/graph/graph-view.tsx). For day
 *     row bands it is `band:<dayId>` — these are the row-wide drop targets
 *     `rowAtFlowY` resolves into when reading the cursor position on drop.
 *   - The pill inside the group node is wrapped in `.group-drag-handle`;
 *     xyflow only accepts drags that begin inside that handle (configured
 *     via `dragHandle` on the node spec). Targeting any other point on the
 *     node body would no-op.
 *
 * Pre-flight:
 *   - `next.config.ts` must keep `allowedDevOrigins: ["127.0.0.1"]`. Without
 *     it the server-action POST issued on drop is rejected as cross-origin
 *     and the drag appears to land in the UI but never reaches the DB.
 */

const GROUP_DAY_A = 9800;
const GROUP_DAY_B = 9801;

/** Pre-cleanup belt-and-suspenders: remove any leftover `X` storyline rows
 *  from a prior aborted run, in case the prefix-based sweep missed something
 *  (storylines.abbreviation is UNIQUE char(1), so a stale row would block
 *  this run's seed). */
async function cleanupResidualGraphData(sb: SupabaseClient): Promise<void> {
  await cleanupE2EData(sb);
}

test.describe("narrative graph", () => {
  test.beforeEach(async () => {
    await cleanupResidualGraphData(makeAdmin());
  });

  test.afterEach(async () => {
    await cleanupE2EData(makeAdmin());
  });

  test("drags a letter group from one day to another and persists the move", async ({
    page,
  }) => {
    const admin = makeAdmin();

    // ----- Seed -------------------------------------------------------------
    const { data: storyline, error: sErr } = await admin
      .from("storylines")
      .insert({
        name: e2eName("graph-drag"),
        abbreviation: "X",
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (sErr || !storyline) throw new Error(`seed storyline: ${sErr?.message}`);

    const { data: insertedDays, error: dErr } = await admin
      .from("days")
      .insert([
        { number: GROUP_DAY_A, notes: e2eName("graph-drag-a") },
        { number: GROUP_DAY_B, notes: e2eName("graph-drag-b") },
      ])
      .select("id, number")
      .order("number");
    if (dErr || !insertedDays || insertedDays.length !== 2) {
      throw new Error(`seed days: ${dErr?.message}`);
    }
    const dayA = insertedDays.find((d) => d.number === GROUP_DAY_A)!;
    const dayB = insertedDays.find((d) => d.number === GROUP_DAY_B)!;

    const { data: group, error: gErr } = await admin
      .from("letter_groups")
      .insert({
        storyline_id: storyline.id,
        name: e2eName("graph-drag-group"),
        sequence: 1,
        delivery_day_id: dayA.id,
      })
      .select("id, delivery_day_id")
      .single();
    if (gErr || !group) throw new Error(`seed letter_group: ${gErr?.message}`);
    expect(group.delivery_day_id).toBe(dayA.id);

    // ----- Open the graph ---------------------------------------------------
    // Drag-and-drop is gated behind the editing toggle (persisted in
    // localStorage as `graph.editingEnabled`; default false). Pre-set it
    // via addInitScript so the page mounts in edit mode — more reliable
    // than racing a post-mount click.
    await page.addInitScript(() => {
      localStorage.setItem("graph.editingEnabled", JSON.stringify(true));
    });
    await page.goto("/graph");

    // Confirm we're in edit mode (the toggle's aria-label reflects the
    // action it will perform when clicked).
    await expect(
      page.getByRole("button", { name: "Disable drag and drop" })
    ).toBeVisible();

    // Wait for both the source group node and the destination day row to
    // render. xyflow wraps nodes with data-testid="rf__node-<nodeId>". For
    // a group with NO letters carrying day overrides (our seed), the
    // primary node id is just `group:<groupId>`. If this spec ever seeds
    // letters with overrides, the id format gains an `@<dayKey>` suffix
    // (see `makeGroupNodeId` in graph-view.tsx) — guard against that here.
    // ReactFlow's `fitView` prop on initial mount frames every node with a
    // 10% padding (graph-view.tsx, around the `<ReactFlow ... fitView>`
    // block) — so our seeded rows at day numbers 9800/9801 sit inside the
    // viewport without any extra zoom plumbing.
    const groupNode = page.getByTestId(`rf__node-group:${group.id}`);
    const targetRow = page.getByTestId(`rf__node-band:${dayB.id}`);
    await expect(groupNode).toBeVisible();
    await expect(targetRow).toBeVisible();

    // ----- Drag the group from day A's row down to day B's row -------------
    // xyflow restricts the drag origin to `.group-drag-handle` (set on the
    // node spec); a mousedown elsewhere on the node is ignored. We aim for
    // the center of the handle for source and the center of the target row
    // band for destination, with two intermediate moves so d3-drag's drag
    // threshold trips and `onNodeDrag` fires before `onNodeDragStop`.
    const handle = groupNode.locator(".group-drag-handle");
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    const targetBox = await targetRow.boundingBox();
    if (!handleBox || !targetBox) {
      throw new Error("drag: failed to compute bounding boxes");
    }
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = handleBox.x + handleBox.width / 2; // stay in the same storyline column
    const endY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Two intermediate steps so xyflow registers a real drag (not a click).
    await page.mouse.move(startX, (startY + endY) / 2, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // ----- Assert the move landed in the DB --------------------------------
    // Server actions revalidate but the DB write itself is the contract.
    // Poll the row until `delivery_day_id` flips, then assert. expect.poll
    // applies its outer `timeout`, not Vitest's — keep it tight so a
    // genuine miss fails fast.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("letter_groups")
            .select("delivery_day_id")
            .eq("id", group.id)
            .single();
          return data?.delivery_day_id ?? null;
        },
        { timeout: 10_000 }
      )
      .toBe(dayB.id);

    // ----- Reload and re-assert from a clean page state --------------------
    await page.reload();
    await expect(
      page.getByTestId(`rf__node-group:${group.id}`)
    ).toBeVisible();

    // Poll the DB again on the reloaded state to match the letters spec's
    // defensive pattern — guards against a rare race where reload fires
    // before revalidation commits.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("letter_groups")
            .select("delivery_day_id")
            .eq("id", group.id)
            .single();
          return data?.delivery_day_id ?? null;
        },
        { timeout: 10_000 }
      )
      .toBe(dayB.id);
  });
});
