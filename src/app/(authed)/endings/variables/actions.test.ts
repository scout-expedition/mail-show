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
  createEndingVariableValue,
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
});
