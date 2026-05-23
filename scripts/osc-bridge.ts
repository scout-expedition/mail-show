/**
 * OSC bridge sidecar.
 *
 * Long-running Node process. Bridges QLab + RFID over UDP/OSC and the
 * mail-show app (Supabase + /api/osc) over Realtime + HTTP. The sidecar
 * itself is a translator only — it never writes to Supabase directly.
 *
 * Run: `pnpm osc:bridge`
 *
 * Required env (set in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OSC_BRIDGE_SECRET
 *
 * Optional env (with defaults):
 *   OSC_LISTEN_PORT         (default 57121)   — accepts QLab queries
 *   OSC_SEND_HOST           (default 127.0.0.1) — destination for outbound msgs
 *   OSC_SEND_PORT           (default 53000)  — QLab's listening port
 *   OSC_QLAB_REPLY_HOST     (default = OSC_SEND_HOST)
 *   OSC_QLAB_REPLY_PORT     (default = OSC_SEND_PORT)
 *   OSC_RFID_LISTEN_PORT    (no default; only bound if set)
 *   OSC_API_BASE_URL        (default http://localhost:3000)
 *   OSC_BRIDGE_PLAYTHROUGH_ID (override; defaults to playthroughs.is_active = true)
 *
 * See docs/plans/active/osc-mvp-plan.md for the architectural reasoning.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type InboundMessage,
  type OscPacket,
  type OutboundMessage,
  serialize,
  tryParse,
} from "../src/lib/osc/address-map";

// osc.js has no shipped types; declare a minimal shim inline.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const osc = require("osc") as unknown as {
  UDPPort: new (opts: {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
  }) => {
    on(event: "ready" | "error", cb: (...args: unknown[]) => void): void;
    on(event: "message", cb: (msg: { address: string; args: Array<{ value: unknown } | unknown> }, timeTag: unknown, info: { address: string; port: number }) => void): void;
    open(): void;
    close(): void;
    send(packet: { address: string; args: Array<{ type: string; value: unknown }> }, host?: string, port?: number): void;
  };
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Config {
  supabaseUrl: string;
  serviceRoleKey: string;
  bridgeSecret: string;
  listenPort: number;
  sendHost: string;
  sendPort: number;
  replyHost: string;
  replyPort: number;
  rfidListenPort: number | null;
  apiBaseUrl: string;
  playthroughIdOverride: string | null;
}

function loadConfig(): Config {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const bridgeSecret = required("OSC_BRIDGE_SECRET");

  const listenPort = intEnv("OSC_LISTEN_PORT", 57121);
  const sendHost = process.env.OSC_SEND_HOST ?? "127.0.0.1";
  const sendPort = intEnv("OSC_SEND_PORT", 53000);
  const replyHost = process.env.OSC_QLAB_REPLY_HOST ?? sendHost;
  const replyPort = intEnv("OSC_QLAB_REPLY_PORT", sendPort);
  const rfidListenPort = process.env.OSC_RFID_LISTEN_PORT
    ? intEnv("OSC_RFID_LISTEN_PORT", 0)
    : null;
  const apiBaseUrl = process.env.OSC_API_BASE_URL ?? "http://localhost:3000";
  const playthroughIdOverride = process.env.OSC_BRIDGE_PLAYTHROUGH_ID ?? null;

  return {
    supabaseUrl,
    serviceRoleKey,
    bridgeSecret,
    listenPort,
    sendHost,
    sendPort,
    replyHost,
    replyPort,
    rfidListenPort,
    apiBaseUrl,
    playthroughIdOverride,
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Env ${name} must be a non-negative integer, got "${v}"`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// OSC argument typing — osc.js wants {type, value} pairs on send.
// ---------------------------------------------------------------------------

function toOscArg(v: string | number | boolean): { type: string; value: unknown } {
  if (typeof v === "number") {
    return Number.isInteger(v) ? { type: "i", value: v } : { type: "f", value: v };
  }
  if (typeof v === "boolean") {
    return { type: v ? "T" : "F", value: v };
  }
  return { type: "s", value: v };
}

function fromOscArg(arg: unknown): unknown {
  if (arg !== null && typeof arg === "object" && "value" in arg) {
    return (arg as { value: unknown }).value;
  }
  return arg;
}

// ---------------------------------------------------------------------------
// Bridge core
// ---------------------------------------------------------------------------

type AnySupabase = SupabaseClient;

/** Cast the data field of a Supabase query result to a typed row shape. */
function row<T>(result: { data: unknown }): T | null {
  return (result.data as T | null) ?? null;
}

