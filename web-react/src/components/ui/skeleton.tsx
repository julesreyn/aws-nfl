import { cn } from "@/lib/utils";

/** Bloc skeleton animé (shimmer) pour les états de chargement. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/70",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.4s_infinite]",
        "after:bg-gradient-to-r after:from-transparent after:via-white/8 after:to-transparent",
        className
      )}
    />
  );
}
