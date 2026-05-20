// Citizen IDs are 4 chars from A-Z (no capital I) + 0-9. The "#" is a pure
// display affordance — `displayCitizenId` prepends it; the column itself
// stores the raw body.
const CITIZEN_ID_ALPHABET = "ABCDEFGHJKLMNOPQRSTUVWXYZ0123456789";
const CITIZEN_ID_CHAR_CLASS = /[^A-HJ-Z0-9]/g;
const CITIZEN_ID_DISPLAY_RE = /^#[A-HJ-Z0-9]{4}$/;
const CITIZEN_ID_BODY_RE = /^[A-HJ-Z0-9]{4}$/;

/** Mask the editable input value. Returns the display form (`#XXXX`) so the
 *  input box continues to render the "#" as the user types. */
export function formatCitizenIdInput(raw: string): string {
  if (raw === "") return "";
  const body = raw
    .toUpperCase()
    .replace(/^#*/, "")
    .replace(CITIZEN_ID_CHAR_CLASS, "")
    .slice(0, 4);
  return body ? `#${body}` : "";
}

/** Validate the display form (`#XXXX`) — what lives in the input box. */
export function isValidCitizenId(id: string): boolean {
  return CITIZEN_ID_DISPLAY_RE.test(id);
}

/** Validate the raw storage form (`XXXX`) — what lives in the DB column. */
export function isValidCitizenIdBody(id: string): boolean {
  return CITIZEN_ID_BODY_RE.test(id);
}

/** Strip "#" to get the raw storage form. Lenient: accepts "#A1B2", "A1B2",
 *  "  #a1b2 ". Returns null on empty input. */
export function toStorageCitizenId(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const body = raw.trim().toUpperCase().replace(/^#+/, "");
  return body || null;
}

/** Prepend "#" for display. Returns "" for null/empty so call sites can use
 *  `{displayCitizenId(x)}` in JSX without conditionals. */
export function displayCitizenId(id: string | null | undefined): string {
  return id ? `#${id}` : "";
}

/**
 * Pick a random citizen ID body (raw, no "#") that is not in `taken`. The
 * `taken` set holds raw bodies (matching the storage form). Call sites that
 * need a display form should wrap the result with `displayCitizenId(...)`.
 * Tries random combinations first; on the extremely rare case of no hit,
 * walks the full alphabet for a guaranteed unique result.
 */
export function generateRandomCitizenId(taken: ReadonlySet<string>): string {
  const pickChar = () =>
    CITIZEN_ID_ALPHABET[Math.floor(Math.random() * CITIZEN_ID_ALPHABET.length)];
  for (let i = 0; i < 100; i++) {
    const candidate = `${pickChar()}${pickChar()}${pickChar()}${pickChar()}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (const a of CITIZEN_ID_ALPHABET) {
    for (const b of CITIZEN_ID_ALPHABET) {
      for (const c of CITIZEN_ID_ALPHABET) {
        for (const d of CITIZEN_ID_ALPHABET) {
          const candidate = `${a}${b}${c}${d}`;
          if (!taken.has(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error("No unused citizen IDs available.");
}
