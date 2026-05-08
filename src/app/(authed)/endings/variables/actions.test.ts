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
  createEndingVariable,
  createEndingVariableInline,
  createEndingVariableValue,
  createEndingVariableValueInline,
} from "./actions";

const TEST_PREFIX = "__INT_TEST_VARS__";

describe("variables actions", () => {
  const sb = makeTestClient();

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
    // Cleanup any auto-created "New variable" rows we made.
    await sb
      .from("ending_variables")
      .delete()
      .eq("kind", "text")
      .like("name", "New variable%");
  });

  describe("createEndingVariable", () => {
    it("creates a kind='text' variable named 'New variable' (or a numbered suffix)", async () => {
      await createEndingVariable();
      const { data } = await sb
        .from("ending_variables")
        .select("kind, number_ref, color_index")
        .eq("kind", "text")
        .like("name", "New variable%")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      expect(data?.kind).toBe("text");
      expect(data?.number_ref).toBeNull();
      expect(data?.color_index).toBeGreaterThanOrEqual(0);
      expect(data?.color_index).toBeLessThan(12);
    });

    it("ignores number_ref sort_order slots when picking the next sort", async () => {
      // The seeded number_ref rows sit at sort_order 10000+. Inserting a
      // text variable should land at the next text-slot sort_order, not
      // sort_order 10010+.
      await createEndingVariable();
      const { data } = await sb
        .from("ending_variables")
        .select("sort_order")
        .eq("kind", "text")
        .like("name", "New variable%")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      expect(data?.sort_order).toBeLessThan(10000);
    });
  });

  describe("createEndingVariableValue", () => {
    it("rejects creating a value on a number_ref variable", async () => {
      const { data: numVar } = await sb
        .from("ending_variables")
        .select("id")
        .eq("kind", "number_ref")
        .eq("number_ref", "world_status")
        .single();
      if (!numVar) throw new Error("expected seeded world_status variable");

      const fd = new FormData();
      fd.set("variable_id", numVar.id as string);
      await expect(createEndingVariableValue(fd)).rejects.toThrow(
        /don't have stored values/i
      );
    });

    it("allows creating a value on a text variable", async () => {
      const { data: textVar } = await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}txt1`,
          kind: "text",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!textVar) throw new Error("seed textVar");

      const fd = new FormData();
      fd.set("variable_id", textVar.id as string);
      await createEndingVariableValue(fd);

      const { count } = await sb
        .from("ending_variable_values")
        .select("id", { count: "exact", head: true })
        .eq("variable_id", textVar.id);
      expect(count).toBe(1);
    });
  });

  describe("createEndingVariableInline", () => {
    it("creates the variable + first value, sets default, returns ids", async () => {
      const name = `${TEST_PREFIX}inline_var_${Math.random()}`;
      const firstValue = "Alpha";
      const { variableId, valueId } = await createEndingVariableInline({
        name,
        firstValue,
      });
      expect(variableId).toBeTruthy();
      expect(valueId).toBeTruthy();

      const { data: variable } = await sb
        .from("ending_variables")
        .select("kind, default_value_id, name")
        .eq("id", variableId)
        .single();
      expect(variable?.kind).toBe("text");
      expect(variable?.name).toBe(name);
      // The first value gets installed as the default.
      expect(variable?.default_value_id).toBe(valueId);

      const { data: value } = await sb
        .from("ending_variable_values")
        .select("value, variable_id, sort_order")
        .eq("id", valueId)
        .single();
      expect(value?.variable_id).toBe(variableId);
      expect(value?.value).toBe(firstValue);
      expect(value?.sort_order).toBe(0);
    });

    it("trims whitespace on name + first value before persisting", async () => {
      const baseName = `${TEST_PREFIX}trim_${Math.random()}`;
      const { variableId, valueId } = await createEndingVariableInline({
        name: `  ${baseName}  `,
        firstValue: "  Bravo  ",
      });
      const { data: variable } = await sb
        .from("ending_variables")
        .select("name")
        .eq("id", variableId)
        .single();
      const { data: value } = await sb
        .from("ending_variable_values")
        .select("value")
        .eq("id", valueId)
        .single();
      expect(variable?.name).toBe(baseName);
      expect(value?.value).toBe("Bravo");
    });

    it("rejects an empty name", async () => {
      await expect(
        createEndingVariableInline({ name: "   ", firstValue: "ok" })
      ).rejects.toThrow(/name is required/i);
    });

    it("rejects an empty first value", async () => {
      await expect(
        createEndingVariableInline({
          name: `${TEST_PREFIX}no_value`,
          firstValue: "",
        })
      ).rejects.toThrow(/value is required/i);
    });
  });

  describe("createEndingVariableValueInline", () => {
    it("creates a value on an existing text variable + returns the id", async () => {
      const { data: textVar } = await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}vinline_target`,
          kind: "text",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!textVar) throw new Error("seed textVar");

      const { valueId } = await createEndingVariableValueInline({
        variable_id: textVar.id as string,
        value: "Charlie",
      });
      expect(valueId).toBeTruthy();

      const { data: value } = await sb
        .from("ending_variable_values")
        .select("value, variable_id")
        .eq("id", valueId)
        .single();
      expect(value?.variable_id).toBe(textVar.id);
      expect(value?.value).toBe("Charlie");
    });

    it("appends with the next sort_order slot", async () => {
      const { data: textVar } = await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}vinline_sort`,
          kind: "text",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!textVar) throw new Error("seed textVar");

      // Seed an existing value at sort_order 4 — the next inline value
      // should land at 5.
      await sb.from("ending_variable_values").insert({
        variable_id: textVar.id as string,
        value: "first",
        sort_order: 4,
      });

      const { valueId } = await createEndingVariableValueInline({
        variable_id: textVar.id as string,
        value: "second",
      });
      const { data: appended } = await sb
        .from("ending_variable_values")
        .select("sort_order")
        .eq("id", valueId)
        .single();
      expect(appended?.sort_order).toBe(5);
    });

    it("rejects creating a value on a number_ref variable", async () => {
      const { data: numVar } = await sb
        .from("ending_variables")
        .select("id")
        .eq("kind", "number_ref")
        .eq("number_ref", "world_status")
        .single();
      if (!numVar) throw new Error("expected seeded world_status variable");

      await expect(
        createEndingVariableValueInline({
          variable_id: numVar.id as string,
          value: "won't fit",
        })
      ).rejects.toThrow(/text variables/i);
    });

    it("rejects an empty value", async () => {
      const { data: textVar } = await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}vinline_empty`,
          kind: "text",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!textVar) throw new Error("seed textVar");

      await expect(
        createEndingVariableValueInline({
          variable_id: textVar.id as string,
          value: "   ",
        })
      ).rejects.toThrow(/value text is required/i);
    });

    it("rejects an empty variable_id", async () => {
      await expect(
        createEndingVariableValueInline({
          variable_id: "",
          value: "anything",
        })
      ).rejects.toThrow(/variable_id is required/i);
    });
  });
});
