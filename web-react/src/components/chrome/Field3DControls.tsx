
import { AnimatePresence, motion } from "motion/react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
import { useStore } from "@/store";
import type { CameraPreset, ViewToggles } from "@/types";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  IconFree,
  IconDrone,
  IconMadden,
  IconFootball,
  IconRoutes,
  IconBubbles,
  IconPlacement,
  IconGhost,
} from "@/components/ui/icons";

type IconType = PhosphorIcon;

const CAMERA_OPTIONS: { value: CameraPreset; label: string; Icon: IconType; title?: string }[] = [
  { value: "free", label: "Libre", Icon: IconFree, title: "Contrôle libre : glisser pour tourner/incliner, molette pour zoomer, clic droit pour déplacer" },
  { value: "top", label: "Drone", Icon: IconDrone, title: "Vue du dessus (drone)" },
  { value: "madden", label: "Madden", Icon: IconMadden, title: "Caméra diffusion" },
  { value: "qb", label: "QB", Icon: IconFootball, title: "Caméra quarterback" },
  { value: "line", label: "Ligne", Icon: IconFootball, title: "Caméra ligne de scrimmage" },
  { value: "receiver", label: "Receveur", Icon: IconFootball, title: "Caméra receveur" },
];

const TOGGLE_CHIPS: { key: keyof ViewToggles; label: string; Icon: IconType; title: string }[] = [
  { key: "ghost", label: "Fantôme", Icon: IconGhost, title: "Affiche le placement attendu en transparence" },
  { key: "bubbles", label: "Bulles", Icon: IconBubbles, title: "Affiche une bulle d'explication au-dessus de chaque joueur" },
  { key: "routes", label: "Tracés", Icon: IconRoutes, title: "Dessine les tracés d'attaque et les nomme" },
  { key: "misalign", label: "Placement", Icon: IconPlacement, title: "Carré vert = bien placé, carré rouge = mal placé" },
];

function ToggleChip({
  active,
  label,
  title,
  Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  Icon: IconType;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-[6px] text-[13px] font-semibold transition-colors duration-150",
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border/70 bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon size={15} weight={(active ? "fill" : "regular") as IconWeight} />
      <span>{label}</span>
    </motion.button>
  );
}

export function Field3DControls() {
  const dim = useStore((s) => s.dim);
  const camera = useStore((s) => s.camera);
  const toggles = useStore((s) => s.toggles);
  const setCamera = useStore((s) => s.setCamera);
  const toggle = useStore((s) => s.toggle);

  if (dim !== "3d") return null;

  const cameraOptions = CAMERA_OPTIONS.map((o) => ({
    value: o.value,
    title: o.title,
    label: (
      <span className="inline-flex items-center gap-1.5">
        <o.Icon size={15} weight={(camera === o.value ? "fill" : "regular") as IconWeight} />
        {o.label}
      </span>
    ),
  }));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] p-2.5">
      {/* Grouped toolbar — top-right, single glass bar with dividers */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="glass pointer-events-auto ml-auto flex w-fit flex-wrap items-center gap-2 rounded-2xl border border-border/70 p-1.5"
      >
        <Segmented<CameraPreset>
          options={cameraOptions}
          value={camera}
          onChange={setCamera}
          size="sm"
          layoutId="field3d-camera"
          className="border-0 bg-transparent p-0"
        />
        <span className="mx-0.5 h-5 w-px self-center bg-border/80" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-1.5">
          {TOGGLE_CHIPS.map((c) => (
            <ToggleChip
              key={c.key}
              active={toggles[c.key]}
              label={c.label}
              title={c.title}
              Icon={c.Icon}
              onClick={() => toggle(c.key)}
            />
          ))}
        </div>
      </motion.div>

      {/* Drone badge — top-left, only in drone (top) view */}
      <AnimatePresence>
        {camera === "top" && (
          <motion.div
            key="drone-badge"
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -6 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="glass pointer-events-none absolute left-2.5 top-[52px] flex items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5"
          >
            <motion.span
              aria-hidden="true"
              className="text-brand-accent"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <IconDrone size={18} weight="fill" />
            </motion.span>
            <span className="font-display text-sm font-bold leading-none tracking-wide">
              Vue du drone
            </span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--ours-soft)]">
              <motion.span
                className="size-2 rounded-full bg-ours"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              LIVE
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Placement legend — bottom-left, only when misalign active */}
      <AnimatePresence>
        {toggles.misalign && (
          <motion.div
            key="place-legend"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="glass pointer-events-none absolute bottom-14 right-2.5 grid gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-[12.5px]"
          >
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-sm bg-grade-green" />
              <span className="text-muted-foreground">Bien placé</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-sm bg-grade-red" />
              <span className="text-muted-foreground">Mal placé</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
