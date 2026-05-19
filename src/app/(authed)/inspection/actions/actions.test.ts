import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addActionTemplate,
  cleanupActionTemplates,
  makeTestClient,
} from "../../../../../tests/integration/_helpers";

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

// Imports of the action MUST come after the mocks above.
import {
  createActionTemplate,
  deleteActionTemplate,
  updateAllActionTemplates,
} from "./actions";

const sb = makeTestClient();

// `action_templates` is not reachable from a storyline cascade, so we manage
// cleanup explicitly here. The 5 seeded production rows ('Deliver', 'Flag',
// 'Return', 'Redirect', 'Destroy') are NOT test-prefixed and will survive
// cleanupActionTemplates — which means `createActionTemplate` can read their
// sort_orders when computing nextSort. Tests below account for that.
beforeAll(async () => {
  await cleanupActionTemplates(sb);
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

afterEach(async () => {
  await cleanupActionTemplates(sb);
});

describe("createActionTemplate", () => {
  it("should insert a default 'New action' row and revalidate /inspection/actions", async () => {
    await createActionTemplate();

    // Multiple "New action" rows may already exist (the migration seed
    // populates several); verify the most-recent one carries the
    // documented defaults instead of pinning the total count.
    const { data } = await sb
      .from("action_templates")
      .select("name, icon_type, color_hex")
      .eq("name", "New action")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(data).toMatchObject({
      name: "New action",
      icon_type: "lucide",
      color_hex: "#888888",
    });

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/actions");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("should set sort_order to max(existing) + 1", async () => {
    // Seed a test row at a very high sort_order so the action's
    // `max(sort_order) + 1` is deterministically `9999 + 1` regardless of
    // however many production seed rows occupy the lower range.
    await addActionTemplate(sb, { suffix: "max-probe", sortOrder: 9999 });

    await createActionTemplate();

    const { data: created } = await sb
      .from("action_templates")
      .select("id")
      .eq("sort_order", 10000);
    expect(created?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("updateAllActionTemplates", () => {
  it("should update every row's editable fields and revalidate both paths", async () => {
    const id1 = await addActionTemplate(sb, { suffix: "row1" });
    const id2 = await addActionTemplate(sb, { suffix: "row2" });

    const fd = new FormData();
    fd.append("ids", id1);
    fd.append("ids", id2);
    fd.append("names", "Renamed One");
    fd.append("names", "Renamed Two");
    // The DB icon_type enum is only {lucide, svg, emoji} — `tabler` /
    // `animal` are in the TS enum but not the Postgres one (mismatch
    // worth fixing separately; the test must use DB-accepted values).
    fd.append("icon_types", "svg");
    fd.append("icon_types", "emoji");
    fd.append("icon_values", "Stamp");
    fd.append("icon_values", "📮");
    fd.append("colors", "#FF8800");
    fd.append("colors", "abc");
    fd.append("sort_orders", "10");
    fd.append("sort_orders", "20");
    fd.append("paired_template_ids", "");
    fd.append("paired_template_ids", "");

    await updateAllActionTemplates(fd);

    const { data } = await sb
      .from("action_templates")
      .select("id, name, icon_type, icon_value, color_hex, sort_order, paired_template_id")
      .in("id", [id1, id2])
      .order("sort_order");
    expect(data).toEqual([
      {
        id: id1,
        name: "Renamed One",
        icon_type: "svg",
        icon_value: "Stamp",
        color_hex: "#ff8800",
        sort_order: 10,
        paired_template_id: null,
      },
      {
        id: id2,
        name: "Renamed Two",
        icon_type: "emoji",
        icon_value: "📮",
        color_hex: "#aabbcc",
        sort_order: 20,
        paired_template_id: null,
      },
    ]);

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/actions");
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
  });

  it("should write paired_template_id symmetrically when one side specifies a partner", async () => {
    const id1 = await addActionTemplate(sb, { suffix: "pair-a" });
    const id2 = await addActionTemplate(sb, { suffix: "pair-b" });

    const fd = new FormData();
    fd.append("ids", id1);
    fd.append("ids", id2);
    fd.append("names", "A");
    fd.append("names", "B");
    fd.append("icon_types", "lucide");
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "");
    fd.append("icon_values", "");
    fd.append("colors", "#111111");
    fd.append("colors", "#222222");
    fd.append("sort_orders", "1");
    fd.append("sort_orders", "2");
    // Only the first row names a partner; the action must write the link
    // BOTH ways so id2.paired_template_id === id1 as well.
    fd.append("paired_template_ids", id2);
    fd.append("paired_template_ids", "");

    await updateAllActionTemplates(fd);

    const { data } = await sb
      .from("action_templates")
      .select("id, paired_template_id")
      .in("id", [id1, id2]);
    const byId = Object.fromEntries(
      (data ?? []).map((r) => [r.id as string, r.paired_template_id])
    );
    expect(byId[id1]).toBe(id2);
    expect(byId[id2]).toBe(id1);
  });

  it("should skip rows whose name is blank after trimming", async () => {
    const id = await addActionTemplate(sb, {
      suffix: "blank",
      sortOrder: 5,
    });

    const fd = new FormData();
    fd.append("ids", id);
    fd.append("names", "   "); // whitespace-only → trimmed to empty → skipped
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "");
    fd.append("colors", "#abcdef");
    fd.append("sort_orders", "99");
    fd.append("paired_template_ids", "");

    await updateAllActionTemplates(fd);

    const { data } = await sb
      .from("action_templates")
      .select("name, color_hex, sort_order")
      .eq("id", id)
      .single();
    // Row is unchanged — the blank-name skip short-circuits before the update.
    expect(data?.name).toBe("__INT_TEST__blank");
    expect(data?.color_hex).toBe("#888888");
    expect(data?.sort_order).toBe(5);

    // Revalidates still fire because the action does so unconditionally at end.
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/actions");
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
  });

  it("should clear paired_template_id on the first pass when no partner is provided", async () => {
    // Seed two templates already paired to each other.
    const id1 = await addActionTemplate(sb, { suffix: "unpair-a" });
    const id2 = await addActionTemplate(sb, {
      suffix: "unpair-b",
      pairedTemplateId: id1,
    });
    await sb
      .from("action_templates")
      .update({ paired_template_id: id2 })
      .eq("id", id1);

    const fd = new FormData();
    fd.append("ids", id1);
    fd.append("ids", id2);
    fd.append("names", "A");
    fd.append("names", "B");
    fd.append("icon_types", "lucide");
    fd.append("icon_types", "lucide");
    fd.append("icon_values", "");
    fd.append("icon_values", "");
    fd.append("colors", "#111111");
    fd.append("colors", "#222222");
    fd.append("sort_orders", "1");
    fd.append("sort_orders", "2");
    // No partners listed — both rows should land paired_template_id = null.
    fd.append("paired_template_ids", "");
    fd.append("paired_template_ids", "");

    await updateAllActionTemplates(fd);

    const { data } = await sb
      .from("action_templates")
      .select("id, paired_template_id")
      .in("id", [id1, id2]);
    for (const row of data ?? []) {
      expect(row.paired_template_id).toBeNull();
    }
  });
});

describe("deleteActionTemplate", () => {
  it("should delete the row by id and revalidate /inspection/actions", async () => {
    const id = await addActionTemplate(sb, { suffix: "to-delete" });

    const fd = new FormData();
    fd.set("id", id);
    await deleteActionTemplate(fd);

    const { data } = await sb
      .from("action_templates")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data).toBeNull();

    expect(revalidatePath).toHaveBeenCalledWith("/inspection/actions");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("should no-op (no DB write, no revalidate) when id is missing", async () => {
    const id = await addActionTemplate(sb, { suffix: "survives" });

    const fd = new FormData();
    // No `id` field set.
    await deleteActionTemplate(fd);

    const { data } = await sb
      .from("action_templates")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data?.id).toBe(id);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
