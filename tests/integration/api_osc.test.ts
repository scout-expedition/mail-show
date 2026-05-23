/**
 * Integration coverage for /api/osc against a local Supabase stack.
 *
 * Spins up: playthrough + day + sorting rule + physical letter, then POSTs
 * inbound OSC messages to the route handler and asserts both the response
 * shape (the `mirror` field the sidecar sends back over OSC) and the DB
 * mutations the handler performs.
 *
 * Run via `pnpm test:int`. Requires SUPABASE_TEST_URL +
 * SUPABASE_TEST_SERVICE_KEY (see tests/integration/README.md).
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  addDay,
  addLetters,
  addPhysicalLetter,
  addPlaythrough,
  addRule,
  addRuleCondition,
  addSortingLetter,
  cleanupPhysicalLetters,
  cleanupSortingRules,
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "./_helpers";

// The route uses revalidatePath; outside the Next runtime that throws.
// Mock it (and next/navigation for consistency) before importing the route.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// Point the route's supabase helpers at the test instance.
vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import("./_helpers");
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Route MUST be imported after the mocks.
const SECRET = "integration-test-osc-secret-1234567890";

async function importRoute() {
  return import("../../src/app/api/osc/route");
}

const sb = makeTestClient();

// ---------------------------------------------------------------------------
// Fixture state shared by tests
// ---------------------------------------------------------------------------

let playthroughId: string;
let dayId: string;
let sortingLetterId: string;
let physicalLetterId: string;
let inspectionLetterId: string;
let inspectionPhysicalLetterId: string;
let ruleId: string;

const PAYLOAD_SORTING = "SL900001"; // matches the sorting letter
const PAYLOAD_INSPECTION = "SL900002"; // matches the inspection letter
const PAYLOAD_UNKNOWN = "SL999999";

beforeAll(async () => {
  process.env.OSC_BRIDGE_SECRET = SECRET;
  await cleanupTestData(sb);
  await cleanupPhysicalLetters(sb);
  await cleanupSortingRules(sb);
});

beforeEach(async () => {
  // Fresh playthrough + storyline per test so independent runs don't leak.
  const seeded = await seedStoryline(sb, { suffix: "osc-int", days: 1 });
  dayId = seeded.dayIds[0];

  playthroughId = await addPlaythrough(sb, {
    suffix: "osc-int-playthrough",
    currentDayId: dayId,
  });
  // Flip is_active true so the route's default resolution works.
  await sb
    .from("playthroughs")
    .update({ is_active: false })
    .neq("id", playthroughId);
  await sb
    .from("playthroughs")
    .update({ is_active: true, current_phase: "sorting" })
    .eq("id", playthroughId);

  // Sorting letter + matching rule (slot 3, "all" match, name equals "Alice").
  sortingLetterId = await addSortingLetter(sb, { dayId, sortId: 9000 });
  await sb
    .from("sorting_letters")
    .update({ sender_name: "Alice" })
    .eq("id", sortingLetterId);
  ruleId = await addRule(sb, {
    letter: "Z",
    destinationSlot: 3,
    dayImplementedId: dayId,
  });
  await addRuleCondition(sb, {
    ruleId,
    target: "sender_name",
    targetSlice: "whole",
    operator: "equals",
    referenceValue: "Alice",
    referenceType: "string",
  });

  physicalLetterId = await addPhysicalLetter(sb, {
    contentRefType: "sorting",
    contentRefId: sortingLetterId,
    letterId: 900001,
  });
  await sb
    .from("physical_letters")
    .update({ rfid_payload: PAYLOAD_SORTING })
    .eq("id", physicalLetterId);

  // Inspection letter for the inspection-phase tests.
  const [letterId] = await addLetters(sb, {
    groupId: seeded.groupId,
    count: 1,
  });
  inspectionLetterId = letterId;
  inspectionPhysicalLetterId = await addPhysicalLetter(sb, {
    contentRefType: "inspection",
    contentRefId: inspectionLetterId,
    letterId: 900002,
  });
  await sb
    .from("physical_letters")
    .update({ rfid_payload: PAYLOAD_INSPECTION })
    .eq("id", inspectionPhysicalLetterId);
});

afterEach(async () => {
  await sb.from("playthrough_slot_state").delete().eq("playthrough_id", playthroughId);
  await cleanupPhysicalLetters(sb);
  await cleanupSortingRules(sb);
  await cleanupTestData(sb);
});

afterAll(() => {
  delete process.env.OSC_BRIDGE_SECRET;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders() {
  return {
    "content-type": "application/json",
    "x-osc-bridge-secret": SECRET,
  };
}

async function post(body: unknown): Promise<Response> {
  const { POST } = await importRoute();
  return POST(
    new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/osc — RFID sorting flow", () => {
  it("rfid_slot during sorting phase: evaluates rule, mirrors pass over OSC", async () => {
    const res = await post({
      playthroughId,
      message: {
        kind: "rfid_slot",
        slotId: 3,
        payload: PAYLOAD_SORTING,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mirror: { kind: string; slotId: number; outcome: string };
      result: { passed: boolean; errorCode: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.mirror).toEqual({ kind: "status_slot", slotId: 3, outcome: "pass" });
    expect(body.result.passed).toBe(true);
    expect(body.result.errorCode).toBeNull();

    // DB side: playthrough_slot_state has the right row.
    const { data } = await sb
      .from("playthrough_slot_state")
      .select("playthrough_id, slot_id, physical_letter_id, passed, error_code")
      .eq("playthrough_id", playthroughId)
      .eq("slot_id", 3)
      .single();
    expect(data).toMatchObject({
      playthrough_id: playthroughId,
      slot_id: 3,
      physical_letter_id: physicalLetterId,
      passed: true,
      error_code: null,
    });
  });

  it("rfid_slot with unknown payload records error_code=unknown_payload", async () => {
    const res = await post({
      playthroughId,
      message: {
        kind: "rfid_slot",
        slotId: 3,
        payload: PAYLOAD_UNKNOWN,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { kind: string; outcome: string };
      result: { errorCode: string };
    };
    expect(body.mirror.outcome).toBe("error");
    expect(body.result.errorCode).toBe("unknown_payload");
  });

  it("rfid_slot_clear deletes the slot row", async () => {
    // Seed a row to clear.
    await post({
      playthroughId,
      message: { kind: "rfid_slot", slotId: 3, payload: PAYLOAD_SORTING },
    });

    const res = await post({
      playthroughId,
      message: { kind: "rfid_slot_clear", slotId: 3 },
    });
    expect(res.status).toBe(200);

    const { data } = await sb
      .from("playthrough_slot_state")
      .select("id")
      .eq("playthrough_id", playthroughId)
      .eq("slot_id", 3)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

describe("/api/osc — RFID inspection flow", () => {
  beforeEach(async () => {
    await sb
      .from("playthroughs")
      .update({ current_phase: "inspection" })
      .eq("id", playthroughId);
  });

  it("rfid_slot into report slot (0) during inspection → flags letter", async () => {
    const res = await post({
      playthroughId,
      message: { kind: "rfid_slot", slotId: 0, payload: PAYLOAD_INSPECTION },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { kind: string; contentId: string; state: string };
      result: { action: string };
    };
    expect(body.mirror.kind).toBe("status_letter");
    expect(body.mirror.state).toBe("flagged");
    expect(body.result.action).toBe("flag");

    // Choice recorded → resolves to the Flag template.
    const { data: choice } = await sb
      .from("playthrough_action_choices")
      .select("chosen_action_id")
      .eq("playthrough_id", playthroughId)
      .eq("inspection_letter_id", inspectionLetterId)
      .single();
    expect(choice?.chosen_action_id).toBeDefined();
    const { data: action } = await sb
      .from("actions")
      .select("action_template_id")
      .eq("id", choice!.chosen_action_id as string)
      .single();
    const { data: template } = await sb
      .from("action_templates")
      .select("name")
      .eq("id", action!.action_template_id as string)
      .single();
    expect((template?.name as string).toLowerCase()).toBe("flag");
  });

  it("rfid_slot into sorting slot (3) during inspection → delivers letter", async () => {
    const res = await post({
      playthroughId,
      message: { kind: "rfid_slot", slotId: 3, payload: PAYLOAD_INSPECTION },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { kind: string; state: string };
      result: { action: string };
    };
    expect(body.mirror.state).toBe("delivered");
    expect(body.result.action).toBe("deliver");

    const { data: choice } = await sb
      .from("playthrough_action_choices")
      .select("chosen_action_id")
      .eq("playthrough_id", playthroughId)
      .eq("inspection_letter_id", inspectionLetterId)
      .single();
    const { data: action } = await sb
      .from("actions")
      .select("action_template_id")
      .eq("id", choice!.chosen_action_id as string)
      .single();
    const { data: template } = await sb
      .from("action_templates")
      .select("name")
      .eq("id", action!.action_template_id as string)
      .single();
    expect((template?.name as string).toLowerCase()).toBe("deliver");
  });
});

describe("/api/osc — QLab status queries", () => {
  it("status_day_get returns the current day number via mirror", async () => {
    const res = await post({
      playthroughId,
      message: { kind: "status_day_get" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { kind: string; day: number };
    };
    expect(body.mirror.kind).toBe("status_day");
    expect(typeof body.mirror.day).toBe("number");
  });

  it("status_phase_get returns the current phase via mirror", async () => {
    const res = await post({
      playthroughId,
      message: { kind: "status_phase_get" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { kind: string; phase: string };
    };
    expect(body.mirror.kind).toBe("status_phase");
    expect(body.mirror.phase).toBe("sorting");
  });

  it("status_timer_get with phase_started_at unset reports running=false, remainingMs=0", async () => {
    const res = await post({
      playthroughId,
      message: { kind: "status_timer_get" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mirror: { running: boolean; remainingMs: number };
    };
    expect(body.mirror.running).toBe(false);
    expect(body.mirror.remainingMs).toBe(0);
  });
});

describe("/api/osc — playthrough resolution", () => {
  it("uses the playthrough flagged is_active=true when playthroughId is omitted", async () => {
    const res = await post({
      // no playthroughId — should resolve to the active one set in beforeEach
      message: { kind: "status_phase_get" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mirror: { phase: string } };
    expect(body.mirror.phase).toBe("sorting");
  });
});
