import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addRule,
  addRuleCondition,
  cleanupSortingRules,
  makeTestClient,
} from "../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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
  createRule,
  deleteRule,
  duplicateRule,
  patchSortingRule,
  saveConditions,
  saveRuleAll,
  updateRule,
} from "./actions";

const ALL_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i)
);

const sb = makeTestClient();

beforeAll(async () => {
  await cleanupSortingRules(sb);
});

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
});

afterEach(async () => {
  await cleanupSortingRules(sb);
});

describe("createRule", () => {
  it("should allocate the first free letter and revalidate /sorting/rules", async () => {
    await addRule(sb, { letter: "A" });
    await addRule(sb, { letter: "B" });

    await createRule();

    const { data } = await sb
      .from("sorting_rules")
      .select("letter, match_mode")
      .order("letter");
    expect(data?.map((r) => r.letter)).toEqual(["A", "B", "C"]);
    const created = data?.find((r) => r.letter === "C");
    expect(created?.match_mode).toBe("all");
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should fill the lowest gap in the letter sequence", async () => {
    await addRule(sb, { letter: "A" });
    await addRule(sb, { letter: "C" });

    await createRule();

    const { data } = await sb.from("sorting_rules").select("letter");
    expect((data ?? []).map((r) => r.letter).sort()).toEqual(["A", "B", "C"]);
  });

  it("should redirect to the new rule's edit page", async () => {
    await createRule();

    const { data } = await sb.from("sorting_rules").select("id").single();
    expect(redirect).toHaveBeenCalledWith(`/sorting/rules/${data?.id}`);
  });
});

