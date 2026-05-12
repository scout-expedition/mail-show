import { ICON_TYPES, type IconType } from "@/lib/db/enums";
import type { UserAvatarData } from "@/components/user-avatar";

/**
 * Pulls our profile fields out of a Supabase user's `user_metadata` blob.
 * Anything missing or malformed becomes null so callers can fall back cleanly.
 */
export function profileFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): UserAvatarData {
  const m = metadata ?? {};
  const rawName = m.display_name;
  const rawIconType = m.avatar_icon_type;
  const rawIconValue = m.avatar_icon_value;
  const rawColor = m.avatar_color_hex;

  const iconType =
    typeof rawIconType === "string" &&
    (ICON_TYPES as readonly string[]).includes(rawIconType)
      ? (rawIconType as IconType)
      : null;
  const iconValue =
    typeof rawIconValue === "string" && rawIconValue.length > 0
      ? rawIconValue
      : null;
  const color =
    typeof rawColor === "string" && /^#[0-9a-fA-F]{6}$/.test(rawColor)
      ? rawColor
      : null;

  return {
    display_name:
      typeof rawName === "string" && rawName.length > 0 ? rawName : null,
    avatar_icon_type: iconType,
    avatar_icon_value: iconValue,
    avatar_color_hex: color,
  };
}
