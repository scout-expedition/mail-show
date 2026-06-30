import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  createSmartVariable,
  renameSmartVariable,
  deleteSmartVariable,
  setSmartVariableColor,
  createSmartVariableFolder,
  renameSmartVariableFolder,
  moveSmartVariableFolder,
  deleteSmartVariableFolder,
  moveSmartVariableToFolder,
} from "./actions";

// Distinctive prefix so cleanup targets only this file's rows even on a
// DB shared with the regular-variables integration tests running in
// parallel. slugify("__INT_TEST_SMARTVARS__ …") -> "int-test-smartvars-…",
// which won't collide with the other agent's namespace.
const PREFIX = "__INT_TEST_SMARTVARS__";

/** Unique per-call name so re-runs against a dirty DB never collide on the
 *  whole-table slug-unique indexes (ending_variables / folders). */
function uname(label: string): string {
  return `${PREFIX} ${label} ${Math.random().toString(36).slice(2, 8)}`;
}

const ENDINGS_PATHS = [
  "/endings/variables",
  "/endings/smart-variables",
  "/endings/logic",
  "/endings/frameworks",
  "/inspection/letters",
];

function expectEndingsRevalidated() {
  for (const p of ENDINGS_PATHS) {
    expect(revalidatePath).toHaveBeenCalledWith(p);
  }
}