class Bridge {
  private readonly config: Config;
  private readonly supabase: AnySupabase;
  private mainPort: ReturnType<typeof makeUdpPort>;
  private rfidPort: ReturnType<typeof makeUdpPort> | null = null;
  private activePlaythroughId: string | null = null;
  private lastTimerFiredFor: string | null = null; // playthrough_id|phase_started_at key
  private timerInterval: NodeJS.Timeout | null = null;

  constructor(config: Config) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as AnySupabase;
    this.mainPort = makeUdpPort({
      localPort: config.listenPort,
      remoteAddress: config.sendHost,
      remotePort: config.sendPort,
    });
  }

  async start(): Promise<void> {
    // 1. Resolve initial playthrough id.
    await this.refreshActivePlaythrough();
    if (!this.activePlaythroughId) {
      console.warn(
        "[osc-bridge] no active playthrough; waiting for realtime to surface one"
      );
    } else {
      console.log(`[osc-bridge] active playthrough: ${this.activePlaythroughId}`);
    }

    // 2. Bind main UDP port.
    this.mainPort.on("ready", () => {
      console.log(
        `[osc-bridge] listening on UDP ${this.config.listenPort}; sending to ${this.config.sendHost}:${this.config.sendPort}`
      );
    });
    this.mainPort.on("error", (err: unknown) => {
      console.error("[osc-bridge] main port error:", err);
    });
    this.mainPort.on(
      "message",
      (msg: { address: string; args: Array<{ value: unknown } | unknown> }) => {
        this.handleInbound(msg).catch((err) => {
          console.error("[osc-bridge] inbound handler crashed:", err);
        });
      }
    );
    this.mainPort.open();

    // 3. Bind RFID port if configured.
    if (this.config.rfidListenPort !== null) {
      this.rfidPort = makeUdpPort({
        localPort: this.config.rfidListenPort,
        remoteAddress: this.config.sendHost,
        remotePort: this.config.sendPort,
      });
      this.rfidPort.on("ready", () => {
        console.log(
          `[osc-bridge] RFID port listening on UDP ${this.config.rfidListenPort}`
        );
      });
      this.rfidPort.on("error", (err: unknown) => {
        console.error("[osc-bridge] RFID port error:", err);
      });
      this.rfidPort.on(
        "message",
        (msg: { address: string; args: Array<{ value: unknown } | unknown> }) => {
          this.handleInbound(msg).catch((err) => {
            console.error("[osc-bridge] RFID handler crashed:", err);
          });
        }
      );
      this.rfidPort.open();
    }

    // 4. Subscribe to Postgres changes that drive outbound OSC.
    this.subscribeRealtime();

    // 5. Start the phase-timer loop.
    this.timerInterval = setInterval(() => {
      this.checkTimer().catch((err) => {
        console.error("[osc-bridge] timer loop crashed:", err);
      });
    }, 250);
  }

  async stop(): Promise<void> {
    if (this.timerInterval) clearInterval(this.timerInterval);
    try {
      this.mainPort.close();
    } catch {
      /* ignore */
    }
    try {
      this.rfidPort?.close();
    } catch {
      /* ignore */
    }
    await this.supabase.removeAllChannels();
  }

  // -------------------------------------------------------------------------
  // Inbound: OSC packet → /api/osc → mirror response back over OSC.
  // -------------------------------------------------------------------------

  private async handleInbound(msg: {
    address: string;
    args: Array<{ value: unknown } | unknown>;
  }): Promise<void> {
    const packet: OscPacket = {
      address: msg.address,
      args: msg.args.map(fromOscArg) as Array<string | number | boolean>,
    };
    const inbound = tryParse(packet);
    if (!inbound) {
      console.warn(
        `[osc-bridge] dropped unknown inbound packet: ${packet.address}`,
        packet.args
      );
      return;
    }
    await this.forwardToApi(inbound);
  }

  private async forwardToApi(message: InboundMessage): Promise<void> {
    const url = `${this.config.apiBaseUrl}/api/osc`;
    const body = JSON.stringify({
      playthroughId: this.config.playthroughIdOverride ?? undefined,
      message,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-osc-bridge-secret": this.config.bridgeSecret,
        },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`[osc-bridge] /api/osc ${res.status}: ${text}`);
        return;
      }
      // Parse the mirror field — when present, send it back over OSC.
      const parsed = JSON.parse(text) as {
        ok: boolean;
        mirror: OutboundMessage | null;
      };
      if (parsed.ok && parsed.mirror) {
        this.send(parsed.mirror, this.config.replyHost, this.config.replyPort);
      }
    } catch (err) {
      console.error(`[osc-bridge] /api/osc fetch failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Outbound: serialize + send via osc.js.
  // -------------------------------------------------------------------------

  private send(msg: OutboundMessage, host?: string, port?: number): void {
    const packet = serialize(msg);
    this.mainPort.send(
      {
        address: packet.address,
        args: packet.args.map(toOscArg),
      },
      host,
      port
    );
  }

  // -------------------------------------------------------------------------
  // Realtime → OSC translation.
  // -------------------------------------------------------------------------

  private subscribeRealtime(): void {
    // playthroughs: emit day/phase/timer cues on column changes.
    this.supabase
      .channel("osc-playthroughs")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "playthroughs" },
        (payload) => {
          this.handlePlaythroughUpdate(payload).catch((err) => {
            console.error("[osc-bridge] playthrough handler crashed:", err);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "playthroughs" },
        () => {
          this.refreshActivePlaythrough().catch((err) => {
            console.error("[osc-bridge] refresh active failed:", err);
          });
        }
      )
      .subscribe();

    // playthrough_action_choices: emit /show/status/letter on each choice.
    this.supabase
      .channel("osc-action-choices")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playthrough_action_choices" },
        (payload) => {
          this.handleChoiceChange(payload).catch((err) => {
            console.error("[osc-bridge] choice handler crashed:", err);
          });
        }
      )
      .subscribe();

    // playthrough_slot_state: emit /show/status/slot on each eval result.
    this.supabase
      .channel("osc-slot-state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playthrough_slot_state" },
        (payload) => {
          this.handleSlotChange(payload).catch((err) => {
            console.error("[osc-bridge] slot handler crashed:", err);
          });
        }
      )
      .subscribe();
  }

  private async handlePlaythroughUpdate(payload: {
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }): Promise<void> {
    const newRow = payload.new;
    const oldRow = payload.old;
    if (this.config.playthroughIdOverride) {
      if (newRow.id !== this.config.playthroughIdOverride) return;
    } else {
      // Track is_active flips.
      if (newRow.is_active === true) {
        this.activePlaythroughId = newRow.id as string;
      } else if (newRow.id === this.activePlaythroughId && newRow.is_active === false) {
        this.activePlaythroughId = null;
      }
      if (newRow.id !== this.activePlaythroughId) return;
    }

    // current_day_id changed → /show/day/set
    if (newRow.current_day_id !== oldRow.current_day_id && newRow.current_day_id) {
      const day = await this.fetchDayNumber(newRow.current_day_id as string);
      if (day !== null) this.send({ kind: "day_set", day });
    }
    // current_phase changed → /show/phase/set + /show/phase/next
    if (newRow.current_phase !== oldRow.current_phase) {
      this.send({ kind: "phase_next" });
      this.send({
        kind: "phase_set",
        phase: newRow.current_phase as InboundMessage extends never ? never : "top_of_day",
      });
    }
    // phase_started_at flipped from null → emit start
    if (!oldRow.phase_started_at && newRow.phase_started_at) {
      this.send({ kind: "phase_start" });
      this.lastTimerFiredFor = null; // reset for new phase
    }
    // phase_paused_at changed
    const wasPaused = !!oldRow.phase_paused_at;
    const isPaused = !!newRow.phase_paused_at;
    if (!wasPaused && isPaused) this.send({ kind: "phase_pause" });
    if (wasPaused && !isPaused && newRow.phase_started_at) {
      this.send({ kind: "phase_resume" });
    }
  }

  private async handleChoiceChange(payload: {
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
    eventType: string;
  }): Promise<void> {
    if (payload.eventType === "DELETE") return;
    const row = payload.new;
    if (!row) return;
    if (row.playthrough_id !== this.activePlaythroughId) return;

    const contentId = await this.fetchLetterContentId(
      row.inspection_letter_id as string
    );
    if (!contentId) return;

    const state = await this.classifyChoice(row.chosen_action_id as string);
    this.send({ kind: "status_letter", contentId, state });
  }

  private async handleSlotChange(payload: {
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
    eventType: string;
  }): Promise<void> {
    if (payload.eventType === "DELETE") return;
    const row = payload.new;
    if (!row) return;
    if (row.playthrough_id !== this.activePlaythroughId) return;

    const slotId = row.slot_id as number;
    let outcome: "pass" | "fail" | "error" = "error";
    if (row.error_code) outcome = "error";
    else if (row.passed === true) outcome = "pass";
    else if (row.passed === false) outcome = "fail";
    else return; // null passed with no error_code = nothing to mirror
    this.send({ kind: "status_slot", slotId, outcome });
  }

  // -------------------------------------------------------------------------
  // Timer loop — checks for phase_started_at + duration crossings.
  // -------------------------------------------------------------------------

  private async checkTimer(): Promise<void> {
    if (!this.activePlaythroughId) return;
    const pt = row<{
      id: string;
      current_day_id: string | null;
      current_phase: string;
      phase_started_at: string | null;
      phase_paused_at: string | null;
    }>(
      await this.supabase
        .from("playthroughs")
        .select("id, current_day_id, current_phase, phase_started_at, phase_paused_at")
        .eq("id", this.activePlaythroughId)
        .maybeSingle()
    );
    if (!pt?.phase_started_at) return;
    if (pt.phase_paused_at) return;

    const phase = pt.current_phase;
    if (phase !== "sorting" && phase !== "inspection") return;

    const day = pt.current_day_id
      ? row<{
          sort_phase_length_seconds: number | null;
          inspection_phase_length_seconds: number | null;
        }>(
          await this.supabase
            .from("days")
            .select("sort_phase_length_seconds, inspection_phase_length_seconds")
            .eq("id", pt.current_day_id)
            .maybeSingle()
        )
      : null;
    const durationSeconds =
      phase === "sorting"
        ? day?.sort_phase_length_seconds ?? 0
        : day?.inspection_phase_length_seconds ?? 0;
    if (durationSeconds <= 0) return;

    const startedAt = new Date(pt.phase_started_at).getTime();
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < durationSeconds * 1000) return;

    const fireKey = `${pt.id}|${pt.phase_started_at}`;
    if (this.lastTimerFiredFor === fireKey) return;
    this.lastTimerFiredFor = fireKey;
    this.send({ kind: "phase_timer_end" });
  }

  // -------------------------------------------------------------------------
  // Small Supabase reads.
  // -------------------------------------------------------------------------

  private async refreshActivePlaythrough(): Promise<void> {
    if (this.config.playthroughIdOverride) {
      this.activePlaythroughId = this.config.playthroughIdOverride;
      return;
    }
    const r = row<{ id: string }>(
      await this.supabase
        .from("playthroughs")
        .select("id")
        .eq("is_active", true)
        .maybeSingle()
    );
    this.activePlaythroughId = r?.id ?? null;
  }

  private async fetchDayNumber(dayId: string): Promise<number | null> {
    const r = row<{ number: number }>(
      await this.supabase
        .from("days")
        .select("number")
        .eq("id", dayId)
        .maybeSingle()
    );
    return r?.number ?? null;
  }

  private async fetchLetterContentId(letterId: string): Promise<string | null> {
    const r = row<{ content_id: string }>(
      await this.supabase
        .from("inspection_letters_view")
        .select("content_id")
        .eq("id", letterId)
        .maybeSingle()
    );
    return r?.content_id ?? null;
  }

  private async classifyChoice(
    actionId: string
  ): Promise<"delivered" | "flagged" | "choice"> {
    const action = row<{ action_template_id: string | null }>(
      await this.supabase
        .from("actions")
        .select("action_template_id")
        .eq("id", actionId)
        .maybeSingle()
    );
    if (!action?.action_template_id) return "choice";
    const template = row<{ name: string }>(
      await this.supabase
        .from("action_templates")
        .select("name")
        .eq("id", action.action_template_id)
        .maybeSingle()
    );
    const name = (template?.name ?? "").toLowerCase();
    if (name === "deliver") return "delivered";
    if (name === "flag") return "flagged";
    return "choice";
  }
}

function makeUdpPort(opts: {
  localPort: number;
  remoteAddress: string;
  remotePort: number;
}) {
  return new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: opts.localPort,
    remoteAddress: opts.remoteAddress,
    remotePort: opts.remotePort,
    metadata: true,
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const bridge = new Bridge(config);
  await bridge.start();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[osc-bridge] received ${signal}; shutting down`);
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[osc-bridge] fatal:", err);
  process.exit(1);
});
