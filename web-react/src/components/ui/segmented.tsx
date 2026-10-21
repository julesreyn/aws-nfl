import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  layoutId?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  layoutId,
}: SegmentedProps<T>) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "glass inline-flex items-center gap-0.5 rounded-xl border border-border/70 p-1",
        className
      )}
      role="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-lg font-semibold transition-colors cursor-pointer",
              size === "sm" ? "px-3 py-1 text-[13px]" : "px-3.5 py-1.5 text-sm",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={(layoutId ?? id) + "-seg"}
                className="absolute inset-0 rounded-lg bg-primary"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
