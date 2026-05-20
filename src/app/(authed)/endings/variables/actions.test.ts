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
  createEndingVariableFolder,
  createEndingVariableInline,
  createEndingVariableValue,
  createEndingVariableValueInline,
  deleteEndingVariable,
  deleteEndingVariableFolder,
  deleteEndingVariableValue,
  moveFolderToFolder,
  moveVariableToFolder,
  patchEndingVariable,
  patchEndingVariableFolder,
  patchEndingVariableValue,
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
    // Cleanup any folders we created in tests.
    await sb
      .from("ending_variable_folders")
      .delete()
      .like("name", `${TEST_PREFIX}%`);
    // Also drop the default "New folder" rows the create-folder action
    // produces.
    await sb
      .from("ending_variable_folders")
      .delete()
      .eq("name", "New folder");
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

  // ------------------------------------------------------------------
  // Folder lifecycle — happy-path coverage for the folder management
  // actions added in the variables-folders branch. We exercise a full
  // create → patch → move → delete loop so the integration coverage
  // counts the action bodies, including the renumber_sort_orders
  // helper and the cycle-guard branch in moveFolderToFolder.
  // ------------------------------------------------------------------
  describe("folder lifecycle", () => {
    it("creates, renames, nests, and deletes folders without errors", async () => {
      const { id: rootId } = await createEndingVariableFolder();
      const { id: childId } = await createEndingVariableFolder({
        parent_folder_id: rootId,
      });
      await patchEndingVariableFolder(rootId, {
        name: `${TEST_PREFIX} renamed-root`,
      });
      await patchEndingVariableFolder(childId, {
        name: `${TEST_PREFIX} renamed-child`,
      });
      // Move the child back to root via moveFolderToFolder so the
      // renumber path runs at least once.
      await moveFolderToFolder({
        folder_id: childId,
        parent_folder_id: null,
        before_id: null,
      });
      // Cleanup the two folders we created.
      const fd1 = new FormData();
      fd1.set("id", childId);
      await deleteEndingVariableFolder(fd1);
      const fd2 = new FormData();
      fd2.set("id", rootId);
      await deleteEndingVariableFolder(fd2);
    });

    it("rejects a move that would create a cycle", async () => {
      const { id: outerId } = await createEndingVariableFolder();
      const { id: innerId } = await createEndingVariableFolder({
        parent_folder_id: outerId,
      });
      // Moving the outer folder under its own descendant must throw —
      // the server-side cycle walk catches this before the DB trigger
      // would so the user gets a friendly error.
      await expect(
        moveFolderToFolder({
          folder_id: outerId,
          parent_folder_id: innerId,
          before_id: null,
        })
      ).rejects.toThrow(/itself or a descendant/i);
      // Cleanup
      const fd1 = new FormData();
      fd1.set("id", innerId);
      await deleteEndingVariableFolder(fd1);
      const fd2 = new FormData();
      fd2.set("id", outerId);
      await deleteEndingVariableFolder(fd2);
    });

    it("rejects a folder name that's whitespace only", async () => {
      const { id } = await createEndingVariableFolder();
      await expect(
        patchEndingVariableFolder(id, { name: "   " })
      ).rejects.toThrow(/folder name cannot be empty/i);
      // Cleanup
      const fd = new FormData();
      fd.set("id", id);
      await deleteEndingVariableFolder(fd);
    });

    it("rejects making a folder its own parent", async () => {
      const { id } = await createEndingVariableFolder();
      await expect(
        patchEndingVariableFolder(id, { parent_folder_id: id })
      ).rejects.toThrow(/cannot be its own parent/i);
      const fd = new FormData();
      fd.set("id", id);
      await deleteEndingVariableFolder(fd);
    });
  });

  // ------------------------------------------------------------------
  // Variable + value patch / delete — covers the per-field patch
  // helpers and the FormData-based delete paths used by the
  // VariableInspector.
  // ------------------------------------------------------------------
  describe("variable patch + delete", () => {
    it("patches name, color_hex, and folder_id round-trip", async () => {
      await createEndingVariable();
      const { data: variable } = await sb
        .from("ending_variables")
        .select("id")
        .eq("kind", "text")
        .like("name", "New variable%")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      const id = variable!.id;
      const { id: folderId } = await createEndingVariableFolder();
      await patchEndingVariable(id, {
        name: `${TEST_PREFIX} renamed`,
        color_hex: "#abcdef",
        folder_id: folderId,
      });
      const { data: after } = await sb
        .from("ending_variables")
        .select("name, color_hex, folder_id")
        .eq("id", id)
        .single();
      expect(after?.name).toBe(`${TEST_PREFIX} renamed`);
      expect(after?.color_hex?.toLowerCase()).toBe("#abcdef");
      expect(after?.folder_id).toBe(folderId);
      // Move the variable back to root via moveVariableToFolder so the
      // renumber path runs.
      await moveVariableToFolder({
        variable_id: id,
        folder_id: null,
        before_id: null,
      });
      const fdVar = new FormData();
      fdVar.set("id", id);
      await deleteEndingVariable(fdVar);
      const fdFolder = new FormData();
      fdFolder.set("id", folderId);
      await deleteEndingVariableFolder(fdFolder);
    });

    it("rejects an invalid color_hex", async () => {
      await createEndingVariable();
      const { data: variable } = await sb
        .from("ending_variables")
        .select("id")
        .eq("kind", "text")
        .like("name", "New variable%")
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      const id = variable!.id;
      await expect(
        patchEndingVariable(id, { color_hex: "not-a-color" })
      ).rejects.toThrow(/invalid color/i);
      const fd = new FormData();
      fd.set("id", id);
      await deleteEndingVariable(fd);
    });

    it("patches a value and deletes it via FormData", async () => {
      const { variableId, valueId } = await createEndingVariableInline({
        name: `${TEST_PREFIX} val-host`,
        firstValue: "first",
      });
      await patchEndingVariableValue(valueId, {
        value: `${TEST_PREFIX} renamed-value`,
      });
      const { data: row } = await sb
        .from("ending_variable_values")
        .select("value")
        .eq("id", valueId)
        .single();
      expect(row?.value).toBe(`${TEST_PREFIX} renamed-value`);
      const fdVal = new FormData();
      fdVal.set("id", valueId);
      await deleteEndingVariableValue(fdVal);
      const fdVar = new FormData();
      fdVar.set("id", variableId);
      await deleteEndingVariable(fdVar);
    });

    it("rejects an empty value", async () => {
      const { variableId, valueId } = await createEndingVariableInline({
        name: `${TEST_PREFIX} reject-empty`,
        firstValue: "first",
      });
      await expect(
        patchEndingVariableValue(valueId, { value: "" })
      ).rejects.toThrow(/value cannot be empty/i);
      const fdVar = new FormData();
      fdVar.set("id", variableId);
      await deleteEndingVariable(fdVar);
    });
  });
});
