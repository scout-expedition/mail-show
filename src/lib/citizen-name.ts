import type { Citizen, City, Nation } from "@/lib/db/types";
import { displayCitizenId, isValidCitizenId } from "@/lib/citizen-id";

/**
 * Citizen name + formatted-address helpers.
 *
 * Citizens store discrete name parts (first/middle/last + honorific/title/
 * suffix). These pure functions compose them back into display strings —
 * a plain full name for lists/search, and a multi-line postal address.
 */

/**
 * Split a combined name into first/last. The last whitespace-delimited token
 * becomes `last_name`; the remainder becomes `first_name`. A single-token name
 * goes entirely to `first_name` (`last_name` stays `""`). This mirrors the
 * SQL backfill in migration 0040 so pasted rows split the same way.
 */
export function splitName(raw: string): {
  first_name: string;
  last_name: string;
} {
  const trimmed = raw.trim();
  const lastSpace = trimmed.search(/\s\S*$/);
  if (lastSpace < 0) {
    return { first_name: trimmed, last_name: "" };
  }
  return {
    first_name: trimmed.slice(0, lastSpace).trim(),
    last_name: trimmed.slice(lastSpace + 1).trim(),
  };
}

/** Join non-empty parts with single spaces. */
function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
}

/**
 * Plain "First [Middle] Last" — used for list rows, search, and sort. Empty
 * parts are dropped so a citizen with no last name doesn't render a trailing
 * space. Returns `""` when the citizen has no name yet; callers that need a
 * visible label should fall back (e.g. `citizenFullName(c) || "New citizen"`).
 */
export function citizenFullName(
  c: Pick<Citizen, "first_name" | "middle_name" | "last_name">
): string {
  return joinParts([c.first_name, c.middle_name, c.last_name]);
}

/**
 * The first name as it should appear in a formatted address, per the
 * citizen's `name_display_format`. A null/empty format is the default
 * ("First & Last" — the full first name).
 */
export function displayFirstName(
  c: Pick<Citizen, "first_name" | "name_display_format">
): string {
  const first = (c.first_name ?? "").trim();
  const fmt = c.name_display_format ?? "";
  if (fmt === "last_only") return "";
  if (fmt === "first_initial") {
    return first ? `${first[0].toUpperCase()}.` : "";
  }
  // null / "" / unknown -> "First & Last" default.
  return first;
}

/**
 * Full display name including honorific, job title and suffix —
 * "[honorific] [title] [first] [middle] [last] [suffix]". Used for the
 * citizens list's Name column. Blank parts are dropped.
 */
export function citizenDisplayName(
  c: Pick<
    Citizen,
    | "honorific"
    | "title"
    | "first_name"
    | "middle_name"
    | "last_name"
    | "suffix"
  >
): string {
  return joinParts([
    c.honorific,
    c.title,
    c.first_name,
    c.middle_name,
    c.last_name,
    c.suffix,
  ]);
}

/**
 * Sort key for the citizens list. The job title leads (citizens are grouped
 * by title before name); honorific is ignored entirely. Lower-cased for a
 * case-insensitive compare.
 */
export function citizenSortKey(
  c: Pick<Citizen, "title" | "first_name" | "middle_name" | "last_name">
): string {
  return joinParts([
    c.title,
    c.first_name,
    c.middle_name,
    c.last_name,
  ]).toLowerCase();
}

/** A validation problem with a citizen — `fields` are the inspector field
 *  keys to flag, `message` is the human-readable description. */
export type CitizenIssue = { message: string; fields: string[] };

/**
 * Validate a citizen. `duplicateName` / `duplicateCitizenId` are supplied by
 * the caller (they require knowledge of the other rows). The intrinsic checks
 * — missing name, invalid ID format, missing city/nation — are derived here.
 */
export function citizenIssues(
  c: Pick<
    Citizen,
    "first_name" | "last_name" | "citizen_id" | "city_id" | "nation_id"
  >,
  flags: { duplicateName: boolean; duplicateCitizenId: boolean }
): CitizenIssue[] {
  const issues: CitizenIssue[] = [];
  const hasName = !!c.first_name.trim() || !!c.last_name.trim();
  if (!hasName) {
    issues.push({
      message: "First or last name is required",
      fields: ["first_name", "last_name"],
    });
  } else if (flags.duplicateName) {
    issues.push({
      message: "Another citizen has this name",
      fields: ["first_name", "last_name"],
    });
  }
  const cid = (c.citizen_id ?? "").trim();
  if (!cid) {
    issues.push({
      message: "Citizen ID is required",
      fields: ["citizen_id"],
    });
  } else if (!isValidCitizenId(cid)) {
    issues.push({
      message: "Citizen ID format is invalid",
      fields: ["citizen_id"],
    });
  } else if (flags.duplicateCitizenId) {
    issues.push({
      message: "Another citizen has this ID",
      fields: ["citizen_id"],
    });
  }
  if (!c.city_id) {
    issues.push({ message: "City is not set", fields: ["city_id"] });
  }
  if (!c.nation_id) {
    issues.push({ message: "Nation is not set", fields: ["nation_id"] });
  }
  return issues;
}

export type AddressLookupLevel = 0 | 1 | 2 | 3;

/**
 * Compose a citizen's formatted postal address as an array of lines:
 *
 *   [Honorific] [Title] [First] [Middle] [Last] [Suffix] [#CitizenID]
 *   [Address Line]
 *   [City], [Nation]
 *   [City Code]
 *
 * `lookupLevel` progressively strips the lower lines:
 *   0 Full        — all lines
 *   1 (1 lookup)  — omit nation
 *   2 (2 lookups) — omit nation + city name
 *   3 (3 lookups) — omit nation + city name + city code
 *
 * `hideName` collapses line 1 to just the citizen ID (no honorific/title/
 * name/suffix). Blank parts are always dropped; `citizen_id` is stored raw;
 * `displayCitizenId` prepends the `#`.
 */
export function composeCitizenAddress(
  c: Citizen,
  city: City | null,
  nation: Nation | null,
  opts: { lookupLevel: AddressLookupLevel; hideName: boolean }
): string[] {
  const lines: string[] = [];

  // Line 1 — name + citizen ID.
  if (opts.hideName) {
    if (c.citizen_id) lines.push(displayCitizenId(c.citizen_id));
  } else {
    const nameLine = joinParts([
      c.honorific,
      c.title,
      displayFirstName(c),
      c.middle_name,
      c.last_name,
      c.suffix,
      displayCitizenId(c.citizen_id),
    ]);
    if (nameLine) lines.push(nameLine);
  }

  // Line 2 — address line / organization.
  const addressLine = (c.address_line ?? "").trim();
  if (addressLine) lines.push(addressLine);

  // Line 3 — city + nation. Level 0 shows both; level 1 city only;
  // levels 2-3 omit the line entirely.
  if (opts.lookupLevel <= 1) {
    const cityNation = [
      city?.name?.trim() ?? "",
      opts.lookupLevel === 0 ? nation?.name?.trim() ?? "" : "",
    ].filter((p) => p.length > 0);
    if (cityNation.length > 0) lines.push(cityNation.join(", "));
  }

  // Line 4 — city code. Shown for levels 0-2, omitted at level 3.
  if (opts.lookupLevel <= 2) {
    const code = (city?.code ?? "").trim();
    if (code) lines.push(code);
  }

  return lines;
}
