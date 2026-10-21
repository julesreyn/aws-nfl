import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: Icon;
  title: string;
  hint?: ReactNode;
  className?: string;
}

/** État vide soigné : pastille d'icône + titre + aide. */
export function EmptyState({ icon: Icon, title, hint, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/60 text-muted-foreground">
        <Icon size={22} weight="duotone" />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-bold tracking-wide text-foreground">{title}</p>
        {hint && <p className="mx-auto max-w-[32ch] text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
