import { ANIMALS } from "@/lib/animals";
import type { UserAvatarData } from "@/components/user-avatar";

// Vivid, saturated colors — all verified to support white text at ≥4.5:1 contrast.
// Spread across the hue wheel; yellows/yellow-greens omitted (can't achieve white contrast).
const AVATAR_COLORS = [
  "#c62828", // red          ~0°
  "#bf360c", // deep orange  ~14°
  "#2e7d32", // green        ~122°
  "#00695c", // teal         ~171°
  "#006064", // dark cyan    ~184°
  "#01579b", // sky blue     ~207°
  "#1565c0", // blue         ~215°
  "#283593", // indigo       ~232°
  "#4527a0", // deep purple  ~261°
  "#6a1b9a", // purple       ~277°
  "#880e4f", // deep pink    ~328°
  "#ad1457", // hot pink     ~337°
] as const;

function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return (h + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function pickDistinctColor(existingColors: string[]): string {
  const existingHues = existingColors
    .map(hexToHue)
    .filter((h): h is number => h !== null);

  if (existingHues.length === 0) {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  }

  // Pick the palette color whose minimum hue distance to any existing color is greatest.
  let bestColor: string = AVATAR_COLORS[0];
  let bestScore = -1;
  for (const color of AVATAR_COLORS) {
    const hue = hexToHue(color);
    if (hue === null) continue;
    const minDist = Math.min(...existingHues.map((eh) => hueDistance(hue, eh)));
    if (minDist > bestScore) {
      bestScore = minDist;
      bestColor = color;
    }
  }
  return bestColor;
}

function pickUnusedAnimal(existingProfiles: UserAvatarData[]): string {
  const usedSlugs = new Set(
    existingProfiles
      .filter((p) => p.avatar_icon_type === "animal" && p.avatar_icon_value)
      .map((p) => (p.avatar_icon_value ?? "").split(":")[0])
      .filter(Boolean)
  );
  const pool = ANIMALS.filter((a) => !usedSlugs.has(a.slug));
  const source = pool.length > 0 ? pool : ANIMALS;
  return source[Math.floor(Math.random() * source.length)].slug;
}

export function pickRandomAvatar(existingProfiles: UserAvatarData[]): {
  avatar_icon_type: "animal";
  avatar_icon_value: string;
  avatar_color_hex: string;
} {
  const slug = pickUnusedAnimal(existingProfiles);
  const color = pickDistinctColor(
    existingProfiles
      .map((p) => p.avatar_color_hex)
      .filter((c): c is string => c !== null)
  );
  return {
    avatar_icon_type: "animal",
    avatar_icon_value: `${slug}:fill`,
    avatar_color_hex: color,
  };
}
