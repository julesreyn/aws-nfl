import { useMemo } from "react";
import { motion } from "motion/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useStore } from "@/store";
import type { Grade, Rep, Session } from "@/types";
import { GRADE_LABEL } from "@/lib/tracking";
import { cn } from "@/lib/utils";

const GRADE_BG: Record<Grade, string> = {
  green: "bg-grade-green",
  orange: "bg-grade-orange",
  red: "bg-grade-red",
};

const PILL_STYLE: Record<Grade, string> = {
  green: "bg-grade-green/15 text-grade-green",
  orange: "bg-grade-orange/15 text-grade-orange",
  red: "bg-grade-red/15 text-grade-red",
};

function LegendDot({ grade, label }: { grade: Grade; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("size-2.5 rounded-sm", GRADE_BG[grade])} />
      {label}
    </span>
  );
}

interface RepChipProps {
  rep: Rep;
  drillName: string;
  active: boolean;
  onOpen: (id: string) => void;
}

function RepChip({ rep, drillName, active, onOpen }: RepChipProps) {
  return (
    <Tooltip.Root delayDuration={80}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={() => onOpen(String(rep.id))}
          aria-label={`Essai ${rep.index} · ${rep.label} · ${GRADE_LABEL[rep.grade]}`}
          className={cn(
            "relative min-w-[4px] flex-1 rounded-[3px] transition-all duration-150",
            "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            GRADE_BG[rep.grade],
            active
              ? "opacity-100 ring-2 ring-brand-accent ring-offset-2 ring-offset-background z-10"
              : "opacity-[0.78] hover:opacity-100 hover:scale-y-110"
          )}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={8}
          className="z-[60] max-w-[320px] rounded-lg border border-border/70 bg-popover/95 p-3 backdrop-blur-md elev-pop"
        >
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14 }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tnum",
                  PILL_STYLE[rep.grade]
                )}
              >
                {GRADE_LABEL[rep.grade]}
                {rep.score != null ? ` · ${rep.score}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                Essai {rep.index} · {drillName}
              </span>
            </div>
            <div className="mb-1 font-display text-base font-bold leading-tight">{rep.label}</div>
            {rep.coachSummary && (
              <div className="text-[13px] leading-snug text-foreground/80">{rep.coachSummary}</div>
            )}
          </motion.div>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SessionTimeline() {
  const session = useStore((s) => s.session);
  const rep = useStore((s) => s.rep);
  const openRep = useStore((s) => s.openRep);

  const repsById = useMemo<Record<string, Rep>>(
    () => (session ? Object.fromEntries(session.reps.map((r) => [String(r.id), r])) : {}),
    [session]
  );

  if (!session) return null;

  const activeId = rep != null ? String(rep.id) : null;
  const handleOpen = (id: string) => openRep(id, { autoplay: true });

  return (
    <Tooltip.Provider>
      <div className="border-b border-border/70 bg-card/30 px-4 py-2.5">
        {/* Head */}
        <div className="mb-2 flex items-baseline gap-3.5">
          <span className="font-display text-lg font-bold leading-none">{session.label}</span>
          <span className="tnum text-[13px] text-muted-foreground">
            {session.reps.length} essais · {session.drills.length} drills
          </span>
          <span className="ml-auto hidden items-center gap-3 text-[12.5px] text-muted-foreground md:flex">
            <LegendDot grade="green" label="Validé" />
            <LegendDot grade="orange" label="À revoir" />
            <LegendDot grade="red" label="À corriger" />
          </span>
        </div>

        {/* Track */}
        <div className="flex items-stretch gap-1.5">
          {session.drills.map((d) => {
            const drillActive = rep != null && rep.drillId === d.id;
            const borderColor =
              d.side === "offense" ? "border-t-ours/60" : "border-t-los/60";
            return (
              <div
                key={d.id}
                className="flex min-w-[22px] basis-0 flex-col gap-1"
                style={{ flexGrow: d.repIds.length }}
              >
                <div
                  className={cn(
                    "flex items-baseline gap-1 overflow-hidden whitespace-nowrap border-t-2 pt-1 font-display text-xs font-semibold leading-none",
                    borderColor,
                    drillActive ? "text-foreground" : "text-muted-foreground/70"
                  )}
                  title={d.name}
                >
                  <b className={cn(drillActive ? "text-brand-accent" : "text-muted-foreground")}>
                    D{d.index}
                  </b>
                  <span className="hidden sm:inline">{d.side === "offense" ? "Att." : "Déf."}</span>
                </div>
                <div className="flex h-[26px] gap-0.5">
                  {d.repIds.map((id) => {
                    const r = repsById[String(id)];
                    if (!r) return null;
                    return (
                      <RepChip
                        key={String(id)}
                        rep={r}
                        drillName={d.name}
                        active={activeId === String(id)}
                        onOpen={handleOpen}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export type { Session };
