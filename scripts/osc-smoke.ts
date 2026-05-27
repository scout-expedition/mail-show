/**
 * One-shot smoke test for the OSC bridge.
 *
 * Boots scripts/osc-bridge.ts as a subprocess pointed at the LOCAL supabase
 * stack only, binds a UDP listener on the bridge's send port to capture
 * outbound OSC, drives playthrough state changes via the service-role
 * client, and reports which OSC addresses fired.
 *
 * Usage: pnpm tsx scripts/osc-smoke.ts
 * Requires: supabase running locally on http://127.0.0.1:54321.
 *
 * Known limitation — Realtime → OSC translation is NOT exercised here.
 * supabase-js v2.103 fails to open a `postgres_changes` subscription from a
 * pure-Node script against the local stack (channel goes straight to CLOSED
 * even with `realtime.setAuth(jwt)`). The smoke confirms the bridge boots,
 * resolves the active playthrough, runs its timer loop, and sends OSC over
 * UDP — but the actual UPDATE → outbound-address mapping must be verified
 * manually by running `pnpm dev` + `pnpm osc:bridge` and exercising the UI
 * (the plan's verification step #1).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const osc = require("osc") as {
  UDPPort: new (opts: {
    localAddress?: string;
    localPort?: number;
    metadata?: boolean;
  }) => {
    on(event: string, cb: (...args: unknown[]) => void): void;
    open(): void;
    close(): void;
  };
};

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const BRIDGE_SECRET = "smoke-test-secret";
const SEND_PORT = 9000; // bridge → here
const LISTEN_PORT = 57121; // bridge's inbound port (unused by smoke)

interface CapturedMsg {
  address: string;
  args: unknown[];
  at: number;
}

async function main(): Promise<void> {
  console.log("[smoke] checking local supabase reachable…");
  const ping = await fetch(`${LOCAL_URL}/rest/v1/`, {
    headers: { apikey: LOCAL_SERVICE_KEY },
  }).catch(() => null);
  if (!ping || !ping.ok) {
    console.error(
      `[smoke] cannot reach ${LOCAL_URL}; is \`supabase start\` running?`
    );
    process.exit(1);
  }

  const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------------------------------------------------------------------------
  // 1. Seed: storyline → day (2s sort phase) → playthrough is_active=true
  // ---------------------------------------------------------------------------
  console.log("[smoke] seeding storyline/day/playthrough…");
  const seedSuffix = `osc-smoke-${Date.now()}`;
  // Pick an abbreviation char that's free (storylines.abbreviation is unique).
  const { data: existingAbbrs } = await supabase
    .from("storylines")
    .select("abbreviation");
  const taken = new Set((existingAbbrs ?? []).map((r) => r.abbreviation));
  const abbr = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((c) => !taken.has(c));
  if (!abbr) throw new Error("no free single-letter abbreviation");
  const { data: storyline, error: slErr } = await supabase
    .from("storylines")
    .insert({
      name: `__INT_TEST__ ${seedSuffix}`,
      abbreviation: abbr,
    })
    .select("id")
    .single();
  if (slErr || !storyline) throw new Error(`storyline insert: ${slErr?.message}`);

  // Pick a day number that's free.
  const { data: maxDay } = await supabase
    .from("days")
    .select("number")
    .order("number", { ascending: false })
    .limit(1);
  const dayNum = (maxDay?.[0]?.number ?? -1) + 1;
  const { data: day, error: dErr } = await supabase
    .from("days")
    .insert({
      number: dayNum,
      sort_phase_length_seconds: 2, // short for timer test
    })
    .select("id, number")
    .single();
  if (dErr || !day) throw new Error(`day insert: ${dErr?.message}`);

  // Demote any existing active playthroughs, then create ours active.
  await supabase
    .from("playthroughs")
    .update({ is_active: false })
    .eq("is_active", true);
  const { data: pt, error: pErr } = await supabase
    .from("playthroughs")
    .insert({
      name: `__INT_TEST__ ${seedSuffix}`,
      is_active: true,
      current_day_id: null, // start without — flip later to fire /show/day/set
      current_phase: "top_of_day",
    })
    .select("id")
    .single();
  if (pErr || !pt) throw new Error(`playthrough insert: ${pErr?.message}`);
  console.log(`[smoke] playthrough ${pt.id}, day ${day.number}`);

  // ---------------------------------------------------------------------------
  // 2. Start UDP listener for outbound OSC from the bridge
  // ---------------------------------------------------------------------------
  console.log(`[smoke] starting UDP capture on :${SEND_PORT}`);
  const captured: CapturedMsg[] = [];
  const udp = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: SEND_PORT,
    metadata: true,
  });
  udp.on("ready", () => console.log("[smoke] capture ready"));
  udp.on("error", (err: unknown) => console.error("[smoke] capture err:", err));
  udp.on("message", (msg: unknown) => {
    const m = msg as { address: string; args: Array<{ value: unknown } | unknown> };
    const args = m.args.map((a) =>
      a !== null && typeof a === "object" && "value" in a
        ? (a as { value: unknown }).value
        : a
    );
    captured.push({ address: m.address, args, at: Date.now() });
    console.log(`[smoke] ← ${m.address}`, args);
  });
  udp.open();
  await sleep(300);

  // ---------------------------------------------------------------------------
  // 3. Spawn the bridge, pointed at local Supabase + capture port
  // ---------------------------------------------------------------------------
  console.log("[smoke] spawning bridge…");
  const bridge: ChildProcess = spawn(
    "pnpm",
    ["exec", "tsx", "scripts/osc-bridge.ts"],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
        SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_KEY,
        OSC_BRIDGE_SECRET: BRIDGE_SECRET,
        OSC_LISTEN_PORT: String(LISTEN_PORT + 1000), // avoid clash
        OSC_SEND_HOST: "127.0.0.1",
        OSC_SEND_PORT: String(SEND_PORT),
        OSC_API_BASE_URL: "http://127.0.0.1:9999", // not used by outbound test
      },
      stdio: ["ignore", "inherit", "inherit"],
    }
  );

  let exitCode: number | null = null;
  bridge.on("exit", (code) => {
    exitCode = code;
    console.log(`[smoke] bridge exited code=${code}`);
  });

  // Wait for bridge readiness (realtime takes ~1s).
  await sleep(3000);
  if (exitCode !== null) {
    console.error("[smoke] bridge died before tests ran");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 4. Drive state changes
  // ---------------------------------------------------------------------------
  const fireAndWait = async (
    description: string,
    fn: () => Promise<unknown>,
    waitMs = 800
  ): Promise<void> => {
    console.log(`[smoke] → ${description}`);
    await fn();
    await sleep(waitMs);
  };

  await fireAndWait("set current_day_id (expect /show/day/set)", () =>
    supabase.from("playthroughs").update({ current_day_id: day.id }).eq("id", pt.id)
  );

  await fireAndWait("set current_phase=sorting (expect /show/phase/set + /show/phase/next)", () =>
    supabase
      .from("playthroughs")
      .update({ current_phase: "sorting" })
      .eq("id", pt.id)
  );

  await fireAndWait("set phase_started_at=now (expect /show/phase/start)", () =>
    supabase
      .from("playthroughs")
      .update({ phase_started_at: new Date().toISOString() })
      .eq("id", pt.id)
  );

  await fireAndWait("set phase_paused_at=now (expect /show/phase/pause)", () =>
    supabase
      .from("playthroughs")
      .update({ phase_paused_at: new Date().toISOString() })
      .eq("id", pt.id)
  );

  await fireAndWait("clear phase_paused_at (expect /show/phase/resume)", () =>
    supabase.from("playthroughs").update({ phase_paused_at: null }).eq("id", pt.id)
  );

  // Wait for the 2s sort phase to expire from phase_started_at → /show/phase/timer/end
  console.log("[smoke] waiting for phase timer (~3s)…");
  await sleep(3000);

  // ---------------------------------------------------------------------------
  // 5. Assert
  // ---------------------------------------------------------------------------
  const expected = [
    "/show/day/set",
    "/show/phase/next",
    "/show/phase/set",
    "/show/phase/start",
    "/show/phase/pause",
    "/show/phase/resume",
    "/show/phase/timer/end",
  ];
  const seen = new Set(captured.map((m) => m.address));
  const missing = expected.filter((a) => !seen.has(a));

  console.log("\n[smoke] captured addresses:", [...seen].sort());

  // ---------------------------------------------------------------------------
  // 6. Cleanup
  // ---------------------------------------------------------------------------
  console.log("[smoke] tearing down…");
  bridge.kill("SIGINT");
  udp.close();
  await supabase.from("playthroughs").delete().eq("id", pt.id);
  await supabase.from("days").delete().eq("id", day.id);
  await supabase.from("storylines").delete().eq("id", storyline.id);

  if (missing.length) {
    console.error(`[smoke] FAIL — missing addresses: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("[smoke] PASS — all 7 expected addresses fired.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] crashed:", err);
  process.exit(1);
});
