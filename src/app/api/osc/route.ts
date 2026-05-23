/**
 * Inbound OSC bridge endpoint.
 *
 * The OSC sidecar (scripts/osc-bridge.ts) parses raw OSC packets, validates
 * them against the address map, and forwards each inbound message here.
 * This route is the *only* DB-mutation surface for the bridge — the sidecar
 * itself is a UDP/Realtime translator and never writes to Supabase.
 *
 * Auth: header secret (OSC_BRIDGE_SECRET) over localhost. Sufficient for the
 * show-floor LAN topology described in docs/plans/active/osc-mvp-plan.md.
 * See the "Security upgrade path" section there before exposing this route
 * over the public internet.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  InboundMessageSchema,
  type InboundMessage,
  type OutboundMessage,
  type OscPhase,
} from "@/lib/osc/address-map";
import {
  applySlotObservation,
  type SlotObservationResult,
} from "@/lib/sorting/mutations";
import {
  deliverLetter,
  flagLetter,
} from "@/lib/playthroughs/mutations";

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

/**
 * Body the sidecar POSTs for each inbound OSC event.
 *
 * `playthroughId` defaults to the playthrough flagged `is_active = true`
 * server-side, matching the "default to active show" rule from the plan.
 */
const RequestBodySchema = z.object({
  playthroughId: z.string().uuid().optional(),
  message: InboundMessageSchema,
});

type RequestBody = z.infer<typeof RequestBodySchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Discriminated response. `mirror` (if present) is the OutboundMessage the
 * sidecar should serialize + send back to QLab. `result` is freeform helper
 * output for logging / diagnostic purposes.
 */
interface OscResponse {
  ok: true;
  mirror: OutboundMessage | null;
  result: unknown;
}

