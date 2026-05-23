/**
 * Auth + body-validation tests for /api/osc.
 *
 * These tests stub the Supabase + revalidatePath imports so the route can
 * exercise the secret check and zod validation paths without a real DB.
 * Full dispatch coverage lives in the helper unit tests
 * (src/lib/playthroughs/mutations.test.ts, src/lib/sorting/mutations.test.ts)
 * and an eventual integration test against a local Supabase stack.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next/cache: revalidatePath is a no-op outside the Next runtime.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Supabase service client: minimal stub. Every chained query method returns
// `this` so any pipeline ending in `.maybeSingle()` / `.single()` resolves
// with a configurable response.
type StubResp = { data: unknown; error: unknown };
function stubClient(responses: { resolve?: StubResp; mutate?: StubResp } = {}) {
  const resolve = responses.resolve ?? { data: null, error: null };
  const mutate = responses.mutate ?? { data: null, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    insert: () => chain,
    update: () => Promise.resolve(mutate),
    upsert: () => Promise.resolve(mutate),
    delete: () => chain,
    order: () => chain,
    limit: () => chain,
    ilike: () => chain,
    in: () => chain,
    then: (resolveFn: (v: StubResp) => unknown) => Promise.resolve(resolveFn(resolve)),
    maybeSingle: () => Promise.resolve(resolve),
    single: () => Promise.resolve(resolve),
  };
  return {
    from: () => chain,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => stubClient(),
}));

const SECRET = "test-bridge-secret-1234567890";

async function importRoute() {
  return import("./route");
}

describe("/api/osc auth", () => {
  beforeEach(() => {
    process.env.OSC_BRIDGE_SECRET = SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OSC_BRIDGE_SECRET;
  });

  it("rejects requests with a missing secret header (401)", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { kind: "status_phase_get" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("rejects requests with the wrong secret (401)", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-osc-bridge-secret": "totally-wrong",
      },
      body: JSON.stringify({ message: { kind: "status_phase_get" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests when OSC_BRIDGE_SECRET is not configured (401)", async () => {
    delete process.env.OSC_BRIDGE_SECRET;
    vi.resetModules();
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-osc-bridge-secret": "anything",
      },
      body: JSON.stringify({ message: { kind: "status_phase_get" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("/api/osc body validation", () => {
  beforeEach(() => {
    process.env.OSC_BRIDGE_SECRET = SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OSC_BRIDGE_SECRET;
  });

  function authHeaders() {
    return {
      "content-type": "application/json",
      "x-osc-bridge-secret": SECRET,
    };
  }

  it("returns 400 for non-JSON body", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: "this is not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid json");
  });

  it("returns 400 for missing message field", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("invalid body");
  });

  it("returns 400 for malformed inbound message kind", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: { kind: "totally_unknown_kind" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for rfid_slot with negative slotId", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: { kind: "rfid_slot", slotId: -1, payload: "SL000042" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for rfid_slot with malformed payload", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: { kind: "rfid_slot", slotId: 3, payload: "not-a-real-payload" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 409 when no active playthrough and none provided", async () => {
    // Default stub returns null for everything → no active playthrough.
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: { kind: "status_phase_get" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/no active playthrough/);
  });

  it("invalid UUID for playthroughId is rejected (400)", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost/api/osc", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        playthroughId: "not-a-uuid",
        message: { kind: "status_phase_get" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
