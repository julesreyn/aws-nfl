import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconCaret, IconPhone } from "@/components/ui/icons";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function PhonePanel() {
  const phone = useStore((s) => s.phone);
  const [open, setOpen] = React.useState(false);

  // S'ouvre automatiquement à la première notification.
  const prevLen = React.useRef(phone.length);
  React.useEffect(() => {
    if (phone.length > prevLen.current) setOpen(true);
    prevLen.current = phone.length;
  }, [phone.length]);

  return (
    <div className="glass shrink-0 overflow-hidden rounded-2xl border border-border/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <IconPhone size={16} />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">Téléphone joueur</span>
        <span className="tnum rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
          {phone.length}
        </span>
        <IconCaret
          size={16}
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="screen"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="relative max-h-72 overflow-y-auto border-t border-border/60 bg-background/60 px-3 pb-3 pt-4">
              <div className="mx-auto mb-3 h-1.5 w-20 rounded-full bg-muted-foreground/30" />
              {phone.length === 0 ? (
                <p className="px-2 py-6 text-center text-[13px] italic text-muted-foreground">
                  Les retours envoyés aux joueurs apparaissent ici. Lance la séance en direct.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  <AnimatePresence initial={false}>
                    {phone.slice(0, 30).map((m, i) => (
                      <motion.li
                        key={`${m.time.getTime()}-${i}`}
                        layout
                        initial={{ opacity: 0, y: -8, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                        className={cn(
                          "rounded-2xl border p-3",
                          m.kind === "brief"
                            ? "border-primary/30 bg-primary/5"
                            : "border-border/60 bg-card/60",
                          i === 0 && "ring-1 ring-primary/40"
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <b className="font-semibold text-foreground">Sideline</b>
                          <span className="tnum">{fmtTime(m.time)}</span>
                        </div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                          {m.kind === "brief" ? "Brief de drill" : "Retour d'essai"} · {m.to}
                        </div>
                        <p className="text-[13px] leading-snug text-foreground/90">{m.text}</p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
