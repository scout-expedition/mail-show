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

  it("should land the new template inside the 'Ungrouped' group", async () => {
    // The new template always goes into a (find-or-create) group named
    // "Ungrouped" — the shared bucket for fresh actions. sort_order is
    // relative to that group's existing members, not the top-level max.
    const { templateId, groupId } = await createActionTemplate();
    const { data: ungroupedGroup } = await sb
      .from("action_template_groups")
      .select("id, name")
      .eq("id", groupId)
      .single();
    expect(ungroupedGroup?.name).toBe("Ungrouped");
    const { data: tpl } = await sb
      .from("action_templates")
      .select("group_id")
      .eq("id", templateId)
      .single();
    expect(tpl?.group_id).toBe(groupId);
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
    // Use the default TEST_PREFIX-marked name so cleanupTestData picks
    // it up automatically. Earlier versions passed `name: null` and
    // leaked groups across integration runs.
    const gid = await addActionTemplateGroup(sb);
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
  it("should clone name + icon + color with '(copy)' appended and land in a new solo group", async () => {
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
    // Every template lives in a group; the duplicate gets its own fresh
    // solo group rather than landing ungrouped.
    expect(data?.group_id).toBeTruthy();
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

  it("deleteActionTemplateGroup removes the group AND its member templates", async () => {
    // Under the "every action lives in a group" rule, deleting a group
    // takes its members with it — leaving them orphaned would violate the
    // invariant. The UI's confirm copy reflects this ("group AND its N
    // actions"); this test is the structural counterpart.
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
      .select("id")
      .eq("id", tid)
      .maybeSingle();
    expect(tplRow).toBeNull();
  });

  it("moveTemplateToGroup(null) spawns a fresh solo group for the template", async () => {
    // Dragging an action to the top-level "root" doesn't orphan it —
    // server creates a new solo group and lands the template inside.
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
    const { data: regrouped } = await sb
      .from("action_templates")
      .select("group_id, sort_order")
      .eq("id", tid)
      .single();
    // Not back to null — the server minted a new solo group for it.
    expect(regrouped?.group_id).toBeTruthy();
    expect(regrouped?.group_id).not.toBe(gid);
    expect(regrouped?.sort_order).toBe(42);
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
