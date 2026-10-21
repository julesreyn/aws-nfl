import { useRef } from "react";
import { motion } from "motion/react";
import { Pause, Play, SkipBack, SkipForward, RotateCcw } from "lucide-react";
import { useStore } from "@/store";
import { fmtSeconds } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const SPEEDS = ["0.25", "0.5", "1"] as const;
type SpeedKey = (typeof SPEEDS)[number];

const SPEED_OPTIONS = SPEEDS.map((v) => ({
  value: v,
  label: `${v.replace(".", ",")}×`,
}));

const KEY_EVENTS = new Set([
  "Snap",
  "Passe",
  "Sack",
  "Strip sack",
  "Réception",
  "Incomplète",
  "Interception",
  "Plaquage",
  "Play action",
  "QB scramble",
  "Fumble",
]);

export function PlayTimeline() {
  const rep = useStore((s) => s.rep);
  const frame = useStore((s) => s.frame);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const pause = useStore((s) => s.pause);
  const togglePlay = useStore((s) => s.togglePlay);
  const step = useStore((s) => s.step);
  const setFrame = useStore((s) => s.setFrame);
  const setSpeed = useStore((s) => s.setSpeed);

  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!rep) return null;

  const n = Math.max(2, rep.nFrames || 2);
  const pct = (f: number) => (n <= 1 ? 0 : (f / (n - 1)) * 100);
  const preWidth = pct(Math.max(0, (rep.snapFrame ?? 1) - 1));

  const frameFromEvent = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return t * (n - 1);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-event-marker]")) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pause();
    setFrame(frameFromEvent(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFrame(frameFromEvent(e.clientX));
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const speedKey = (SPEEDS.find((s) => Number(s) === speed) ?? "1") as SpeedKey;

  // Lay out event markers, nudging overlapping labels to a second row.
  const events = (rep.events ?? []).filter((e) => e.label);
  let lastPct = -100;
  let row = 0;
  const markers = events.map((e) => {
    const p = pct(e.frame - 1);
    row = p - lastPct < 9 ? (row + 1) % 2 : 0;
    lastPct = p;
    return { label: e.label!, frame: e.frame - 1, pct: p, row, key: KEY_EVENTS.has(e.label!) };
  });

  return (
    <div className="glass grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-border/70 px-4 py-2.5">
      {/* Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setFrame(0)}
          aria-label="Revenir au début"
          title="Revenir au début (Début)"
          className="size-8 rounded-lg"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(-1)}
          aria-label="Image précédente"
          title="Image précédente (←)"
          className="size-8 rounded-lg"
        >
          <SkipBack />
        </Button>
        <motion.button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Lecture"}
          title="Lecture / pause (Espace)"
          whileTap={{ scale: 0.94 }}
          className="mx-1 grid size-11 cursor-pointer place-items-center rounded-full bg-foreground text-background shadow-lg transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
        </motion.button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(1)}
          aria-label="Image suivante"
          title="Image suivante (→)"
          className="size-8 rounded-lg"
        >
          <SkipForward />
        </Button>
        <Segmented<SpeedKey>
          options={SPEED_OPTIONS}
          value={speedKey}
          onChange={(v) => setSpeed(Number(v))}
          size="sm"
          layoutId="play-speed"
          className="ml-2"
        />
      </div>

      {/* Scrub */}
      <div
        className="relative h-[54px] cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Event markers */}
        <div className="absolute inset-x-0 bottom-[18px] top-0">
          {markers.map((m, i) => {
            const past = m.frame <= frame + 0.01;
            return (
              <button
                key={`${m.label}-${i}`}
                type="button"
                data-event-marker
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  pause();
                  setFrame(m.frame);
                }}
                title={`${m.label} · ${fmtSeconds(m.frame)}`}
                style={{ left: `${m.pct}%`, bottom: m.row === 1 ? 15 : 0 }}
                className={cn(
                  "absolute flex -translate-x-1/2 flex-col items-center whitespace-nowrap pb-1 font-body text-[11.5px] font-semibold leading-none transition-colors",
                  past ? "text-brand-accent" : m.key ? "text-foreground/80" : "text-muted-foreground"
                )}
              >
                <span className="rounded bg-card/80 px-1.5 py-0.5 backdrop-blur-sm">{m.label}</span>
                <span
                  className={cn("mt-1 w-0.5 rounded-sm bg-current", m.row === 1 ? "h-[23px]" : "h-2")}
                />
              </button>
            );
          })}
        </div>

        {/* Bar */}
        <div ref={barRef} className="absolute inset-x-0 bottom-2.5 h-2 rounded-full bg-secondary">
          {/* pre-snap zone */}
          <div
            className="absolute inset-y-0 left-0 rounded-l-full"
            style={{
              width: `${preWidth}%`,
              background:
                "repeating-linear-gradient(135deg, rgba(255,255,255,.08) 0 4px, transparent 4px 8px)",
            }}
          />
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-brand-accent/85"
            style={{ width: `${pct(frame)}%` }}
          />
          <motion.div
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(242,209,75,.3)]"
            style={{ left: `${pct(frame)}%` }}
          />
        </div>
      </div>

      {/* Time */}
      <div className="min-w-[92px] text-right font-display text-lg font-semibold leading-none tnum">
        <b>{fmtSeconds(frame)}</b>
        <span className="ml-1 text-sm text-muted-foreground">/ {fmtSeconds(n - 1)}</span>
      </div>
    </div>
  );
}