describe("smart-variables actions", () => {
  const sb = makeTestClient();

  async function cleanup() {
    // Docs first: the paired smart_ref variable + condition/fallback
    // blocks cascade off the doc delete, so folders no longer hold any
    // variables by the time we drop them.
    await sb
      .from("ending_documents")
      .delete()
      .eq("kind", "smart_variable")
      .like("name", `${PREFIX}%`);
    // Stray standalone variables (e.g. the wrong-kind move fixture).
    await sb.from("ending_variables").delete().like("name", `${PREFIX}%`);
    // Folders: parent_folder_id FK is `on delete restrict`, so un-nest
    // before the bulk delete to avoid a same-statement restrict failure.
    await sb
      .from("ending_variable_folders")
      .update({ parent_folder_id: null })
      .eq("scope", "smart_variable")
      .like("name", `${PREFIX}%`);
    await sb
      .from("ending_variable_folders")
      .delete()
      .eq("scope", "smart_variable")
      .like("name", `${PREFIX}%`);
  }

  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("createSmartVariable", () => {
    it("inserts the paired doc + smart_ref variable + null fallback block and revalidates the endings paths", async () => {
      const name = uname("create");
      const { documentId, variableId, fallbackBlockId, name: savedName } =
        await createSmartVariable({ name });

      expect(savedName).toBe(name);

      const { data: doc } = await sb
        .from("ending_documents")
        .select("kind, name")
        .eq("id", documentId)
        .single();
      expect(doc?.kind).toBe("smart_variable");
      expect(doc?.name).toBe(name);

      const { data: variable } = await sb
        .from("ending_variables")
        .select("kind, smart_variable_doc_id, color_index, folder_id, name")
        .eq("id", variableId)
        .single();
      expect(variable?.kind).toBe("smart_ref");
      expect(variable?.smart_variable_doc_id).toBe(documentId);
      expect(variable?.folder_id).toBeNull();
      expect(variable?.name).toBe(name);
      expect(variable?.color_index).toBeGreaterThanOrEqual(0);

      const { data: block } = await sb
        .from("ending_blocks")
        .select("block_type, result_value, document_id, parent_block_id")
        .eq("id", fallbackBlockId)
        .single();
      expect(block?.block_type).toBe("fallback");
      expect(block?.result_value).toBeNull();
      expect(block?.document_id).toBe(documentId);
      expect(block?.parent_block_id).toBeNull();

      expectEndingsRevalidated();
    });

    it("appends a numeric suffix when the name slug already exists", async () => {
      const name = uname("dup");
      const first = await createSmartVariable({ name });
      expect(first.name).toBe(name);

      const second = await createSmartVariable({ name });
      expect(second.name).toBe(`${name} 2`);
    });

    it("places the paired variable in the requested folder", async () => {
      const { id: folderId } = await createSmartVariableFolder({
        name: uname("home-folder"),
      });
      const { variableId } = await createSmartVariable({
        name: uname("in-folder"),
        folderId,
      });

      const { data } = await sb
        .from("ending_variables")
        .select("folder_id")
        .eq("id", variableId)
        .single();
      expect(data?.folder_id).toBe(folderId);
    });
  });

  describe("renameSmartVariable", () => {
    it("updates the doc name and mirrors it onto the paired variable via the sync trigger", async () => {
      const { documentId, variableId } = await createSmartVariable({
        name: uname("rename-src"),
      });
      const nextName = uname("rename-dst");
      vi.mocked(revalidatePath).mockClear();

      await renameSmartVariable({ documentId, name: nextName });

      const { data: doc } = await sb
        .from("ending_documents")
        .select("name")
        .eq("id", documentId)
        .single();
      const { data: variable } = await sb
        .from("ending_variables")
        .select("name")
        .eq("id", variableId)
        .single();
      expect(doc?.name).toBe(nextName);
      expect(variable?.name).toBe(nextName);
      expectEndingsRevalidated();
    });

    it("rejects a whitespace-only name", async () => {
      const { documentId } = await createSmartVariable({
        name: uname("rename-empty"),
      });
      await expect(
        renameSmartVariable({ documentId, name: "   " })
      ).rejects.toThrow(/cannot be empty/i);
    });

    it("rejects an unknown document id", async () => {
      await expect(
        renameSmartVariable({
          documentId: "00000000-0000-0000-0000-000000000000",
          name: uname("nope"),
        })
      ).rejects.toThrow(/Unknown Smart Variable/i);
    });

    it("rejects a document that is not a Smart Variable", async () => {
      const { data: otherDoc } = await sb
        .from("ending_documents")
        .select("id")
        .neq("kind", "smart_variable")
        .limit(1)
        .maybeSingle();
      if (!otherDoc) throw new Error("expected a seeded non-smart_variable doc");
      await expect(
        renameSmartVariable({
          documentId: otherDoc.id as string,
          name: uname("hijack"),
        })
      ).rejects.toThrow(/not a Smart Variable/i);
    });
  });

  describe("deleteSmartVariable", () => {
    it("deletes the doc (cascading the paired variable) and revalidates", async () => {
      const { documentId, variableId } = await createSmartVariable({
        name: uname("delete-me"),
      });
      vi.mocked(revalidatePath).mockClear();

      const fd = new FormData();
      fd.set("id", documentId);
      await deleteSmartVariable(fd);

      const { count: docCount } = await sb
        .from("ending_documents")
        .select("id", { count: "exact", head: true })
        .eq("id", documentId);
      const { count: varCount } = await sb
        .from("ending_variables")
        .select("id", { count: "exact", head: true })
        .eq("id", variableId);
      expect(docCount).toBe(0);
      expect(varCount).toBe(0);
      expectEndingsRevalidated();
    });

    it("no-ops without revalidating when the id is empty", async () => {
      const fd = new FormData();
      await deleteSmartVariable(fd);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("no-ops without revalidating when the doc does not exist", async () => {
      const fd = new FormData();
      fd.set("id", "00000000-0000-0000-0000-000000000000");
      await deleteSmartVariable(fd);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("rejects deleting a document that is not a Smart Variable", async () => {
      const { data: otherDoc } = await sb
        .from("ending_documents")
        .select("id")
        .neq("kind", "smart_variable")
        .limit(1)
        .maybeSingle();
      if (!otherDoc) throw new Error("expected a seeded non-smart_variable doc");
      const fd = new FormData();
      fd.set("id", otherDoc.id as string);
      await expect(deleteSmartVariable(fd)).rejects.toThrow(
        /not a Smart Variable/i
      );
    });
  });

  describe("setSmartVariableColor", () => {
    it("writes a valid color_hex onto the paired variable and revalidates", async () => {
      const { documentId, variableId } = await createSmartVariable({
        name: uname("color"),
      });
      vi.mocked(revalidatePath).mockClear();

      await setSmartVariableColor({ documentId, color_hex: "#AbCdEf" });

      const { data } = await sb
        .from("ending_variables")
        .select("color_hex")
        .eq("id", variableId)
        .single();
      expect(data?.color_hex?.toLowerCase()).toBe("#abcdef");
      expectEndingsRevalidated();
    });

    it("clears the override when passed null", async () => {
      const { documentId, variableId } = await createSmartVariable({
        name: uname("color-clear"),
      });
      await setSmartVariableColor({ documentId, color_hex: "#123456" });
      await setSmartVariableColor({ documentId, color_hex: null });

      const { data } = await sb
        .from("ending_variables")
        .select("color_hex")
        .eq("id", variableId)
        .single();
      expect(data?.color_hex).toBeNull();
    });

    it("rejects a malformed hex string", async () => {
      const { documentId } = await createSmartVariable({
        name: uname("color-bad"),
      });
      await expect(
        setSmartVariableColor({ documentId, color_hex: "not-a-color" })
      ).rejects.toThrow(/Invalid color hex/i);
    });
  });

  describe("createSmartVariableFolder", () => {
    it("creates a smart_variable-scope folder at the root and revalidates", async () => {
      const name = uname("new-folder");
      const { id } = await createSmartVariableFolder({ name });

      const { data } = await sb
        .from("ending_variable_folders")
        .select("scope, parent_folder_id, name")
        .eq("id", id)
        .single();
      expect(data?.scope).toBe("smart_variable");
      expect(data?.parent_folder_id).toBeNull();
      expect(data?.name).toBe(name);
      expectEndingsRevalidated();
    });
  });

  describe("renameSmartVariableFolder", () => {
    it("updates the folder name and revalidates", async () => {
      const { id } = await createSmartVariableFolder({ name: uname("ren-src") });
      const nextName = uname("ren-dst");
      vi.mocked(revalidatePath).mockClear();

      await renameSmartVariableFolder({ id, name: nextName });

      const { data } = await sb
        .from("ending_variable_folders")
        .select("name")
        .eq("id", id)
        .single();
      expect(data?.name).toBe(nextName);
      expectEndingsRevalidated();
    });

    it("rejects a whitespace-only name", async () => {
      const { id } = await createSmartVariableFolder({ name: uname("ren-bad") });
      await expect(
        renameSmartVariableFolder({ id, name: "   " })
      ).rejects.toThrow(/cannot be empty/i);
    });
  });

  describe("moveSmartVariableFolder", () => {
    it("nests a folder under a new parent and revalidates", async () => {
      const { id: parentId } = await createSmartVariableFolder({
        name: uname("mv-parent"),
      });
      const { id: childId } = await createSmartVariableFolder({
        name: uname("mv-child"),
      });
      vi.mocked(revalidatePath).mockClear();

      await moveSmartVariableFolder({
        folderId: childId,
        parentFolderId: parentId,
        beforeId: null,
      });

      const { data } = await sb
        .from("ending_variable_folders")
        .select("parent_folder_id")
        .eq("id", childId)
        .single();
      expect(data?.parent_folder_id).toBe(parentId);
      expectEndingsRevalidated();
    });

    it("rejects a move that would create a cycle", async () => {
      const { id: outerId } = await createSmartVariableFolder({
        name: uname("cyc-outer"),
      });
      const { id: innerId } = await createSmartVariableFolder({
        name: uname("cyc-inner"),
      });
      await moveSmartVariableFolder({
        folderId: innerId,
        parentFolderId: outerId,
        beforeId: null,
      });
      await expect(
        moveSmartVariableFolder({
          folderId: outerId,
          parentFolderId: innerId,
          beforeId: null,
        })
      ).rejects.toThrow(/itself or a descendant/i);
    });
  });

  describe("deleteSmartVariableFolder", () => {
    it("deletes the folder via FormData and revalidates", async () => {
      const { id } = await createSmartVariableFolder({ name: uname("del-fldr") });
      vi.mocked(revalidatePath).mockClear();

      const fd = new FormData();
      fd.set("id", id);
      await deleteSmartVariableFolder(fd);

      const { count } = await sb
        .from("ending_variable_folders")
        .select("id", { count: "exact", head: true })
        .eq("id", id);
      expect(count).toBe(0);
      expectEndingsRevalidated();
    });

    it("no-ops without revalidating when the id is empty", async () => {
      const fd = new FormData();
      await deleteSmartVariableFolder(fd);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("moveSmartVariableToFolder", () => {
    it("moves the smart_ref variable into a smart_variable folder and revalidates", async () => {
      const { variableId } = await createSmartVariable({
        name: uname("mv-var"),
      });
      const { id: folderId } = await createSmartVariableFolder({
        name: uname("mv-var-folder"),
      });
      vi.mocked(revalidatePath).mockClear();

      await moveSmartVariableToFolder({
        variableId,
        folderId,
        beforeId: null,
      });

      const { data } = await sb
        .from("ending_variables")
        .select("folder_id")
        .eq("id", variableId)
        .single();
      expect(data?.folder_id).toBe(folderId);
      expectEndingsRevalidated();
    });

    it("rejects an empty variable id", async () => {
      await expect(
        moveSmartVariableToFolder({
          variableId: "",
          folderId: null,
          beforeId: null,
        })
      ).rejects.toThrow(/variableId is required/i);
    });

    it("rejects a variable of the wrong kind", async () => {
      const { data: textVar } = await sb
        .from("ending_variables")
        .insert({
          name: uname("wrong-kind"),
          kind: "text",
          sort_order: 9999,
        })
        .select("id")
        .single();
      if (!textVar) throw new Error("seed text variable");

      await expect(
        moveSmartVariableToFolder({
          variableId: textVar.id as string,
          folderId: null,
          beforeId: null,
        })
      ).rejects.toThrow(/no smart_ref variable/i);
    });
  });
});
