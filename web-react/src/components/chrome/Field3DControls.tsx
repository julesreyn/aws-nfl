import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/store";
import type { CameraPreset, ViewToggles } from "@/types";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const CAMERA_OPTIONS: { value: CameraPreset; label: string; title?: string }[] = [
  { value: "free", label: "🖐 Libre", title: "Contrôle libre : glisser pour tourner/incliner, molette pour zoomer, clic droit pour déplacer" },
  { value: "top", label: "🚁 Drone", title: "Vue du dessus (drone)" },
  { value: "madden", label: "🎮 Madden", title: "Caméra diffusion" },
  { value: "qb", label: "QB", title: "Caméra quarterback" },
  { value: "line", label: "Ligne", title: "Caméra ligne de scrimmage" },
  { value: "receiver", label: "Receveur", title: "Caméra receveur" },
];

const TOGGLE_CHIPS: { key: keyof ViewToggles; label: string; title: string }[] = [
  { key: "ghost", label: "👻 Fantôme", title: "Affiche le placement attendu en transparence" },
  { key: "bubbles", label: "💬 Bulles", title: "Affiche une bulle d'explication au-dessus de chaque joueur" },
  { key: "routes", label: "➰ Tracés", title: "Dessine les tracés d'attaque et les nomme" },
  { key: "misalign", label: "🟥 Placement", title: "Carré vert = bien placé, carré rouge = mal placé" },
];

function ToggleChip({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "rounded-lg border px-3 py-[5px] text-[13px] font-semibold transition-colors",
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "border-brand-accent bg-brand-accent text-accent-foreground"
          : "glass border-border/70 text-muted-foreground hover:text-foreground"
      )}
      style={active ? { color: "var(--accent-ink)" } : undefined}
    >
      {label}
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

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] p-2.5">
      {/* Controls cluster — top-right */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="pointer-events-auto flex flex-wrap items-center justify-end gap-2"
      >
        <Segmented<CameraPreset>
          options={CAMERA_OPTIONS}
          value={camera}
          onChange={setCamera}
          size="sm"
          layoutId="field3d-camera"
          className="bg-card/80"
        />
        <div className="flex flex-wrap items-center gap-2">
          {TOGGLE_CHIPS.map((c) => (
            <ToggleChip
              key={c.key}
              active={toggles[c.key]}
              label={c.label}
              title={c.title}
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
            className="glass pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5 shadow-lg"
          >
            <motion.span
              aria-hidden="true"
              className="text-base"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              🚁
            </motion.span>
            <span className="font-display text-sm font-bold leading-none">Vue du drone</span>
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
            className="glass pointer-events-none absolute bottom-2.5 left-2.5 grid gap-1 rounded-xl border border-border/70 px-3 py-2 text-[12.5px] shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-sm bg-grade-green" />
              <span>Bien placé</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-sm bg-grade-red" />
              <span>Mal placé</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
