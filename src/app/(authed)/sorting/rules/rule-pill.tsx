import { cn } from "@/lib/utils";

/**
 * The sorting-rule glyph: a diamond carrying the rule letter. Used in the
 * rules list rows and the inspection panel header.
 */
export function RulePill({
  letter,
  className,
}: {
  letter: string;
  className?: string;
}) {
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
        className="absolute inset-0 h-full w-full text-muted-foreground"
        fill="currentColor"
        aria-hidden
      >
        <polygon points="12,2 22,12 12,22 2,12" />
      </svg>
      <span className="relative font-bold leading-none text-background">
        {letter}
      </span>
    </span>
  );
}
