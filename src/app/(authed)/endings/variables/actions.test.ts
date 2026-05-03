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

describe("variables actions / number_ref", () => {
  const sb = makeTestClient();

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await sb.from("ending_variables").delete().like("name", `${TEST_PREFIX}%`);
    // Wipe number-ref vars by name pattern too — the action defaults their
    // name to the impact column label (e.g. "World Status"), so add a sweep
    // for those by querying recently created rows. Anything matching one of
    // the impact labels with `kind='number_ref'` is fair game in this suite.
    await sb
      .from("ending_variables")
      .delete()
      .eq("kind", "number_ref")
      .like("name", "World Status%");
  });

  describe("createEndingVariable", () => {
    it("defaults to kind=text when called without form data", async () => {
      // Prefix the unique-name pool with a marker the cleanup picks up.
      await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}seed`,
          kind: "text",
          sort_order: 9990,
        });

      await createEndingVariable();

      const { data } = await sb
        .from("ending_variables")
        .select("kind, number_ref")
        .eq("name", "New variable")
        .maybeSingle();
      // Cleanup the auto-named "New variable" row.
      if (data) await sb.from("ending_variables").delete().eq("name", "New variable");
      expect(data?.kind).toBe("text");
      expect(data?.number_ref).toBeNull();
    });

    it("creates a number_ref variable bound to an impact column", async () => {
      const fd = new FormData();
      fd.set("kind", "number_ref");
      fd.set("number_ref", "world_status");
      await createEndingVariable(fd);

      const { data } = await sb
        .from("ending_variables")
        .select("name, kind, number_ref")
        .eq("kind", "number_ref")
        .eq("number_ref", "world_status")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      expect(data?.kind).toBe("number_ref");
      expect(data?.number_ref).toBe("world_status");
      expect(data?.name).toMatch(/World Status/);
    });

    it("rejects an invalid number_ref column", async () => {
      const fd = new FormData();
      fd.set("kind", "number_ref");
      fd.set("number_ref", "made_up_column");
      await expect(createEndingVariable(fd)).rejects.toThrow(
        /number_ref must be one of/i
      );
    });

    it("rejects number_ref kind without a number_ref param", async () => {
      const fd = new FormData();
      fd.set("kind", "number_ref");
      // no number_ref set
      await expect(createEndingVariable(fd)).rejects.toThrow(
        /number_ref must be one of/i
      );
    });

    it("rejects an unknown kind", async () => {
      const fd = new FormData();
      fd.set("kind", "alien");
      await expect(createEndingVariable(fd)).rejects.toThrow(/invalid kind/i);
    });
  });

  describe("createEndingVariableValue", () => {
    it("rejects creating a value on a number_ref variable", async () => {
      const { data: numVar } = await sb
        .from("ending_variables")
        .insert({
          name: `${TEST_PREFIX}num1`,
          kind: "number_ref",
          number_ref: "world_status",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!numVar) throw new Error("seed numVar");

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
