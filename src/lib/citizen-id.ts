// Citizen IDs are "#" followed by 4 chars from A-Z (no capital I) + 0-9.
const CITIZEN_ID_ALPHABET = "ABCDEFGHJKLMNOPQRSTUVWXYZ0123456789";
const CITIZEN_ID_CHAR_CLASS = /[^A-HJ-Z0-9]/g;
const CITIZEN_ID_RE = /^#[A-HJ-Z0-9]{4}$/;

export function formatCitizenIdInput(raw: string): string {
  if (raw === "") return "";
  const body = raw
    .toUpperCase()
    .replace(/^#*/, "")
    .replace(CITIZEN_ID_CHAR_CLASS, "")
    .slice(0, 4);
  return body ? `#${body}` : "";
}

export function isValidCitizenId(id: string): boolean {
  return CITIZEN_ID_RE.test(id);
}

/**
 * Pick a random citizen ID that is not present in `taken`. Tries random
 * combinations first; on the extremely rare case of no hit, walks the full
 * alphabet for a guaranteed unique result.
 */
export function generateRandomCitizenId(taken: ReadonlySet<string>): string {
  const pickChar = () =>
    CITIZEN_ID_ALPHABET[Math.floor(Math.random() * CITIZEN_ID_ALPHABET.length)];
  for (let i = 0; i < 100; i++) {
    const candidate = `#${pickChar()}${pickChar()}${pickChar()}${pickChar()}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (const a of CITIZEN_ID_ALPHABET) {
    for (const b of CITIZEN_ID_ALPHABET) {
      for (const c of CITIZEN_ID_ALPHABET) {
        for (const d of CITIZEN_ID_ALPHABET) {
          const candidate = `#${a}${b}${c}${d}`;
          if (!taken.has(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error("No unused citizen IDs available.");
}
