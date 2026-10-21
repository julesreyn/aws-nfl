import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/store";
import * as tts from "@/lib/tts";
import { cn } from "@/lib/utils";
import { IconSpeaker, IconRoutes } from "@/components/ui/icons";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Panneau listant les tracés détectés + joueurs mal placés, avec lecture vocale séquencée.
// Visible quand le toggle "Tracés" est actif et qu'on est en 3D.
export function RoutesPanel() {
  const dim = useStore((s) => s.dim);
  const routesOn = useStore((s) => s.toggles.routes);
  const analysis = useStore((s) => s.analysis);
  const setFrame = useStore((s) => s.setFrame);
  const pause = useStore((s) => s.pause);

  const [active, setActive] = useState(-1); // index de l'item en cours de lecture
  const [playing, setPlaying] = useState(false);
  const tokenRef = useRef(0);

  const routes = analysis?.routes ?? [];
  const misplaced = analysis?.misplaced ?? [];
  const items = [
    ...routes.map((r) => ({
      kind: "route" as const,
      key: "r" + r.id,
      title: `${r.jersey != null ? "#" + r.jersey : ""} ${r.name}`.trim(),
      sub: r.route,
      speech: `${r.jersey != null ? "Numéro " + r.jersey : r.name}, ${r.route}.`,
    })),
    ...misplaced.map((m) => ({
      kind: "bad" as const,
      key: "m" + m.id,
      title: `${m.jersey != null ? "#" + m.jersey : ""} ${m.name.split(" ").slice(-1)[0]}`.trim(),
      sub: "Mal placé · " + m.issue,
      speech: `Attention, numéro ${m.jersey ?? ""} ${m.name.split(" ").slice(-1)[0]}, ${m.issue}.`,
    })),
  ];

  // stoppe la lecture quand on change d'essai / on masque le panneau
  useEffect(() => {
    return () => {
      tokenRef.current++;
      tts.stop();
    };
  }, [analysis]);

  if (dim !== "3d" || !routesOn || !items.length) return null;

  const stop = () => {
    tokenRef.current++;
    tts.stop();
    setPlaying(false);
    setActive(-1);
  };

  const preview = async () => {
    if (playing) {
      stop();
      return;
    }
    pause();
    setFrame(0);
    const token = ++tokenRef.current;
    setPlaying(true);
    const titre = routes.length
      ? routes[0].ours
        ? "Tracés de l’attaque."
        : "Tracés adverses."
      : "Placement.";
    await tts.speak(titre, { id: "preview", rate: 1.05 });
    for (let i = 0; i < items.length; i++) {
      if (tokenRef.current !== token) return;
      setActive(i);
      await tts.speak(items[i].speech, { id: "preview", rate: 1.05 });
      await wait(120);
    }
    if (tokenRef.current === token) {
      setActive(-1);
      setPlaying(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="glass pointer-events-auto absolute bottom-2.5 left-2.5 z-[6] w-[260px] overflow-hidden rounded-xl border border-border/70 elev-pop"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="flex items-center gap-1.5 label-xs">
          <IconRoutes size={14} /> Tracés détectés
        </span>
        <button
          type="button"
          onClick={preview}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold hover-smooth",
            playing
              ? "bg-destructive text-white"
              : "bg-primary text-primary-foreground hover:brightness-110"
          )}
        >
          <IconSpeaker size={13} weight="fill" />
          {playing ? "Stop" : "Preview"}
        </button>
      </div>
      <ul className="max-h-[38vh] overflow-y-auto p-1.5">
        {items.map((it, i) => (
          <li
            key={it.key}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover-smooth",
              active === i && "bg-accent",
              it.kind === "bad" && "text-[var(--grade-red)]"
            )}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                it.kind === "bad" ? "bg-g-red" : "bg-g-green"
              )}
            />
            <span className="font-semibold">{it.title}</span>
            <span className="ml-auto truncate text-[11.5px] text-muted-foreground">{it.sub}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