interface OscErrorResponse {
  ok: false;
  error: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Auth — constant-time secret compare
// ---------------------------------------------------------------------------

function authorized(req: Request): boolean {
  const configured = process.env.OSC_BRIDGE_SECRET;
  if (!configured || configured.length === 0) return false;

  const provided = req.headers.get("x-osc-bridge-secret") ?? "";
  // timingSafeEqual requires equal-length buffers; pad shorter input.
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse<OscResponse | OscErrorResponse>> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    const json = await req.json();
    const parsed = RequestBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid json", details: String(err) },
      { status: 400 }
    );
  }

  const client = createSupabaseServiceClient();

  const playthroughId = body.playthroughId ?? (await resolveActivePlaythroughId(client));
  if (!playthroughId) {
    return NextResponse.json(
      { ok: false, error: "no active playthrough; set playthroughs.is_active or pass playthroughId" },
      { status: 409 }
    );
  }

  try {
    const response = await dispatch(client, playthroughId, body.message);
    // Surfaces that read from the mutated tables.
    revalidatePath("/playthroughs", "layout");
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  client: ReturnType<typeof createSupabaseServiceClient>,
  playthroughId: string,
  message: InboundMessage
): Promise<OscResponse> {
  switch (message.kind) {
    // -------------------------------------------------------------------
    // QLab status queries — read-only.
    // -------------------------------------------------------------------
    case "status_day_get": {
      const day = await fetchCurrentDayNumber(client, playthroughId);
      return {
        ok: true,
        mirror: { kind: "status_day", day: day ?? 0 },
        result: { day },
      };
    }

    case "status_phase_get": {
      const phase = await fetchCurrentPhase(client, playthroughId);
      return {
        ok: true,
        mirror: { kind: "status_phase", phase },
        result: { phase },
      };
    }

    case "status_timer_get": {
      const timer = await fetchTimerState(client, playthroughId);
      return {
        ok: true,
        mirror: {
          kind: "status_timer",
          remainingMs: timer.remainingMs,
          running: timer.running,
        },
        result: timer,
      };
    }

    case "status_letter_get": {
      // Letter status is derived from playthrough_action_choices; a future
      // helper can resolve this. For the prototype we acknowledge the
      // query without an authoritative state — return "choice" if the row
      // exists, otherwise nothing.
      const state = await fetchLetterState(client, playthroughId, message.contentId);
      return {
        ok: true,
        mirror: state
          ? { kind: "status_letter", contentId: message.contentId, state }
          : null,
        result: { contentId: message.contentId, state },
      };
    }

    // -------------------------------------------------------------------
    // RFID slot — context-sensitive on phase + slot role.
    // -------------------------------------------------------------------
    case "rfid_slot": {
      const phase = await fetchCurrentPhase(client, playthroughId);
      const role = await fetchSlotRole(client, message.slotId);

      // Record the raw observation in playthrough_slot_state regardless
      // of phase — gives the sorting UI live mirror of slot contents and
      // also handles the wrong_phase case cleanly.
      const observation = await applySlotObservation(client, {
        playthroughId,
        slotId: message.slotId,
        payload: message.payload,
      });

      // Inspection-phase logic: also fire the action choice.
      if (phase === "inspection" && role && observation.physicalLetterId) {
        const letterId = await resolveInspectionLetterId(
          client,
          observation.physicalLetterId
        );
        if (letterId) {
          if (role === "report") {
            await flagLetter(client, {
              playthroughId,
              inspectionLetterId: letterId,
            });
            return {
              ok: true,
              mirror: {
                kind: "status_letter",
                contentId: await resolveLetterContentId(client, letterId),
                state: "flagged",
              },
              result: { ...observation, action: "flag" },
            };
          }
          if (role === "sorting") {
            await deliverLetter(client, {
              playthroughId,
              inspectionLetterId: letterId,
            });
            return {
              ok: true,
              mirror: {
                kind: "status_letter",
                contentId: await resolveLetterContentId(client, letterId),
                state: "delivered",
              },
              result: { ...observation, action: "deliver" },
            };
          }
        }
      }

      // Sorting-phase or unhandled: mirror the slot eval outcome.
      return {
        ok: true,
        mirror: mirrorForObservation(message.slotId, observation),
        result: observation,
      };
    }

    case "rfid_slot_clear": {
      const { error } = await client
        .from("playthrough_slot_state")
        .delete()
        .eq("playthrough_id", playthroughId)
        .eq("slot_id", message.slotId);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        mirror: null,
        result: { slotId: message.slotId, cleared: true },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (route-local — small, route-only reads).
// ---------------------------------------------------------------------------

async function resolveActivePlaythroughId(
  client: ReturnType<typeof createSupabaseServiceClient>
): Promise<string | null> {
  const { data } = await client
    .from("playthroughs")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchCurrentDayNumber(
  client: ReturnType<typeof createSupabaseServiceClient>,
  playthroughId: string
): Promise<number | null> {
  const { data: pt } = await client
    .from("playthroughs")
    .select("current_day_id")
    .eq("id", playthroughId)
    .maybeSingle();
  if (!pt?.current_day_id) return null;
  const { data: day } = await client
    .from("days")
    .select("number")
    .eq("id", pt.current_day_id as string)
    .maybeSingle();
  return (day?.number as number | undefined) ?? null;
}

async function fetchCurrentPhase(
  client: ReturnType<typeof createSupabaseServiceClient>,
  playthroughId: string
): Promise<OscPhase> {
  const { data } = await client
    .from("playthroughs")
    .select("current_phase")
    .eq("id", playthroughId)
    .maybeSingle();
  return ((data?.current_phase as OscPhase | undefined) ?? "top_of_day");
}

interface TimerState {
  remainingMs: number;
  running: boolean;
}

async function fetchTimerState(
  client: ReturnType<typeof createSupabaseServiceClient>,
  playthroughId: string
): Promise<TimerState> {
  const { data: pt } = await client
    .from("playthroughs")
    .select("current_day_id, current_phase, phase_started_at, phase_paused_at")
    .eq("id", playthroughId)
    .maybeSingle();
  if (!pt?.phase_started_at) {
    return { remainingMs: 0, running: false };
  }
  const { data: day } = pt.current_day_id
    ? await client
        .from("days")
        .select("sort_phase_length_seconds, inspection_phase_length_seconds")
        .eq("id", pt.current_day_id as string)
        .maybeSingle()
    : { data: null };

  const durationSeconds =
    pt.current_phase === "sorting"
      ? (day?.sort_phase_length_seconds as number | null) ?? 0
      : pt.current_phase === "inspection"
        ? (day?.inspection_phase_length_seconds as number | null) ?? 0
        : 0;

  const startedAt = new Date(pt.phase_started_at as string).getTime();
  const reference = pt.phase_paused_at
    ? new Date(pt.phase_paused_at as string).getTime()
    : Date.now();
  const elapsedMs = reference - startedAt;
  const remainingMs = Math.max(0, durationSeconds * 1000 - elapsedMs);
  return { remainingMs, running: !pt.phase_paused_at };
}

async function fetchLetterState(
  client: ReturnType<typeof createSupabaseServiceClient>,
  playthroughId: string,
  contentId: string
): Promise<"delivered" | "flagged" | "choice" | null> {
  // Resolve content_id → inspection_letter.id via the view.
  const { data: letter } = await client
    .from("inspection_letters_view")
    .select("id")
    .eq("content_id", contentId)
    .maybeSingle();
  if (!letter?.id) return null;

  const { data: choice } = await client
    .from("playthrough_action_choices")
    .select("chosen_action_id")
    .eq("playthrough_id", playthroughId)
    .eq("inspection_letter_id", letter.id as string)
    .maybeSingle();
  if (!choice) return null;

  // Resolve to template name to distinguish flagged vs delivered.
  const { data: action } = await client
    .from("actions")
    .select("action_template_id")
    .eq("id", choice.chosen_action_id as string)
    .maybeSingle();
  if (!action?.action_template_id) return "choice";

  const { data: template } = await client
    .from("action_templates")
    .select("name")
    .eq("id", action.action_template_id as string)
    .maybeSingle();
  const name = ((template?.name as string | undefined) ?? "").toLowerCase();
  if (name === "deliver") return "delivered";
  if (name === "flag") return "flagged";
  return "choice";
}

async function fetchSlotRole(
  client: ReturnType<typeof createSupabaseServiceClient>,
  slotId: number
): Promise<"report" | "sorting" | null> {
  const { data } = await client
    .from("slots")
    .select("role")
    .eq("slot_id", slotId)
    .maybeSingle();
  return (data?.role as "report" | "sorting" | undefined) ?? null;
}

async function resolveInspectionLetterId(
  client: ReturnType<typeof createSupabaseServiceClient>,
  physicalLetterId: string
): Promise<string | null> {
  const { data } = await client
    .from("physical_letters")
    .select("content_ref_type, content_ref_id")
    .eq("id", physicalLetterId)
    .maybeSingle();
  if (data?.content_ref_type !== "inspection") return null;
  return (data?.content_ref_id as string | undefined) ?? null;
}

async function resolveLetterContentId(
  client: ReturnType<typeof createSupabaseServiceClient>,
  inspectionLetterId: string
): Promise<string> {
  const { data } = await client
    .from("inspection_letters_view")
    .select("content_id")
    .eq("id", inspectionLetterId)
    .maybeSingle();
  return (data?.content_id as string | undefined) ?? "";
}

function mirrorForObservation(
  slotId: number,
  observation: SlotObservationResult
): OutboundMessage | null {
  if (observation.errorCode) {
    return { kind: "status_slot", slotId, outcome: "error" };
  }
  if (observation.passed === true) {
    return { kind: "status_slot", slotId, outcome: "pass" };
  }
  if (observation.passed === false) {
    return { kind: "status_slot", slotId, outcome: "fail" };
  }
  return null;
}
