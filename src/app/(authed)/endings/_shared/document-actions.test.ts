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
  addBlock,
  addBlockVariable,
  addChip,
  addRow,
  createFrameworkDocument,
  createValueInline,
  createVariableInline,
  deleteBlock,
  deleteChip,
  deleteFrameworkDocument,
  deleteRow,
  removeBlockVariable,
  renameDocument,
  saveDocument,
} from "./document-actions";

const TEST_PREFIX = "__INT_TEST_DOC__";

describe("shared document actions", () => {
  const sb = makeTestClient();

  async function cleanup() {
    // Cascades take care of blocks/rows/chips/header-vars when the
    // framework document goes. Logic-kind doc seed rows are immortal —
    // we only nuke the test-prefixed framework rows + variables.
    await sb
      .from("ending_documents")
      .delete()
      .eq("kind", "framework")
      .like("name", `${TEST_PREFIX}%`);
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
  }

  async function seedFrameworkDoc(): Promise<string> {
    const { data, error } = await sb
      .from("ending_documents")
      .insert({
        kind: "framework",
        name: `${TEST_PREFIX}fw-${Math.random()}`,
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed framework: ${error?.message}`);
    return data.id as string;
  }

  async function logicDocId(
    kind:
      | "framework_selection"
      | "class_affinity_top"
      | "class_affinity_bottom"
      | "nation_affinity_top"
      | "nation_affinity_bottom"
  ): Promise<string> {
    const { data, error } = await sb
      .from("ending_documents")
      .select("id")
      .eq("kind", kind)
      .single();
    if (error || !data) throw new Error(`logic doc ${kind}: ${error?.message}`);
    return data.id as string;
  }

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanup();
  });

  // -------------------------------------------------------------------
  // createFrameworkDocument
  // -------------------------------------------------------------------

  describe("createFrameworkDocument", () => {
    it("inserts a kind='framework' row with the supplied (or generated) name", async () => {
      const { id } = await createFrameworkDocument({
        name: `${TEST_PREFIX}created`,
      });
      const { data } = await sb
        .from("ending_documents")
        .select("kind, name")
        .eq("id", id)
        .single();
      expect(data?.kind).toBe("framework");
      expect(data?.name).toBe(`${TEST_PREFIX}created`);
      expect(revalidatePath).toHaveBeenCalledWith("/endings/frameworks");
      expect(revalidatePath).toHaveBeenCalledWith("/endings/logic");
      expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
      expect(revalidatePath).toHaveBeenCalledWith("/endings/variables");
    });

    it("appends a numeric suffix when the name collides", async () => {
      const base = `${TEST_PREFIX}dup`;
      await createFrameworkDocument({ name: base });
      const { id } = await createFrameworkDocument({ name: base });
      const { data } = await sb
        .from("ending_documents")
        .select("name")
        .eq("id", id)
        .single();
      expect(data?.name).toBe(`${base} 2`);
    });
  });

  // -------------------------------------------------------------------
  // renameDocument / deleteFrameworkDocument
  // -------------------------------------------------------------------

  describe("renameDocument", () => {
    it("renames a framework doc", async () => {
      const fwId = await seedFrameworkDoc();
      const fd = new FormData();
      fd.set("id", fwId);
      fd.set("name", `${TEST_PREFIX}renamed`);
      await renameDocument(fd);
      const { data } = await sb
        .from("ending_documents")
        .select("name")
        .eq("id", fwId)
        .single();
      expect(data?.name).toBe(`${TEST_PREFIX}renamed`);
    });

    it("rejects renaming a logic-kind doc", async () => {
      const docId = await logicDocId("framework_selection");
      const fd = new FormData();
      fd.set("id", docId);
      fd.set("name", "should not stick");
      await expect(renameDocument(fd)).rejects.toThrow(
        /only framework documents/i
      );
    });

    it("rejects an empty name", async () => {
      const fwId = await seedFrameworkDoc();
      const fd = new FormData();
      fd.set("id", fwId);
      fd.set("name", "  ");
      await expect(renameDocument(fd)).rejects.toThrow(/cannot be empty/i);
    });
  });

  describe("deleteFrameworkDocument", () => {
    it("deletes a framework doc", async () => {
      const fwId = await seedFrameworkDoc();
      const fd = new FormData();
      fd.set("id", fwId);
      await deleteFrameworkDocument(fd);
      const { data } = await sb
        .from("ending_documents")
        .select("id")
        .eq("id", fwId)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("refuses to delete a logic-kind doc (seed-immortal)", async () => {
      const docId = await logicDocId("class_affinity_top");
      const fd = new FormData();
      fd.set("id", docId);
      await expect(deleteFrameworkDocument(fd)).rejects.toThrow(
        /seed-immortal/i
      );
      // And the row's still there.
      const { data } = await sb
        .from("ending_documents")
        .select("id")
        .eq("id", docId)
        .single();
      expect(data?.id).toBe(docId);
    });
  });

  // -------------------------------------------------------------------
  // addBlock — kind-aware leaf validation
  // -------------------------------------------------------------------

  describe("addBlock", () => {
    it("inserts a text block at the next sort slot on a framework doc", async () => {
      const fwId = await seedFrameworkDoc();
      const { id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
      });
      const { data } = await sb
        .from("ending_blocks")
        .select("*")
        .eq("id", id)
        .single();
      expect(data).toMatchObject({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
        text: "",
        result_value: null,
        sort_order: 1,
      });
      expect(revalidatePath).toHaveBeenCalledWith("/endings/frameworks");
      expect(revalidatePath).toHaveBeenCalledWith("/endings/logic");
      expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    });

    it("creates a condition block AND seeds one empty row at sort 0", async () => {
      const fwId = await seedFrameworkDoc();
      const { id, row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { data: block } = await sb
        .from("ending_blocks")
        .select("block_type")
        .eq("id", id)
        .single();
      expect(block?.block_type).toBe("condition");
      const { data: rows } = await sb
        .from("ending_condition_rows")
        .select("id, sort_order")
        .eq("condition_block_id", id);
      expect(rows).toHaveLength(1);
      expect(rows?.[0].id).toBe(row_id);
      expect(rows?.[0].sort_order).toBe(0);
    });

    it("rejects a result block on a framework doc", async () => {
      const fwId = await seedFrameworkDoc();
      await expect(
        addBlock({
          document_id: fwId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: "proletariat",
        })
      ).rejects.toThrow(/Framework documents cannot contain result blocks/i);
    });

    it("rejects a text block on a logic doc", async () => {
      const docId = await logicDocId("class_affinity_top");
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "text",
          text: "nope",
        })
      ).rejects.toThrow(/Logic documents cannot contain text blocks/i);
    });

    it("rejects a result block on class_affinity_top with an invalid result_value", async () => {
      const docId = await logicDocId("class_affinity_top");
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: "not_a_class",
        })
      ).rejects.toThrow(/Invalid result_value/i);
    });

    it("accepts a valid result_value on class_affinity_top", async () => {
      const docId = await logicDocId("class_affinity_top");
      const { id } = await addBlock({
        document_id: docId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "result",
        result_value: "proletariat",
      });
      const { data } = await sb
        .from("ending_blocks")
        .select("block_type, result_value")
        .eq("id", id)
        .single();
      expect(data?.block_type).toBe("result");
      expect(data?.result_value).toBe("proletariat");
      // Cleanup the result block — its parent doc is seed-immortal.
      const fd = new FormData();
      fd.set("id", id);
      await deleteBlock(fd);
    });

    it("accepts a framework UUID as result_value on framework_selection", async () => {
      const fwId = await seedFrameworkDoc();
      const docId = await logicDocId("framework_selection");
      const { id } = await addBlock({
        document_id: docId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "result",
        result_value: fwId,
      });
      const { data } = await sb
        .from("ending_blocks")
        .select("result_value")
        .eq("id", id)
        .single();
      expect(data?.result_value).toBe(fwId);
      // Cleanup the result block — its parent doc is seed-immortal.
      const fd = new FormData();
      fd.set("id", id);
      await deleteBlock(fd);
    });

    it("rejects a non-framework UUID on framework_selection", async () => {
      const docId = await logicDocId("framework_selection");
      const otherLogicId = await logicDocId("class_affinity_top");
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: otherLogicId,
        })
      ).rejects.toThrow(/framework_selection result_value/i);
    });

    it("accepts a custom-subset payload of valid framework UUIDs on framework_selection", async () => {
      const fwA = await seedFrameworkDoc();
      const fwB = await seedFrameworkDoc();
      const docId = await logicDocId("framework_selection");
      const subsetValue = `__random_subset__:${JSON.stringify([fwA, fwB])}`;
      const { id } = await addBlock({
        document_id: docId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "result",
        result_value: subsetValue,
      });
      const { data } = await sb
        .from("ending_blocks")
        .select("result_value")
        .eq("id", id)
        .single();
      expect(data?.result_value).toBe(subsetValue);
      const fd = new FormData();
      fd.set("id", id);
      await deleteBlock(fd);
    });

    it("rejects a custom-subset payload that references a non-framework id", async () => {
      const fwA = await seedFrameworkDoc();
      const otherLogicId = await logicDocId("class_affinity_top");
      const docId = await logicDocId("framework_selection");
      const subsetValue = `__random_subset__:${JSON.stringify([
        fwA,
        otherLogicId,
      ])}`;
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: subsetValue,
        })
      ).rejects.toThrow(/subset entry/i);
    });

    it("rejects a custom-subset payload with a malformed JSON body", async () => {
      const docId = await logicDocId("framework_selection");
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: "__random_subset__:not-json",
        })
      ).rejects.toThrow(/Malformed random-subset/i);
    });

    it("rejects custom-subset on a non-framework_selection logic doc", async () => {
      const fwA = await seedFrameworkDoc();
      const docId = await logicDocId("class_affinity_top");
      const subsetValue = `__random_subset__:${JSON.stringify([fwA])}`;
      await expect(
        addBlock({
          document_id: docId,
          parent_block_id: null,
          parent_row_id: null,
          block_type: "result",
          result_value: subsetValue,
        })
      ).rejects.toThrow(/Custom-subset random is only valid/i);
    });
  });

  // -------------------------------------------------------------------
  // addRow / addChip / addBlockVariable
  // -------------------------------------------------------------------

  describe("rows + chips + headers", () => {
    it("addRow appends rows in sort_order", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: condId, row_id: firstRow } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: secondRow } = await addRow({ block_id: condId });
      const { data: rows } = await sb
        .from("ending_condition_rows")
        .select("id, sort_order")
        .eq("condition_block_id", condId)
        .order("sort_order");
      expect(rows?.map((r) => r.id)).toEqual([firstRow, secondRow]);
      expect(rows?.[1].sort_order).toBe(1);
    });

    it("addChip ties the chip to the row + auto-declares its variable on the parent block", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: condId, row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}performer`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "WINTER",
      });
      const { id: chipId } = await addChip({
        row_id: row_id!,
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
      // Auto-declare on header.
      const { data: header } = await sb
        .from("ending_condition_block_variables")
        .select("variable_id")
        .eq("condition_block_id", condId)
        .eq("variable_id", variableId)
        .single();
      expect(header?.variable_id).toBe(variableId);
    });

    it("addChip rejects when neither value field is set", async () => {
      const fwId = await seedFrameworkDoc();
      const { row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}vinvalid`,
      });
      await expect(
        addChip({ row_id: row_id!, variable_id: variableId, operator: "=" })
      ).rejects.toThrow(/exactly one/i);
    });

    it("addBlockVariable upserts (idempotent on re-add)", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: condId } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}twice`,
      });
      const { id: first } = await addBlockVariable({
        block_id: condId,
        variable_id: variableId,
      });
      const { id: second } = await addBlockVariable({
        block_id: condId,
        variable_id: variableId,
      });
      expect(second).toBe(first);
    });

    it("removeBlockVariable purges chips on that variable + deletes the header row", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: condId, row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}purge`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "X",
      });
      const { id: chipId } = await addChip({
        row_id: row_id!,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
      });
      const { data: header } = await sb
        .from("ending_condition_block_variables")
        .select("id")
        .eq("condition_block_id", condId)
        .eq("variable_id", variableId)
        .single();
      const fd = new FormData();
      fd.set("id", header!.id as string);
      await removeBlockVariable(fd);
      const { data: chip } = await sb
        .from("ending_condition_row_chips")
        .select("id")
        .eq("id", chipId)
        .maybeSingle();
      expect(chip).toBeNull();
      const { data: headerAfter } = await sb
        .from("ending_condition_block_variables")
        .select("id")
        .eq("condition_block_id", condId)
        .eq("variable_id", variableId)
        .maybeSingle();
      expect(headerAfter).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // delete*
  // -------------------------------------------------------------------

  describe("deletes", () => {
    it("deleteBlock removes the block", async () => {
      const fwId = await seedFrameworkDoc();
      const { id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
      });
      const fd = new FormData();
      fd.set("id", id);
      await deleteBlock(fd);
      const { data } = await sb
        .from("ending_blocks")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("deleteRow removes the row", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: condId } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: rowId } = await addRow({ block_id: condId });
      const fd = new FormData();
      fd.set("id", rowId);
      await deleteRow(fd);
      const { data } = await sb
        .from("ending_condition_rows")
        .select("id")
        .eq("id", rowId)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("deleteChip removes the chip", async () => {
      const fwId = await seedFrameworkDoc();
      const { row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}delchip`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "Y",
      });
      const { id: chipId } = await addChip({
        row_id: row_id!,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
      });
      const fd = new FormData();
      fd.set("id", chipId);
      await deleteChip(fd);
      const { data } = await sb
        .from("ending_condition_row_chips")
        .select("id")
        .eq("id", chipId)
        .maybeSingle();
      expect(data).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // saveDocument — UPDATE-only across blocks/rows/chips
  // -------------------------------------------------------------------

  describe("saveDocument", () => {
    it("issues UPDATE-only — total row counts for blocks/rows/chips don't change", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: blockId } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
      });
      const { id: condId, row_id } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "condition",
      });
      const { id: variableId } = await createVariableInline({
        name: `${TEST_PREFIX}saveVar`,
      });
      const { id: valueId } = await createValueInline({
        variable_id: variableId,
        value: "X",
      });
      const { id: chipId } = await addChip({
        row_id: row_id!,
        variable_id: variableId,
        operator: "=",
        text_value_id: valueId,
      });

      const { count: blocksBefore } = await sb
        .from("ending_blocks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", fwId);
      const { count: rowsBefore } = await sb
        .from("ending_condition_rows")
        .select("id", { count: "exact", head: true })
        .eq("condition_block_id", condId);
      const { count: chipsBefore } = await sb
        .from("ending_condition_row_chips")
        .select("id", { count: "exact", head: true })
        .eq("row_id", row_id!);

      await saveDocument({
        document_id: fwId,
        name: `${TEST_PREFIX}renamed`,
        blocks: [
          {
            id: blockId,
            parent_block_id: null,
            parent_row_id: null,
            block_type: "text",
            text: "updated",
            result_value: null,
            sort_order: 0,
          },
          {
            id: condId,
            parent_block_id: null,
            parent_row_id: null,
            block_type: "condition",
            text: "",
            result_value: null,
            sort_order: 1,
          },
        ],
        rows: [{ id: row_id!, condition_block_id: condId, sort_order: 0 }],
        chips: [
          {
            id: chipId,
            row_id: row_id!,
            variable_id: variableId,
            operator: "=",
            text_value_id: valueId,
            number_value: null,
            aggregate_value: null,
            sort_order: 0,
          },
        ],
      });

      const { count: blocksAfter } = await sb
        .from("ending_blocks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", fwId);
      const { count: rowsAfter } = await sb
        .from("ending_condition_rows")
        .select("id", { count: "exact", head: true })
        .eq("condition_block_id", condId);
      const { count: chipsAfter } = await sb
        .from("ending_condition_row_chips")
        .select("id", { count: "exact", head: true })
        .eq("row_id", row_id!);

      expect(blocksAfter).toBe(blocksBefore);
      expect(rowsAfter).toBe(rowsBefore);
      expect(chipsAfter).toBe(chipsBefore);

      // And the framework name was actually updated.
      const { data: fw } = await sb
        .from("ending_documents")
        .select("name")
        .eq("id", fwId)
        .single();
      expect(fw?.name).toBe(`${TEST_PREFIX}renamed`);

      // And the text block's text was actually updated.
      const { data: blk } = await sb
        .from("ending_blocks")
        .select("text")
        .eq("id", blockId)
        .single();
      expect(blk?.text).toBe("updated");
    });

    it("rejects an empty framework name", async () => {
      const fwId = await seedFrameworkDoc();
      await expect(
        saveDocument({
          document_id: fwId,
          name: "  ",
          blocks: [],
          rows: [],
          chips: [],
        })
      ).rejects.toThrow(/cannot be empty/i);
    });

    it("rejects a result block payload on a framework doc", async () => {
      const fwId = await seedFrameworkDoc();
      const { id: blockId } = await addBlock({
        document_id: fwId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "text",
      });
      await expect(
        saveDocument({
          document_id: fwId,
          name: `${TEST_PREFIX}save_with_result`,
          blocks: [
            {
              id: blockId,
              parent_block_id: null,
              parent_row_id: null,
              block_type: "result",
              text: "",
              result_value: "proletariat",
              sort_order: 0,
            },
          ],
          rows: [],
          chips: [],
        })
      ).rejects.toThrow(/cannot contain result blocks/i);
    });

    it("rejects a text block payload on a logic doc", async () => {
      const docId = await logicDocId("framework_selection");
      // Manually seed a result block as the placeholder so saveDocument
      // sees a non-empty doc.
      const fwId = await seedFrameworkDoc();
      const { id } = await addBlock({
        document_id: docId,
        parent_block_id: null,
        parent_row_id: null,
        block_type: "result",
        result_value: fwId,
      });
      await expect(
        saveDocument({
          document_id: docId,
          blocks: [
            {
              id,
              parent_block_id: null,
              parent_row_id: null,
              block_type: "text",
              text: "should not stick",
              result_value: null,
              sort_order: 0,
            },
          ],
          rows: [],
          chips: [],
        })
      ).rejects.toThrow(/cannot contain text blocks/i);
      // Cleanup the seeded block — its parent doc is seed-immortal.
      const fd = new FormData();
      fd.set("id", id);
      await deleteBlock(fd);
    });
  });
});
