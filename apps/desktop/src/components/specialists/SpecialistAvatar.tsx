import { cn } from "@/lib/cn";
import { specialistInitial } from "@/lib/specialists";

/** A specialist's tile: its initial, in its color over a light tint of the
 *  same color. No color: the plain ink tile every other row on the page uses. */
export function SpecialistAvatar({
  id,
  color,
  large = false,
}: {
  id: string;
  color: string | null;
  large?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border font-medium",
        large ? "h-12 w-12 text-[18px]" : "h-11 w-11 text-[16px]",
        color ? "border-transparent" : "border-border bg-surface text-text",
      )}
      // 0x24 ≈ 14% alpha: a tint that reads on both themes.
      style={color ? { color, backgroundColor: `${color}24` } : undefined}
    >
      {specialistInitial(id)}
    </div>
  );
}