describe("updateRule", () => {
  it("should apply form fields and revalidate both rule paths", async () => {
    const ruleId = await addRule(sb, { letter: "A" });

    const fd = new FormData();
    fd.set("id", ruleId);
    fd.set("letter", "Q");
    fd.set("storage_location", "Shelf 3");
    fd.set("summary", "Reroute Folos mail");
    fd.set("destination_slot", "5");
    fd.set("match_mode", "any");

    await updateRule(fd);

    const { data } = await sb
      .from("sorting_rules")
      .select("letter, storage_location, summary, destination_slot, match_mode")
      .eq("id", ruleId)
      .single();
    expect(data).toEqual({
      letter: "Q",
      storage_location: "Shelf 3",
      summary: "Reroute Folos mail",
      destination_slot: 5,
      match_mode: "any",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/sorting/rules/${ruleId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should uppercase and take the first char of the letter field", async () => {
    const ruleId = await addRule(sb, { letter: "A" });

    const fd = new FormData();
    fd.set("id", ruleId);
    fd.set("letter", "zebra");
    fd.set("match_mode", "all");

    await updateRule(fd);

    const { data } = await sb
      .from("sorting_rules")
      .select("letter")
      .eq("id", ruleId)
      .single();
    expect(data?.letter).toBe("Z");
  });

  it("should no-op when no id is provided", async () => {
    const fd = new FormData();
    fd.set("letter", "Z");

    await updateRule(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("duplicateRule", () => {
  it("should clone scalar fields and conditions to a fresh letter", async () => {
    const sourceId = await addRule(sb, {
      letter: "A",
      matchMode: "any",
      storageLocation: "Bin 1",
      summary: "Original rule",
      destinationSlot: 4,
    });
    await addRuleCondition(sb, {
      ruleId: sourceId,
      position: 1,
      target: "sender_name",
      operator: "equals",
      referenceValue: "Alice",
      referenceType: "string",
    });
    await addRuleCondition(sb, {
      ruleId: sourceId,
      position: 2,
      target: "recipient_name",
      operator: "contains",
      referenceValue: "Bob",
      referenceType: "string",
    });

    const fd = new FormData();
    fd.set("id", sourceId);
    await duplicateRule(fd);

    const { data: clone } = await sb
      .from("sorting_rules")
      .select("id, letter, match_mode, storage_location, summary, destination_slot")
      .neq("id", sourceId)
      .single();
    expect(clone?.letter).toBe("B");
    expect(clone).toMatchObject({
      match_mode: "any",
      storage_location: "Bin 1",
      summary: "Original rule",
      destination_slot: 4,
    });

    const { data: conds } = await sb
      .from("sorting_rule_conditions")
      .select("position, target, operator, reference_value, reference_type")
      .eq("rule_id", clone?.id)
      .order("position");
    expect(conds).toEqual([
      {
        position: 1,
        target: "sender_name",
        operator: "equals",
        reference_value: "Alice",
        reference_type: "string",
      },
      {
        position: 2,
        target: "recipient_name",
        operator: "contains",
        reference_value: "Bob",
        reference_type: "string",
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should throw when all 26 letters A-Z are taken", async () => {
    for (const letter of ALL_LETTERS) {
      await addRule(sb, { letter });
    }
    const { data: source } = await sb
      .from("sorting_rules")
      .select("id")
      .eq("letter", "A")
      .single();

    const fd = new FormData();
    fd.set("id", source!.id);

    await expect(duplicateRule(fd)).rejects.toThrow(
      "No free rule letter (A-Z) available."
    );
  });

  it("should no-op when the source rule does not exist", async () => {
    const fd = new FormData();
    fd.set("id", "00000000-0000-0000-0000-000000000000");

    await duplicateRule(fd);

    const { count } = await sb
      .from("sorting_rules")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteRule", () => {
  it("should delete the rule and redirect to the list", async () => {
    const ruleId = await addRule(sb, { letter: "A" });

    const fd = new FormData();
    fd.set("id", ruleId);
    await deleteRule(fd);

    const { data } = await sb
      .from("sorting_rules")
      .select("id")
      .eq("id", ruleId)
      .maybeSingle();
    expect(data).toBeNull();
    expect(redirect).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should cascade-delete the rule's conditions", async () => {
    const ruleId = await addRule(sb, { letter: "A" });
    await addRuleCondition(sb, { ruleId, position: 1 });

    const fd = new FormData();
    fd.set("id", ruleId);
    await deleteRule(fd);

    const { count } = await sb
      .from("sorting_rule_conditions")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", ruleId);
    expect(count).toBe(0);
  });
});

describe("saveRuleAll", () => {
  it("should update the rule, replace conditions with 1-based positions, and revalidate", async () => {
    const ruleId = await addRule(sb, { letter: "A" });
    // Pre-existing condition that must be wiped by the replace.
    await addRuleCondition(sb, {
      ruleId,
      position: 1,
      target: "sender_name",
      referenceValue: "stale",
    });

    await saveRuleAll({
      id: ruleId,
      letter: "M",
      destination_slot: 7,
      day_implemented_id: null,
      storage_location: "Vault",
      summary: "Replaced",
      match_mode: "any",
      conditions: [
        {
          target: "recipient_name",
          target_slice: "whole",
          operator: "equals",
          reference_type: "string",
          reference_value: "Carol",
        },
        {
          target: "sender_name",
          target_slice: "first_char",
          operator: "contains",
          reference_type: "string",
          reference_value: "Dave",
        },
      ],
    });

    const { data: rule } = await sb
      .from("sorting_rules")
      .select("letter, destination_slot, storage_location, summary, match_mode")
      .eq("id", ruleId)
      .single();
    expect(rule).toEqual({
      letter: "M",
      destination_slot: 7,
      storage_location: "Vault",
      summary: "Replaced",
      match_mode: "any",
    });

    const { data: conds } = await sb
      .from("sorting_rule_conditions")
      .select("position, target, target_slice, operator, reference_value")
      .eq("rule_id", ruleId)
      .order("position");
    expect(conds).toEqual([
      {
        position: 1,
        target: "recipient_name",
        target_slice: "whole",
        operator: "equals",
        reference_value: "Carol",
      },
      {
        position: 2,
        target: "sender_name",
        target_slice: "first_char",
        operator: "contains",
        reference_value: "Dave",
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should remove every condition when given an empty conditions array", async () => {
    const ruleId = await addRule(sb, { letter: "A" });
    await addRuleCondition(sb, { ruleId, position: 1 });
    await addRuleCondition(sb, { ruleId, position: 2 });

    await saveRuleAll({
      id: ruleId,
      letter: "A",
      destination_slot: null,
      day_implemented_id: null,
      storage_location: null,
      summary: null,
      match_mode: "all",
      conditions: [],
    });

    const { count } = await sb
      .from("sorting_rule_conditions")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", ruleId);
    expect(count).toBe(0);
  });
});

describe("patchSortingRule", () => {
  it("should apply the patch without calling revalidatePath", async () => {
    const ruleId = await addRule(sb, { letter: "A", summary: "before" });

    await patchSortingRule(ruleId, { summary: "after", destination_slot: 3 });

    const { data } = await sb
      .from("sorting_rules")
      .select("summary, destination_slot")
      .eq("id", ruleId)
      .single();
    expect(data).toEqual({ summary: "after", destination_slot: 3 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveConditions", () => {
  it("should replace all conditions and revalidate both rule paths", async () => {
    const ruleId = await addRule(sb, { letter: "A" });
    await addRuleCondition(sb, {
      ruleId,
      position: 1,
      referenceValue: "stale",
    });

    await saveConditions(ruleId, [
      {
        position: 1,
        target: "sender_name",
        target_slice: "whole",
        operator: "equals",
        reference_type: "string",
        reference_value: "Eve",
      },
    ]);

    const { data } = await sb
      .from("sorting_rule_conditions")
      .select("position, target, reference_value")
      .eq("rule_id", ruleId)
      .order("position");
    expect(data).toEqual([
      { position: 1, target: "sender_name", reference_value: "Eve" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/sorting/rules/${ruleId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/sorting/rules");
  });

  it("should update match_mode when the optional argument is passed", async () => {
    const ruleId = await addRule(sb, { letter: "A", matchMode: "all" });

    await saveConditions(ruleId, [], "any");

    const { data } = await sb
      .from("sorting_rules")
      .select("match_mode")
      .eq("id", ruleId)
      .single();
    expect(data?.match_mode).toBe("any");
  });

  it("should leave match_mode untouched when the argument is omitted", async () => {
    const ruleId = await addRule(sb, { letter: "A", matchMode: "any" });

    await saveConditions(ruleId, []);

    const { data } = await sb
      .from("sorting_rules")
      .select("match_mode")
      .eq("id", ruleId)
      .single();
    expect(data?.match_mode).toBe("any");
  });
});
