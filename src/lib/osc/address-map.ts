/**
 * OSC Address Map — pure module (no Supabase, no Node sockets).
 *
 * Imported by the sidecar (scripts/osc-bridge.ts), the inbound API route
 * (src/app/api/osc/route.ts), and unit tests. The stable boundary that
 * survives the Phase 4 Electron migration.
 *
 * Content IDs like "L-W2/b3" intentionally live in OSC *arguments*, never
 * in the path, to avoid collision with the OSC path separator "/".
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const PHASES = [
  "top_of_day",
  "sorting",
  "inspection",
  "end_of_day",
] as const;

export type OscPhase = (typeof PHASES)[number];

/** Raw OSC packet — one address + ordered argument list. */
export interface OscPacket {
  address: string;
  args: Array<string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Outbound — every message the sidecar can SEND to QLab.
// ---------------------------------------------------------------------------

export type OutboundMessage =
  | { kind: "day_set"; day: number }
  | { kind: "phase_set"; phase: OscPhase }
  | { kind: "phase_start" }
  | { kind: "phase_pause" }
  | { kind: "phase_resume" }
  | { kind: "phase_next" }
  | { kind: "phase_timer_end" }
  | { kind: "report_segment"; reportId: string }
  | { kind: "status_day"; day: number }
  | { kind: "status_phase"; phase: OscPhase }
  | { kind: "status_timer"; remainingMs: number; running: boolean }
  | {
      kind: "status_letter";
      contentId: string;
      state: "delivered" | "flagged" | "choice";
    }
  | { kind: "status_slot"; slotId: number; outcome: "pass" | "fail" | "error" };

/**
 * Serialize an outbound message to a raw OSC packet.
 * Produces stable, lowercase paths exactly as specified in the address map.
 */
export function serialize(msg: OutboundMessage): OscPacket {
  switch (msg.kind) {
    case "day_set":
      return { address: "/show/day/set", args: [msg.day] };

    case "phase_set":
      return { address: "/show/phase/set", args: [msg.phase] };

    case "phase_start":
      return { address: "/show/phase/start", args: [] };

    case "phase_pause":
      return { address: "/show/phase/pause", args: [] };

    case "phase_resume":
      return { address: "/show/phase/resume", args: [] };

    case "phase_next":
      return { address: "/show/phase/next", args: [] };

    case "phase_timer_end":
      return { address: "/show/phase/timer/end", args: [] };

    case "report_segment":
      return { address: "/show/report/segment", args: [msg.reportId] };

    case "status_day":
      return { address: "/show/status/day", args: [msg.day] };

    case "status_phase":
      return { address: "/show/status/phase", args: [msg.phase] };

    case "status_timer":
      return {
        address: "/show/status/timer",
        args: [msg.remainingMs, msg.running],
      };

    case "status_letter":
      return {
        address: "/show/status/letter",
        args: [msg.contentId, msg.state],
      };

    case "status_slot":
      return {
        address: "/show/status/slot",
        args: [msg.slotId, msg.outcome],
      };
  }
}

// ---------------------------------------------------------------------------
// Inbound — every message the sidecar might RECEIVE.
// ---------------------------------------------------------------------------

export type InboundMessage =
  | { kind: "status_day_get" }
  | { kind: "status_phase_get" }
  | { kind: "status_timer_get" }
  | { kind: "status_letter_get"; contentId: string }
  | { kind: "rfid_slot"; slotId: number; payload: string }
  | { kind: "rfid_slot_clear"; slotId: number };

// ---------------------------------------------------------------------------
// Zod schemas — exported for the API route to reuse.
// ---------------------------------------------------------------------------

/** Accepts a non-negative integer OSC argument (number, no fractional part). */
const SlotId = z.int().nonnegative();

/**
 * RFID payload: exactly "SL" followed by 6 digits, e.g. SL000042.
 * Validated as a string arg since OSC has no dedicated type for it.
 */
const RfidPayload = z.string().regex(/^SL\d{6}$/, {
  message: 'RFID payload must match SL followed by exactly 6 digits (e.g. "SL000042")',
});

/**
 * Content ID: accepts anything matching the loose pattern used across the
 * domain (L-W2/b3, R-W2/ii, S2-09, …). The resolver downstream rejects
 * unknown IDs; don't over-constrain here.
 */
const ContentId = z
  .string()
  .regex(/^[A-Z]+-?[A-Za-z0-9]+\/[A-Za-z0-9]+(\/\d+)?$/, {
    message: "contentId does not match expected format (e.g. L-W2/b3, R-W2/ii)",
  });

/** Discriminated-union schema for every inbound packet. */
export const InboundMessageSchema: z.ZodType<InboundMessage> =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("status_day_get") }),
    z.object({ kind: z.literal("status_phase_get") }),
    z.object({ kind: z.literal("status_timer_get") }),
    z.object({
      kind: z.literal("status_letter_get"),
      contentId: ContentId,
    }),
    z.object({
      kind: z.literal("rfid_slot"),
      slotId: SlotId,
      payload: RfidPayload,
    }),
    z.object({
      kind: z.literal("rfid_slot_clear"),
      slotId: SlotId,
    }),
  ]);

// ---------------------------------------------------------------------------
// Address → parser map (used by parse / tryParse)
// ---------------------------------------------------------------------------

/**
 * Lift a raw OscPacket's args into a structured object ready for zod
 * validation, keyed by OSC address string.
 *
 * Returns null for unknown addresses so parse/tryParse can give a clean error.
 */
function liftPacket(packet: OscPacket): Record<string, unknown> | null {
  const { address, args } = packet;

  switch (address) {
    case "/show/status/day/get":
      return { kind: "status_day_get" };

    case "/show/status/phase/get":
      return { kind: "status_phase_get" };

    case "/show/status/timer/get":
      return { kind: "status_timer_get" };

    case "/show/status/letter/get":
      return { kind: "status_letter_get", contentId: args[0] };

    case "/rfid/slot":
      return { kind: "rfid_slot", slotId: args[0], payload: args[1] };

    case "/rfid/slot/clear":
      return { kind: "rfid_slot_clear", slotId: args[0] };

    default:
      return null;
  }
}

/**
 * Parse an inbound OSC packet into a typed InboundMessage.
 * Throws a descriptive Error for unknown addresses or malformed args.
 */
export function parse(packet: OscPacket): InboundMessage {
  const lifted = liftPacket(packet);
  if (lifted === null) {
    throw new Error(
      `Unknown OSC address: "${packet.address}". ` +
        `Known inbound addresses: /show/status/day/get, /show/status/phase/get, ` +
        `/show/status/timer/get, /show/status/letter/get, /rfid/slot, /rfid/slot/clear`
    );
  }

  const result = InboundMessageSchema.safeParse(lifted);
  if (!result.success) {
    throw new Error(
      `Malformed OSC packet at "${packet.address}": ${JSON.stringify(result.error.issues)}`
    );
  }

  return result.data;
}

/**
 * Safe variant — returns null instead of throwing for unknown or malformed
 * packets. Useful in hot paths where the caller wants to silently skip noise.
 */
export function tryParse(packet: OscPacket): InboundMessage | null {
  try {
    return parse(packet);
  } catch {
    return null;
  }
}
