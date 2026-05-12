"use client";

import { IconDisplay } from "@/components/icon-display";
import { cn } from "@/lib/utils";
import type { IconType } from "@/lib/db/enums";

export type UserAvatarData = {
  display_name: string | null;
  avatar_icon_type: IconType | null;
  avatar_icon_value: string | null;
  avatar_color_hex: string | null;
};

function readableOn(hex: string): string {
  const full = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

function fallbackInitial(name: string | null, email: string | null): string {
  const src = (name?.trim() || email?.trim() || "?")[0];
  return src.toUpperCase();
}

export function UserAvatar({
  user,
  email,
  size = 28,
  className,
}: {
  user: UserAvatarData | null;
  /** Used to derive a fallback initial when there's no icon and no display name. */
  email?: string | null;
  size?: number;
  className?: string;
}) {
  const color = user?.avatar_color_hex ?? "#3f3f46";
  const iconType = user?.avatar_icon_type ?? null;
  const iconValue = user?.avatar_icon_value ?? null;
  const fg = readableOn(color);
  const hasIcon = !!(iconType && iconValue);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border/40",
        className
      )}
      style={{
        background: color,
        color: fg,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden
    >
      {hasIcon ? (
        <IconDisplay
          type={iconType}
          value={iconValue}
          size={Math.round(size * 0.55)}
        />
      ) : (
        <span className="font-mono font-semibold">
          {fallbackInitial(user?.display_name ?? null, email ?? null)}
        </span>
      )}
    </span>
  );
}
