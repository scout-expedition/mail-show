"use client";

import type { ComponentType } from "react";
import * as LucideModule from "lucide-react";
import * as TablerModule from "@tabler/icons-react";
import type { IconType } from "@/lib/db/enums";

const lucideReg = LucideModule as unknown as Record<
  string,
  ComponentType<{ size?: number }>
>;
const tablerReg = TablerModule as unknown as Record<
  string,
  ComponentType<{ size?: number }>
>;

/** Renders a stored icon value (lucide / tabler / emoji / raw svg). */
export function IconDisplay({
  type,
  value,
  size = 16,
  className,
}: {
  type: IconType;
  value: string | null;
  size?: number;
  className?: string;
}) {
  if (!value) return null;
  if (type === "lucide") {
    const Icon = lucideReg[value];
    if (!Icon) return null;
    return (
      <span className={className}>
        <Icon size={size} />
      </span>
    );
  }
  if (type === "tabler") {
    const Icon = tablerReg[value];
    if (!Icon) return null;
    return (
      <span className={className}>
        <Icon size={size} />
      </span>
    );
  }
  if (type === "emoji") {
    return (
      <span
        className={className}
        style={{ fontSize: `${Math.round(size * 0.95)}px`, lineHeight: 1 }}
      >
        {value}
      </span>
    );
  }
  // svg
  return (
    <span
      className={className}
      style={{ width: size, height: size, display: "inline-flex" }}
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}
