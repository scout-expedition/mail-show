import { afterEach, describe, expect, it } from "vitest";
import {
  addPlaythrough,
  cleanupTestData,
  makeTestClient,
  testName,
} from "./_helpers";

// Non-trivial invariants introduced by 20260527121220_playthrough_play_mode.sql:
//   - `playthroughs_validate_ending_document` trigger (BEFORE INS/UPD):
//     ending_document_id must point at an ending_documents row with
//     kind='framework' when non-null.
//   - `playthroughs_one_active` partial unique index: at most one row with
//     is_active=true at any time.
// Both are load-bearing — the trigger guards the ending evaluator from
// running against a non-framework doc; the index closes the race in
// setActivePlaythrough that the app used to try to enforce in two writes.

const TEST_PREFIX = "__INT_TEST_PLAY__";

async function makeFrameworkDoc(sb: ReturnType<typeof makeTestClient>) {
  const { data, error } = await sb
    .from("ending_documents")
    .insert({
      kind: "framework",
      name: `${TEST_PREFIX}framework-${Math.random()}`,
      sort_order: 9999,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`makeFrameworkDoc: ${error?.message}`);
  return data.id as string;
}

async function getSingletonDocId(
  sb: ReturnType<typeof makeTestClient>,
  kind: string
): Promise<string> {
  const { data, error } = await sb
    .from("ending_documents")
    .select("id")
    .eq("kind", kind)
    .single();
  if (error || !data) throw new Error(`getSingletonDocId(${kind}): ${error?.message}`);
  return data.id as string;
}

describe("playthroughs schema constraints", () => {
  const sb = makeTestClient();

  afterEach(async () => {
    await cleanupTestData(sb);
    // Frameworks aren't cascade-deleted via storyline/playthrough — clean them
    // explicitly so re-runs don't accrete __INT_TEST_PLAY__ rows.
    await sb
      .from("ending_documents")
      .delete()
      .eq("kind", "framework")
      .like("name", `${TEST_PREFIX}%`);
  });

  describe("playthroughs_validate_ending_document trigger", () => {
    it("should accept ending_document_id = null", async () => {
      const id = await addPlaythrough(sb, { suffix: "null-ending" });
      const { error } = await sb
        .from("playthroughs")
        .update({ ending_document_id: null })
        .eq("id", id);
      expect(error).toBeNull();
    });

    it("should accept ending_document_id pointing at a framework-kind document", async () => {
      const id = await addPlaythrough(sb, { suffix: "fw-ending" });
      const docId = await makeFrameworkDoc(sb);
      const { error } = await sb
        .from("playthroughs")
        .update({ ending_document_id: docId })
        .eq("id", id);
      expect(error).toBeNull();
    });

    it("should reject ending_document_id pointing at a non-framework document", async () => {
      const id = await addPlaythrough(sb, { suffix: "bad-ending" });
      // `framework_selection` is a non-framework singleton seeded by 0022.
      const selectionDocId = await getSingletonDocId(sb, "framework_selection");
      const { error } = await sb
        .from("playthroughs")
        .update({ ending_document_id: selectionDocId })
        .eq("id", id);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/framework/i);
    });

    it("should reject ending_document_id pointing at a non-existent row", async () => {
      const id = await addPlaythrough(sb, { suffix: "missing-ending" });
      const { error } = await sb
        .from("playthroughs")
        .update({ ending_document_id: "00000000-0000-0000-0000-000000000000" })
        .eq("id", id);
      // Trigger raises before the FK has a chance to fire, so either signal
      // is acceptable evidence the row was rejected.
      expect(error).not.toBeNull();
    });
  });

  describe("playthroughs_one_active partial unique index", () => {
    it("should allow multiple is_active=false rows", async () => {
      const a = await addPlaythrough(sb, { suffix: "inactive-a" });
      const b = await addPlaythrough(sb, { suffix: "inactive-b" });
      const { data } = await sb
        .from("playthroughs")
        .select("id, is_active")
        .in("id", [a, b]);
      expect(data?.length).toBe(2);
      expect(data?.every((r) => r.is_active === false)).toBe(true);
    });

    it("should allow one is_active=true row", async () => {
      const id = await addPlaythrough(sb, { suffix: "active-one" });
      const { error } = await sb
        .from("playthroughs")
        .update({ is_active: true })
        .eq("id", id);
      expect(error).toBeNull();
    });

    it("should reject a second concurrent is_active=true row", async () => {
      // First wipe any leftover active rows from earlier tests (the unique
      // index would refuse our setup insert otherwise).
      await sb.from("playthroughs").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");

      const { data: a, error: aErr } = await sb
        .from("playthroughs")
        .insert({ name: testName("active-1"), is_active: true })
        .select("id")
        .single();
      expect(aErr).toBeNull();
      expect(a).not.toBeNull();

      const { data: b, error: bErr } = await sb
        .from("playthroughs")
        .insert({ name: testName("active-2"), is_active: true })
        .select("id")
        .single();
      expect(b).toBeNull();
      expect(bErr).not.toBeNull();
      expect(bErr?.message).toMatch(/unique|duplicate/i);
    });

    it("should allow flipping the active row by toggling the prior one off first", async () => {
      await sb.from("playthroughs").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");
      const a = await addPlaythrough(sb, { suffix: "swap-a" });
      const b = await addPlaythrough(sb, { suffix: "swap-b" });
      const { error: e1 } = await sb
        .from("playthroughs")
        .update({ is_active: true })
        .eq("id", a);
      expect(e1).toBeNull();
      // Toggle a off, then b on — should succeed.
      const { error: e2 } = await sb
        .from("playthroughs")
        .update({ is_active: false })
        .eq("id", a);
      expect(e2).toBeNull();
      const { error: e3 } = await sb
        .from("playthroughs")
        .update({ is_active: true })
        .eq("id", b);
      expect(e3).toBeNull();
    });
  });
});
