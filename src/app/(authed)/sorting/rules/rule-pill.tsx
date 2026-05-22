import { normalizeHex } from "@/lib/color";
import { cn } from "@/lib/utils";

/** WCAG-lite luminance check — picks black or white text for any background
 *  hex. Mirrors the helper in `avatar-stack.tsx` so rule pills and presence
 *  avatars share the same contrast rule. */
function readableOn(hex: string): string {
  const full = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.65 ? "#0b0d10" : "#ffffff";
}

/**
 * The sorting-rule glyph: a diamond carrying the rule letter. Used in the
 * rules list rows and the inspection panel header. When `color` is set, the
 * diamond fills with that color (the SVG fill is `currentColor`) and the
 * letter switches to black or white depending on which contrasts better.
 */
export function RulePill({
  letter,
  color,
  className,
}: {
  letter: string;
  color?: string | null;
  className?: string;
}) {
  const effective = color ? normalizeHex(color) : null;
  const letterColor = effective ? readableOn(effective) : undefined;
  return (
    <span
      className={cn(
        "relative flex h-6 w-6 shrink-0 items-center justify-center font-mono text-xs",
        className
      )}
      aria-label={`Rule ${letter}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "absolute inset-0 h-full w-full",
          effective ? "" : "text-muted-foreground"
        )}
        style={effective ? { color: effective } : undefined}
        fill="currentColor"
        aria-hidden
      >
        <polygon points="12,2 22,12 12,22 2,12" />
      </svg>
      <span
        className={cn(
          "relative font-black leading-none",
          letterColor ? "" : "text-background"
        )}
        style={letterColor ? { color: letterColor } : undefined}
      >
        {letter}
      </span>
    </span>
  );
}
