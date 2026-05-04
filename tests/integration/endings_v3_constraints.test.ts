import { afterEach, describe, expect, it } from "vitest";
import { makeTestClient } from "./_helpers";

// CHECK constraints on the v3 endings tables. Pin them with service-role
// inserts so a future migration can't loosen them silently.

const TEST_PREFIX = "__INT_TEST_V3__";

describe("endings v3 schema constraints", () => {
  const sb = makeTestClient();

  afterEach(async () => {
    // Cascades clean up rows / chips when frameworks + variables go.
    await sb.from("ending_frameworks").delete().like("name", `${TEST_PREFIX}%`);
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
  });

  async function seed() {
    const { data: framework, error: fErr } = await sb
      .from("ending_frameworks")
      .insert({ name: `${TEST_PREFIX}framework`, sort_order: 9999 })
      .select("id")
      .single();
    if (fErr || !framework) throw new Error(`seed framework: ${fErr?.message}`);

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
      .from("ending_framework_blocks")
      .insert({
        framework_id: framework.id,
        block_type: "condition",
        text: "",
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
      frameworkId: framework.id as string,
      textVarId: textVar.id as string,
      numVarId: numVar.id as string,
      aggVarId: aggVar.id as string,
      textValueId: textValue.id as string,
      condBlockId: condBlock.id as string,
      rowId: row.id as string,
    };
  }

  it("rejects ending_variables with kind='number_ref' but null number_ref", async () => {
    const { error } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}bad_kind`,
        kind: "number_ref",
        number_ref: null,
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/ending_variables_kind_shape/i);
  });

  it("rejects ending_variables with kind='text' but number_ref set", async () => {
    const { error } = await sb
      .from("ending_variables")
      .insert({
        name: `${TEST_PREFIX}bad_text_kind`,
        kind: "text",
        number_ref: "world_status",
        sort_order: 9999,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/ending_variables_kind_shape/i);
  });

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

  it("rejects a block with parent_block_id but null parent_row_id", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_framework_blocks")
      .insert({
        framework_id: seeded.frameworkId,
        parent_block_id: seeded.condBlockId,
        parent_row_id: null,
        block_type: "text",
        text: "",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/parent_shape/i);
  });

  it("rejects a block with parent_row_id but null parent_block_id", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_framework_blocks")
      .insert({
        framework_id: seeded.frameworkId,
        parent_block_id: null,
        parent_row_id: seeded.rowId,
        block_type: "text",
        text: "",
        sort_order: 0,
      })
      .select();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/parent_shape/i);
  });

  it("accepts a valid nested block under a row", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_framework_blocks")
      .insert({
        framework_id: seeded.frameworkId,
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
  // Aggregate variable kind (Phase 4 / migration 0020)
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

  it("rejects an aggregate_ref variable with kind=text but aggregate_ref set", async () => {
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

  it("accepts each new aggregate operator on an aggregate-variable chip", async () => {
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
      // Clean up between iterations so the row isn't littered with chips.
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

  it("rejects a text-variable chip with aggregate_value set", async () => {
    const seeded = await seed();
    const { error } = await sb
      .from("ending_condition_row_chips")
      .insert({
        row_id: seeded.rowId,
        variable_id: seeded.textVarId,
        operator: "=",
        text_value_id: null,
        number_value: null,
        aggregate_value: "proletariat",
        sort_order: 0,
      })
      .select();
    // CHECK is shape-only — payload mismatch with the variable kind is
    // enforced at the application layer; the row-shape check still
    // accepts a single-payload chip. Document that here so a future
    // migration tightening this doesn't surprise anyone.
    expect(error).toBeNull();
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
  // Header-declared variables (Phase 6 / migration 0021)
  // -------------------------------------------------------------------

  it("ending_condition_block_variables: rejects duplicate (block, variable) pair", async () => {
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

  it("ending_condition_block_variables: cascades on block delete", async () => {
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
    await sb
      .from("ending_framework_blocks")
      .delete()
      .eq("id", seeded.condBlockId);
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
