import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  addActionTemplate,
  addActionTemplateGroup,
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
  createActionTemplateGroup,
  deleteActionTemplate,
  deleteActionTemplateGroup,
  duplicateActionTemplate,
  moveTemplateToGroup,
  patchActionTemplate,
  patchActionTemplateGroup,
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
  it("should insert a default 'New action' row and revalidate both surfaces", async () => {
    await createActionTemplate();

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
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
  });

  it("should set sort_order to one past the current top-level max", async () => {
    // Seed a high sort_order so the action's nextSort is deterministically
    // `9999 + 1`, regardless of how many production seed rows occupy lower
    // sort_order values.
    await addActionTemplate(sb, { suffix: "max-probe", sortOrder: 9999 });

    await createActionTemplate();

    const { data: created } = await sb
      .from("action_templates")
      .select("id")
      .eq("sort_order", 10000);
    expect(created?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("patchActionTemplate", () => {
  it("should update only the supplied fields and normalize color", async () => {
    const id = await addActionTemplate(sb, { suffix: "patch", sortOrder: 5 });

    await patchActionTemplate(id, {
      name: "Renamed",
      color_hex: "abc",
      icon_type: "emoji",
      icon_value: "📮",
    });

    const { data } = await sb
      .from("action_templates")
      .select("name, icon_type, icon_value, color_hex, sort_order")
      .eq("id", id)
      .single();
    expect(data).toMatchObject({
      name: "Renamed",
      icon_type: "emoji",
      icon_value: "📮",
      color_hex: "#aabbcc",
      sort_order: 5,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/actions");
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
  });

  it("should set group_id when provided", async () => {
    const id = await addActionTemplate(sb, { suffix: "patch-grp" });
    const gid = await addActionTemplateGroup(sb, { name: null });
    await patchActionTemplate(id, { group_id: gid });
    const { data } = await sb
      .from("action_templates")
      .select("group_id")
      .eq("id", id)
      .single();
    expect(data?.group_id).toBe(gid);
  });
});

describe("duplicateActionTemplate", () => {
  it("should clone name + icon + color with '(copy)' appended and place at top level", async () => {
    const id = await addActionTemplate(sb, {
      suffix: "src",
      colorHex: "#112233",
    });
    await duplicateActionTemplate(id);

    const { data } = await sb
      .from("action_templates")
      .select("name, color_hex, group_id")
      .eq("name", "__INT_TEST__src (copy)")
      .single();
    expect(data?.color_hex).toBe("#112233");
    expect(data?.group_id).toBeNull();
  });
});

describe("group operations", () => {
  it("createActionTemplateGroup inserts a group + returns its id", async () => {
    const { id } = await createActionTemplateGroup();
    const { data } = await sb
      .from("action_template_groups")
      .select("id, name")
      .eq("id", id)
      .single();
    expect(data?.id).toBe(id);
    expect(data?.name).toBeNull();
    // Cleanup: server-created groups don't carry the __INT_TEST__ marker so
    // the bulk afterEach cleanup misses them; delete by id here.
    await sb.from("action_template_groups").delete().eq("id", id);
  });

  it("patchActionTemplateGroup updates name", async () => {
    const gid = await addActionTemplateGroup(sb);
    await patchActionTemplateGroup(gid, { name: "  My Group  " });
    const { data } = await sb
      .from("action_template_groups")
      .select("name")
      .eq("id", gid)
      .single();
    expect(data?.name).toBe("My Group");
  });

  it("deleteActionTemplateGroup removes the group but keeps members (ON DELETE SET NULL)", async () => {
    const gid = await addActionTemplateGroup(sb);
    const tid = await addActionTemplate(sb, { suffix: "member", groupId: gid });

    await deleteActionTemplateGroup(gid);

    const { data: groupRow } = await sb
      .from("action_template_groups")
      .select("id")
      .eq("id", gid)
      .maybeSingle();
    expect(groupRow).toBeNull();

    const { data: tplRow } = await sb
      .from("action_templates")
      .select("id, group_id")
      .eq("id", tid)
      .single();
    expect(tplRow?.id).toBe(tid);
    expect(tplRow?.group_id).toBeNull();
  });

  it("moveTemplateToGroup transitions a template into and back out of a group", async () => {
    const tid = await addActionTemplate(sb, { suffix: "moving" });
    const gid = await addActionTemplateGroup(sb);

    await moveTemplateToGroup(tid, gid, 0);
    const { data: inGroup } = await sb
      .from("action_templates")
      .select("group_id, sort_order")
      .eq("id", tid)
      .single();
    expect(inGroup?.group_id).toBe(gid);
    expect(inGroup?.sort_order).toBe(0);

    await moveTemplateToGroup(tid, null, 42);
    const { data: ungrouped } = await sb
      .from("action_templates")
      .select("group_id, sort_order")
      .eq("id", tid)
      .single();
    expect(ungrouped?.group_id).toBeNull();
    expect(ungrouped?.sort_order).toBe(42);
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
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
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
