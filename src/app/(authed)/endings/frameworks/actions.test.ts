import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { makeTestClient } from "../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Imports of the actions MUST come after the mocks above.
import {
  addChip,
  addRow,
  createConditionBlock,
  createTextBlock,
  createValueInline,
  createVariableInline,
  saveFramework,
} from "./actions";

const TEST_PREFIX = "__INT_TEST_FW__";

describe("frameworks actions / v3", () => {
  const sb = makeTestClient();

  async function cleanup() {
    await sb.from("ending_frameworks").delete().like("name", `${TEST_PREFIX}%`);
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
  }

  async function seedFramework() {
    const { data, error } = await sb
      .from("ending_frameworks")
      .insert({ name: `${TEST_PREFIX}fw-${Math.random()}`, sort_order: 9999 })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed framework: ${error?.message}`);
    return data.id as string;
  }

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("createTextBlock", () => {
    it("inserts a text block at the next sort slot and revalidates endings paths", async () => {
      const fwId = await seedFramework();

      const { id } = await createTextBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });

      const { data } = await sb
        .from("ending_framework_blocks")
        .select("*")
        .eq("id", id)
        .single();
      expect(data).toMatchObject({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
        text: "",
        sort_order: 1,
      });

      expect(revalidatePath).toHaveBeenCalledWith("/endings/frameworks");
      expect(revalidatePath).toHaveBeenCalledWith("/endings/variables");
      expect(revalidatePath).toHaveBeenCalledWith("/endings/logic");
      expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    });

    it("appends after existing siblings", async () => {
      const fwId = await seedFramework();
      await createTextBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: secondId } = await createTextBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { data } = await sb
        .from("ending_framework_blocks")
        .select("sort_order")
        .eq("id", secondId)
        .single();
      expect(data?.sort_order).toBe(2);
    });
  });

  describe("createConditionBlock", () => {
    it("creates a condition block AND seeds one empty row at sort 0", async () => {
      const fwId = await seedFramework();

      const { id, row_id } = await createConditionBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });

      const { data: block } = await sb
        .from("ending_framework_blocks")
        .select("*")
        .eq("id", id)
        .single();
      expect(block).toMatchObject({
        framework_id: fwId,
        block_type: "condition",
        parent_block_id: null,
        parent_row_id: null,
      });

      const { data: rows } = await sb
        .from("ending_condition_rows")
        .select("*")
        .eq("condition_block_id", id);
      expect(rows).toHaveLength(1);
      expect(rows?.[0].id).toBe(row_id);
      expect(rows?.[0].sort_order).toBe(0);
    });
  });

  describe("addRow / addChip", () => {
    it("adds a chip whose row_id ties back to the condition block", async () => {
      const fwId = await seedFramework();
      const { id: condId, row_id } = await createConditionBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}performer`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "WINTER",
      });
      const { id: chipId } = await addChip({
        row_id,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
      });
      const { data: chip } = await sb
        .from("ending_condition_row_chips")
        .select("*")
        .eq("id", chipId)
        .single();
      expect(chip).toMatchObject({
        row_id,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
        number_value: null,
      });
      // Sanity: chip's row belongs to the condition block we created.
      const { data: rowRow } = await sb
        .from("ending_condition_rows")
        .select("condition_block_id")
        .eq("id", row_id)
        .single();
      expect(rowRow?.condition_block_id).toBe(condId);
    });

    it("addChip rejects when neither value field is set", async () => {
      const fwId = await seedFramework();
      const { row_id } = await createConditionBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}vinvalid`,
      });
      await expect(
        addChip({ row_id, variable_id: variableId, operator: "=" })
      ).rejects.toThrow(/exactly one/i);
    });

    it("addRow appends to the next sort slot", async () => {
      const fwId = await seedFramework();
      const { id: condId, row_id: firstRow } = await createConditionBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: secondRow } = await addRow({ condition_block_id: condId });
      const { data: rows } = await sb
        .from("ending_condition_rows")
        .select("id, sort_order")
        .eq("condition_block_id", condId)
        .order("sort_order");
      expect(rows?.map((r) => r.id)).toEqual([firstRow, secondRow]);
      expect(rows?.[1].sort_order).toBe(1);
    });
  });

  describe("createVariableInline", () => {
    it("sets kind=text, color_index in [0,12), and clears number_ref", async () => {
      const { id } = await createVariableInline({
        name: `${TEST_PREFIX}colortest`,
      });
      const { data } = await sb
        .from("ending_variables")
        .select("kind, number_ref, color_index")
        .eq("id", id)
        .single();
      expect(data?.kind).toBe("text");
      expect(data?.number_ref).toBeNull();
      expect(data?.color_index).toBeGreaterThanOrEqual(0);
      expect(data?.color_index).toBeLessThan(12);
    });
  });

  describe("saveFramework", () => {
    it("issues UPDATE-only — total row counts for blocks/rows/chips don't change", async () => {
      const fwId = await seedFramework();
      const { id: blockId } = await createTextBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: condId, row_id } = await createConditionBlock({
        framework_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}saveVar`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "X",
      });
      const { id: chipId } = await addChip({
        row_id,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
      });

      const { count: blocksBefore } = await sb
        .from("ending_framework_blocks")
        .select("id", { count: "exact", head: true })
        .eq("framework_id", fwId);
      const { count: rowsBefore } = await sb
        .from("ending_condition_rows")
        .select("id", { count: "exact", head: true })
        .eq("condition_block_id", condId);
      const { count: chipsBefore } = await sb
        .from("ending_condition_row_chips")
        .select("id", { count: "exact", head: true })
        .eq("row_id", row_id);

      await saveFramework({
        id: fwId,
        name: `${TEST_PREFIX}renamed`,
        blocks: [
          {
            id: blockId,
            parent_block_id: null,
            parent_row_id: null,
            block_type: "text",
            text: "updated",
            sort_order: 0,
          },
          {
            id: condId,
            parent_block_id: null,
            parent_row_id: null,
            block_type: "condition",
            text: "",
            sort_order: 1,
          },
        ],
        rows: [{ id: row_id, condition_block_id: condId, sort_order: 0 }],
        chips: [
          {
            id: chipId,
            row_id,
            variable_id: variableId,
            operator: "=",
            text_value_id: valueId,
            number_value: null,
            sort_order: 0,
          },
        ],
      });

      const { count: blocksAfter } = await sb
        .from("ending_framework_blocks")
        .select("id", { count: "exact", head: true })
        .eq("framework_id", fwId);
      const { count: rowsAfter } = await sb
        .from("ending_condition_rows")
        .select("id", { count: "exact", head: true })
        .eq("condition_block_id", condId);
      const { count: chipsAfter } = await sb
        .from("ending_condition_row_chips")
        .select("id", { count: "exact", head: true })
        .eq("row_id", row_id);

      expect(blocksAfter).toBe(blocksBefore);
      expect(rowsAfter).toBe(rowsBefore);
      expect(chipsAfter).toBe(chipsBefore);

      // And the framework name was actually updated.
      const { data: fw } = await sb
        .from("ending_frameworks")
        .select("name")
        .eq("id", fwId)
        .single();
      expect(fw?.name).toBe(`${TEST_PREFIX}renamed`);

      // And the text block's text was actually updated.
      const { data: blk } = await sb
        .from("ending_framework_blocks")
        .select("text")
        .eq("id", blockId)
        .single();
      expect(blk?.text).toBe("updated");
    });

    it("rejects an empty framework name", async () => {
      const fwId = await seedFramework();
      await expect(
        saveFramework({ id: fwId, name: "  ", blocks: [], rows: [], chips: [] })
      ).rejects.toThrow(/cannot be empty/i);
    });
  });
});
