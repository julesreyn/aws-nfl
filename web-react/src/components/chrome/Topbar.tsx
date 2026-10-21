import { motion } from "motion/react";
import type * as React from "react";
import { Settings2 } from "lucide-react";
import { useStore } from "@/store";
import type { ViewName } from "@/types";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onToggleLive: () => void;
  onOpenSettings?: () => void;
  settingsSlot?: React.ReactNode;
}

const VIEW_OPTIONS: { value: ViewName; label: string }[] = [
  { value: "seance", label: "Séance" },
  { value: "rapports", label: "Rapports" },
];

/** Logo Sideline — three "line to gain" bars echoing the original brand mark. */
function BrandMark() {
  return (
    <span className="flex h-6 items-stretch gap-[3px]" aria-hidden="true">
      <i className="w-[6px] rounded-sm bg-brand-accent" />
      <i className="w-[3px] rounded-sm bg-foreground/45" />
      <i className="w-[3px] rounded-sm bg-foreground/45" />
    </span>
  );
}

export function Topbar({ onToggleLive, onOpenSettings, settingsSlot }: TopbarProps) {
  const sessions = useStore((s) => s.sessions);
  const session = useStore((s) => s.session);
  const view = useStore((s) => s.view);
  const live = useStore((s) => s.live);
  const loadSession = useStore((s) => s.loadSession);
  const setView = useStore((s) => s.setView);

  const isLive = live != null;

  return (
    <header className="glass relative z-20 flex h-[58px] items-center gap-4 border-b border-border/70 px-4 md:gap-5 md:px-5">
      {/* Brand */}
      <div
        className="flex items-center gap-2.5"
        title="Sideline — retour individuel après chaque essai"
      >
        <BrandMark />
        <span className="font-display text-2xl font-extrabold leading-none tracking-tight">
          Sideline
        </span>
      </div>

      {/* Session picker */}
      <label className="relative">
        <span className="sr-only">Séance</span>
        <select
          aria-label="Choisir la séance"
          value={session?.id ?? ""}
          onChange={(e) => loadSession(e.target.value)}
          className={cn(
            "glass h-9 min-w-[200px] appearance-none rounded-xl border border-border/70 bg-card/60 py-1.5 pl-3.5 pr-9",
            "font-semibold text-foreground outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring/60 hover:border-border"
          )}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id} className="bg-popover text-popover-foreground">
              {s.label} · {s.date}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </label>

      {/* View switch */}
      <Segmented<ViewName>
        options={VIEW_OPTIONS}
        value={view}
        onChange={setView}
        size="sm"
        layoutId="topbar-view"
      />

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2.5">
        <Button
          variant={isLive ? "live" : "default"}
          size="pill"
          onClick={onToggleLive}
          title="Enchaîne les essais du drill et envoie les retours aux joueurs"
          className="font-display text-base tracking-wide"
        >
          <motion.span
            aria-hidden="true"
            className={cn(
              "size-2.5 rounded-full",
              isLive ? "bg-white" : "bg-ours ring-2 ring-ours/25"
            )}
            animate={isLive ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
            transition={isLive ? { duration: 1.2, repeat: Infinity } : { duration: 0.2 }}
          />
          {isLive ? "Arrêter le direct" : "Séance en direct"}
        </Button>

        {settingsSlot ?? (
          <Button
            variant="outline"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Réglages des retours"
            title="Réglages des retours"
            className="rounded-xl"
          >
            <Settings2 />
          </Button>
        )}
      </div>
    </header>
  );
}
