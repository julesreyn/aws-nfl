import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { motion } from "motion/react";
import { IconSettings as SettingsIcon } from "@/components/ui/icons";
import * as settings from "@/lib/settings";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Hook partagé: s'abonne au store de réglages et déclenche un rerender.
export function useSettings(): settings.Settings {
  const [s, setS] = React.useState<settings.Settings>(() => settings.get());
  React.useEffect(() => settings.subscribe(setS), []);
  return s;
}

function RadioRow({
  value,
  active,
  title,
  hint,
}: {
  value: string;
  active: boolean;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-border/60 bg-card/40 hover:bg-accent/40"
      )}
    >
      <RadioGroup.Item
        value={value}
        className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-muted-foreground/60 outline-none transition-colors data-[state=checked]:border-primary focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <RadioGroup.Indicator asChild>
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="block size-2 rounded-full bg-primary"
          />
        </RadioGroup.Indicator>
      </RadioGroup.Item>
      <span className="min-w-0 leading-tight">
        <b className="block text-sm font-semibold text-foreground">{title}</b>
        <small className="block text-[12px] text-muted-foreground">{hint}</small>
      </span>
    </label>
  );
}

export function SettingsMenu() {
  const s = useSettings();
  const selected = useStore((st) => st.selected);
  const players = useStore((st) => st.session?.players);
  const meta = selected ? players?.[selected] : null;
  const trackedName = meta && meta.ours ? `#${meta.jersey} ${meta.name}` : null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" size="icon" aria-label="Réglages">
          <SettingsIcon size={18} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 outline-none"
          asChild
        >
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass flex flex-col gap-4 rounded-2xl border border-border/70 p-4 elev-pop"
          >
            <div>
              <h3 className="mb-2 font-display text-base font-bold tracking-wide text-foreground">
                Retours aux joueurs
              </h3>
              <RadioGroup.Root
                value={s.level}
                onValueChange={(v) => settings.set({ level: v as settings.FeedbackLevel })}
                className="flex flex-col gap-2"
                aria-label="Niveau de retour"
              >
                {settings.LEVELS.map((l) => (
                  <RadioRow
                    key={l.id}
                    value={l.id}
                    active={s.level === l.id}
                    title={l.label}
                    hint={l.hint}
                  />
                ))}
              </RadioGroup.Root>
            </div>

            <div>
              <h3 className="mb-2 font-display text-base font-bold tracking-wide text-foreground">
                Joueur suivi en direct
              </h3>
              <RadioGroup.Root
                value={s.tracked}
                onValueChange={(v) => settings.set({ tracked: v as settings.TrackedMode })}
                className="flex flex-col gap-2"
                aria-label="Joueur suivi"
              >
                <RadioRow
                  value="auto"
                  active={s.tracked === "auto"}
                  title="Automatique"
                  hint="Le QB en attaque, un joueur de ligne en défense"
                />
                <RadioRow
                  value="selected"
                  active={s.tracked === "selected"}
                  title="Joueur sélectionné"
                  hint={trackedName ?? "Clique un joueur TB sur le terrain"}
                />
              </RadioGroup.Root>
            </div>
          </motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
