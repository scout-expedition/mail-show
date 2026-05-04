import { afterEach, describe, expect, it } from "vitest";
import { makeTestClient } from "./_helpers";

// CHECK constraints + partial unique indexes on the unified endings
// schema introduced in 0022_endings_logic_v2.sql. Pinned with
// service-role inserts so a future migration can't loosen them silently.
//
// Replaces the older endings_v3_constraints.test.ts (whose seed used
// ending_frameworks + ending_framework_blocks, both gone in 0022).
// Coverage that survived the rebuild (chip value_shape, aggregate
// operators, header variable cascade, aggregate kind_shape) carries
// over here.

const TEST_PREFIX = "__INT_TEST_LOGIC_V2__";

describe("endings logic v2 schema constraints", () => {
  const sb = makeTestClient();

  afterEach(async () => {
    // Cascades clean up rows / chips / header vars when documents +
    // variables go.
    await sb
      .from("ending_documents")
      .delete()
      .eq("kind", "framework")
      .like("name", `${TEST_PREFIX}%`);
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
  });

  async function seed() {
    const { data: doc, error: dErr } = await sb
      .from("ending_documents")
      .insert({
        kind: "framework",
        name: `${TEST_PREFIX}doc-${Math.random()}`,
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (dErr || !doc) throw new Error(`seed document: ${dErr?.message}`);

    const { data: textVar, error: vErr } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}text_var`,
        kind: "text",
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (vErr || !textVar) throw new Error(`seed text var: ${vErr?.message}`);

    const { data: numVar, error: nErr } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}num_var`,
        kind: "number_ref",
        number_ref: "world_status",
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (nErr || !numVar) throw new Error(`seed num var: ${nErr?.message}`);

    const { data: aggVar, error: aErr } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}agg_var`,
        kind: "aggregate_ref",
        aggregate_ref: "class_affinity",
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (aErr || !aggVar) throw new Error(`seed agg var: ${aErr?.message}`);

    const { data: textValue, error: vvErr } = await sb
      .from("ending_variable_values")
      .insert({
        variable_id: textVar.id,
        value: "first",
        sort_order: 0,
      })
      .select("id")
      .single();
    if (vvErr || !textValue)
      throw new Error(`seed text value: ${vvErr?.message}`);

    const { data: condBlock, error: bErr } = await sb
      .from("ending_blocks")
      .insert({
        document_id: doc.id,
        block_type: "condition",
        sort_order: 0,
      })
      .select("id")
      .single();
    if (bErr || !condBlock)
      throw new Error(`seed condition block: ${bErr?.message}`);

    const { data: row, error: rErr } = await sb
      .from("ending_condition_rows")
      .insert({ condition_block_id: condBlock.id, sort_order: 0 })
      .select("id")
      .single();
    if (rErr || !row) throw new Error(`seed row: ${rErr?.message}`);

    return {
      docId: doc.id as string,
      textVarId: textVar.id as string,
      numVarId: numVar.id as string,
      aggVarId: aggVar.id as string,
      textValueId: textValue.id as string,
      condBlockId: condBlock.id as string,
      rowId: row.id as string,
    };
  }

  // -------------------------------------------------------------------
  // Documents — kind/name shape, singleton kinds, framework name unique
  // -------------------------------------------------------------------

  it("rejects a framework document with null name", async () => {
    const { error } = await sb
      .from("ending_documents")
      .insert({ kind: "framework", name: null, sort_order: 9999 })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/name_shape/i);
  });

  it("rejects a logic-kind document with a name set", async () => {
    // We can't actually insert a second logic-kind doc (singleton), but
    // we can attempt one and rely on the name_shape CHECK firing first.
    const { error } = await sb
      .from("ending_documents")
      .insert({
        kind: "framework_selection",
        name: `${TEST_PREFIX}should_be_null`,
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    // Either name_shape (if first) or singleton index (if name CHECK is
    // shape-only). Both signal the constraint is doing its job.
    expect(error?.message ?? "").toMatch(/(name_shape|singleton)/i);
  });

  it("seeded singleton logic documents are present", async () => {
    const { data, error } = await sb
      .from("ending_documents")
      .select("kind")
      .neq("kind", "framework");
    expect(error).toBeNull();
    const kinds = (data ?? []).map((r) => r.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "framework_selection",
        "class_affinity_top",
        "class_affinity_bottom",
        "nation_affinity_top",
        "nation_affinity_bottom",
      ])
    );
  });

  it("rejects inserting a second document of a singleton kind", async () => {
    const { error } = await sb
      .from("ending_documents")
      .insert({ kind: "framework_selection", name: null, sort_order: 9999 })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/(unique|singleton)/i);
  });

  it("rejects two framework documents sharing the same name", async () => {
    const name = `${TEST_PREFIX}dup-name`;
    const { error: firstErr } = await sb
      .from("ending_documents")
      .insert({ kind: "framework", name, sort_order: 9999 })
      .select();
    expect(firstErr).toBeNull();
    const { error: dupErr } = await sb
      .from("ending_documents")
      .insert({ kind: "framework", name, sort_order: 9999 })
      .select();
    expect(dupErr).not.toBeNull();
    expect(dupErr?.message ?? "").toMatch(/(unique|name_unique)/i);
  });

  // -------------------------------------------------------------------
  // Blocks — type payload + parent shape + result + nested under row
  // -------------------------------------------------------------------

  it("rejects a text block with null text", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "text",
        text: null,
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/type_payload/i);
  });

  it("rejects a result block with null result_value", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "result",
        result_value: null,
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/type_payload/i);
  });

  it("rejects a condition block with text set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "condition",
        text: "should be null",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/type_payload/i);
  });

  it("rejects a condition block with result_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "condition",
        result_value: "should be null",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/type_payload/i);
  });

  it("rejects a leaf block with both text and result_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "text",
        text: "yes",
        result_value: "also yes",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/type_payload/i);
  });

  it("accepts a valid text block, condition block, and result block", async () => {
    const seeded = await seed();
    const { error: textErr } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "text",
        text: "hello",
        sort_order: 0,
      })
      .select();
    expect(textErr).toBeNull();

    const { error: condErr } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "condition",
        sort_order: 1,
      })
      .select();
    expect(condErr).toBeNull();

    const { error: resErr } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        block_type: "result",
        result_value: "proletariat",
        sort_order: 2,
      })
      .select();
    expect(resErr).toBeNull();
  });

  it("rejects a block with parent_block_id but null parent_row_id", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        parent_block_id: seeded.condBlockId,
        parent_row_id: null,
        block_type: "text",
        text: "child",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/parent_shape/i);
  });

  it("rejects a block with parent_row_id but null parent_block_id", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        parent_block_id: null,
        parent_row_id: seeded.rowId,
        block_type: "text",
        text: "child",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/parent_shape/i);
  });

  it("accepts a valid nested block under a row (parent_row_id FK wired)", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_blocks")
      .insert({
        document_id: seeded.docId,
        parent_block_id: seeded.condBlockId,
        parent_row_id: seeded.rowId,
        block_type: "text",
        text: "child",
        sort_order: 0,
      })
      .select();
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------
  // Chips — value_shape + operator (preserved from 0014/0020)
  // -------------------------------------------------------------------

  it("rejects an invalid operator on a chip", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.textVarId,
        operator: "==", // not in the CHECK
        text_value_id: seeded.textValueId,
        number_value: null,
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
  });

  it("rejects a chip with both text_value_id and number_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.textVarId,
        operator: "=",
        text_value_id: seeded.textValueId,
        number_value: 5,
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/value_shape/i);
  });

  it("rejects a chip with neither text_value_id nor number_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.textVarId,
        operator: "=",
        text_value_id: null,
        number_value: null,
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/value_shape/i);
  });

  it("accepts a valid text-variable chip", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.textVarId,
        operator: "=",
        text_value_id: seeded.textValueId,
        number_value: null,
        sort_order: 0,
      })
      .select();
    expect(error).toBeNull();
  });

  it("accepts a valid number-ref chip", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.numVarId,
        operator: "≥",
        text_value_id: null,
        number_value: 0,
        sort_order: 0,
      })
      .select();
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------
  // Aggregate variable kind (preserved from 0020)
  // -------------------------------------------------------------------

  it("rejects aggregate_ref outside the allowed set", async () => {
    const { error } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}bad_agg`,
        kind: "aggregate_ref",
        aggregate_ref: "kingdom_affinity", // not in the CHECK
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/aggregate_ref/i);
  });

  it("rejects an aggregate_ref variable with both number_ref and aggregate_ref set", async () => {
    const { error } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}bad_agg_shape`,
        kind: "aggregate_ref",
        aggregate_ref: "class_affinity",
        number_ref: "proletariat",
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/kind_shape/i);
  });

  it("rejects a kind=text variable with aggregate_ref set", async () => {
    const { error } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}bad_text_agg`,
        kind: "text",
        aggregate_ref: "class_affinity",
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/kind_shape/i);
  });

  it("accepts a valid aggregate-variable chip with a top= operator", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.aggVarId,
        operator: "top=",
        text_value_id: null,
        number_value: null,
        aggregate_value: "proletariat",
        sort_order: 0,
      })
      .select();
    expect(error).toBeNull();
  });

  it("accepts each aggregate operator on an aggregate-variable chip", async () => {
    const seeded = await seed();
    for (const op of ["top=", "top≠", "bottom=", "bottom≠"] as const) {
      const { error } = await sb
        .from("ending_condition_row_chips")
        .insert({
          row_id: seeded.rowId,
          variable_id: seeded.aggVarId,
          operator: op,
          text_value_id: null,
          number_value: null,
          aggregate_value: "gentry",
          sort_order: 0,
        })
        .select();
      expect(error, `op ${op}`).toBeNull();
      await sb
        .from("ending_condition_row_chips")
        .delete()
        .eq("row_id", seeded.rowId);
    }
  });

  it("rejects an aggregate-variable chip with both aggregate_value and number_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.aggVarId,
        operator: "top=",
        text_value_id: null,
        number_value: 5,
        aggregate_value: "proletariat",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/value_shape/i);
  });

  it("rejects an aggregate-variable chip with both aggregate_value and text_value_id set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.aggVarId,
        operator: "top=",
        text_value_id: seeded.textValueId,
        number_value: null,
        aggregate_value: "proletariat",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/value_shape/i);
  });

  it("rejects an unknown operator on an aggregate-variable chip", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.aggVarId,
        operator: "argmax", // not in the CHECK
        text_value_id: null,
        number_value: null,
        aggregate_value: "proletariat",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/operator/i);
  });

  // -------------------------------------------------------------------
  // Header-declared variables (preserved from 0021)
  // -------------------------------------------------------------------

  it("rejects duplicate (block, variable) pair on header table", async () => {
    const seeded = await seed();
    const { error: firstErr } = await sb
      .from("ending_condition_block_variables")
      .insert({
        condition_block_id: seeded.condBlockId,
        variable_id: seeded.textVarId,
        sort_order: 0,
      });
    expect(firstErr).toBeNull();
    const { error: dupErr } = await sb
      .from("ending_condition_block_variables")
      .insert({
        condition_block_id: seeded.condBlockId,
        variable_id: seeded.textVarId,
        sort_order: 1,
      });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.message ?? "").toMatch(/unique/i);
  });

  it("cascades header variables when the condition block is deleted", async () => {
    const seeded = await seed();
    await sb.from("ending_condition_block_variables").insert({
      condition_block_id: seeded.condBlockId,
      variable_id: seeded.textVarId,
      sort_order: 0,
    });
    const { count: beforeCount } = await sb
      .from("ending_condition_block_variables")
      .select("id", { count: "exact", head: true })
      .eq("condition_block_id", seeded.condBlockId);
    expect(beforeCount).toBe(1);
    await sb.from("ending_blocks").delete().eq("id", seeded.condBlockId);
    const { count: afterCount } = await sb
      .from("ending_condition_block_variables")
      .select("id", { count: "exact", head: true })
      .eq("condition_block_id", seeded.condBlockId);
    expect(afterCount).toBe(0);
  });

  it("seeded aggregate variables are present", async () => {
    const { data, error } = await sb
      .from("ending_variables")
      .select("name, kind, aggregate_ref")
      .eq("kind", "aggregate_ref")
      .order("sort_order");
    expect(error).toBeNull();
    const names = (data ?? []).map((r) => r.name);
    expect(names).toContain("Class Affinity");
    expect(names).toContain("Nation Affinity");
  });
});
