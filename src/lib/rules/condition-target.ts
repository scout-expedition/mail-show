import type { RuleTarget } from "@/lib/db/enums";

export type TargetSubject = "sender" | "recipient" | "day" | "counterfeit";

export type TargetField =
  | "first_name"
  | "middle_name"
  | "last_name"
  | "citizen_id"
  | "city_name"
  | "city_code"
  | "nation";

export interface CompositeTarget {
  subject: TargetSubject;
  field: TargetField | null;
}

/**
 * Decodes a flat RuleTarget enum value into the 3-segment composite UI model.
 *
 * Legacy whole-name targets (`sender_name` / `recipient_name`) are decoded to
 * `field: "first_name"` for best-effort display. Re-encoding via `encodeTarget`
 * will produce the modern `*_first_name` target.
 */
export function decodeTarget(t: RuleTarget): CompositeTarget {
  if (t === "is_counterfeit") return { subject: "counterfeit", field: null };
  if (t === "current_day_of_week") return { subject: "day", field: null };

  // Legacy whole-name → first_name (best-effort display)
  if (t === "sender_name") return { subject: "sender", field: "first_name" };
  if (t === "recipient_name")
    return { subject: "recipient", field: "first_name" };

  // sender_* and recipient_* fields
  const senderPrefix = "sender_";
  const recipientPrefix = "recipient_";

  if (t.startsWith(senderPrefix)) {
    const field = t.slice(senderPrefix.length) as TargetField;
    return { subject: "sender", field };
  }

  if (t.startsWith(recipientPrefix)) {
    const field = t.slice(recipientPrefix.length) as TargetField;
    return { subject: "recipient", field };
  }

  // Fallback (should never be reached for valid RuleTarget values)
  return { subject: "sender", field: "first_name" };
}

/**
 * Encodes a composite UI model back to a flat RuleTarget enum value.
 *
 * This is a total function — every CompositeTarget produces a valid RuleTarget.
 * When `field` is null for a sender/recipient subject, defaults to `"first_name"`.
 */
export function encodeTarget(c: CompositeTarget): RuleTarget {
  if (c.subject === "counterfeit") return "is_counterfeit";
  if (c.subject === "day") return "current_day_of_week";

  const field: TargetField = c.field ?? "first_name";

  if (c.subject === "sender") {
    return `sender_${field}` as RuleTarget;
  }

  // recipient
  return `recipient_${field}` as RuleTarget;
}

export const SUBJECT_OPTIONS: { value: TargetSubject; label: string }[] = [
  { value: "sender", label: "Sender" },
  { value: "recipient", label: "Recipient" },
  { value: "day", label: "Current day of week" },
  { value: "counterfeit", label: "Counterfeit stamp" },
];

export const FIELD_OPTIONS: { value: TargetField; label: string }[] = [
  { value: "first_name", label: "First Name" },
  { value: "middle_name", label: "Middle Name" },
  { value: "last_name", label: "Last Name" },
  { value: "citizen_id", label: "Citizen ID" },
  { value: "city_name", label: "City Name" },
  { value: "city_code", label: "City Code" },
  { value: "nation", label: "Nation" },
];
