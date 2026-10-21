import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/store";
import { usePlaybackLoop } from "@/hooks/usePlaybackLoop";
import { useLiveSession } from "@/hooks/useLiveSession";
import { Topbar } from "@/components/chrome/Topbar";
import { SessionTimeline } from "@/components/chrome/SessionTimeline";
import { PlayTimeline } from "@/components/chrome/PlayTimeline";
import { Field3DControls } from "@/components/chrome/Field3DControls";
import { Field2D } from "@/components/field/Field2D";
import { View3D } from "@/components/field/View3D";
import { RepPanel } from "@/components/panel/RepPanel";
import { PhonePanel } from "@/components/panel/PhonePanel";
import { SettingsMenu } from "@/components/panel/Settings";
import { ReportsView } from "@/components/reports/ReportsView";
import { Segmented } from "@/components/ui/segmented";
import type { Dim } from "@/types";

const DIM_OPTIONS: { value: Dim; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
];

interface Toast {
  id: number;
  html: string;
  kind: string;
}

export default function App() {
  const boot = useStore((s) => s.boot);
  const fatal = useStore((s) => s.fatal);
  const session = useStore((s) => s.session);
  const view = useStore((s) => s.view);
  const dim = useStore((s) => s.dim);
  const rep = useStore((s) => s.rep);
  const setDim = useStore((s) => s.setDim);
  const setView = useStore((s) => s.setView);
  const openRep = useStore((s) => s.openRep);
  const togglePlay = useStore((s) => s.togglePlay);
  const step = useStore((s) => s.step);
  const setFrame = useStore((s) => s.setFrame);
  const select = useStore((s) => s.select);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = (html: string, kind: "sent" | "info" | "bad" = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, html, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  };

  const live = useLiveSession({ onToast: (m, k) => pushToast(m, k) });

  usePlaybackLoop();

  useEffect(() => {
    boot();
  }, [boot]);

  // Global keyboard shortcuts (seance view only)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select")) return;
      if (useStore.getState().view !== "seance") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        neighbour(-1);
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        neighbour(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setFrame(0);
      } else if (e.key === "Escape") {
        if (live.isLive) live.stop();
        else select(null);
      }
    };
    const neighbour = (d: number) => {
      const st = useStore.getState();
      if (!st.rep || !st.session) return;
      const reps = st.session.reps;
      const i = reps.findIndex((r) => r.id === st.rep!.id);
      const n = reps[i + d];
      if (n) {
        live.stop();
        openRep(String(n.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, setFrame, select, openRep, live]);

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h2 className="font-display text-2xl font-bold">Données indisponibles</h2>
        <p className="max-w-md text-muted-foreground">{fatal}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        onToggleLive={() => (live.isLive ? live.stop() : live.start())}
        settingsSlot={<SettingsMenu />}
      />

      <AnimatePresence mode="wait">
        {view === "rapports" ? (
          <motion.main
            key="reports"
            className="min-h-0 flex-1 overflow-y-auto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <ReportsView
              onOpenRep={(id) => {
                setView("seance");
                openRep(id, { autoplay: true });
              }}
            />
          </motion.main>
        ) : (
          <motion.section
            key="seance"
            className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 p-2.5 lg:grid-cols-[1fr_360px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Left column: timeline + stage */}
            <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
              <SessionTimeline />

              <div className="card-elev relative min-h-0 flex-1 overflow-hidden rounded-2xl !border-border/40 !bg-[#0a140f]">
                {/* field */}
                <div className="absolute inset-0" style={{ display: dim === "2d" ? "block" : "none" }}>
                  <Field2D />
                </div>
                <div className="absolute inset-0" style={{ display: dim === "3d" ? "block" : "none" }}>
                  {dim === "3d" && <View3D />}
                </div>

                {/* top-left dim switch */}
                <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-2">
                  <Segmented<Dim>
                    options={DIM_OPTIONS}
                    value={dim}
                    onChange={setDim}
                    size="sm"
                    layoutId="dim"
                  />
                </div>

                {/* 3D controls cluster (top-right / self positioned) */}
                <Field3DControls />

                {rep && (
                  <div className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 flex items-center gap-2">
                    <span className="glass flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                      <i className="inline-block h-[3px] w-3.5 rounded-sm align-middle bg-los" />
                      Scrimmage
                      <i className="ml-2 inline-block h-[3px] w-3.5 rounded-sm align-middle bg-brand-accent" />
                      Ligne à gagner
                    </span>
                  </div>
                )}
              </div>

              <PlayTimeline />
            </div>

            {/* Right column: panel */}
            <aside className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
              <div className="card-elev min-h-0 flex-1 overflow-y-auto rounded-2xl">
                <RepPanel />
              </div>
              <PhonePanel />
            </aside>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="glass pointer-events-auto max-w-sm rounded-xl border border-border/70 px-4 py-3 text-sm elev-pop"
              dangerouslySetInnerHTML={{ __html: t.html }}
            />
          ))}
        </AnimatePresence>
      </div>

      {!session && !fatal && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <span className="flex h-8 items-stretch gap-1">
              <i className="w-2 animate-pulse rounded bg-brand-accent" />
              <i className="w-1 animate-pulse rounded bg-foreground/40 [animation-delay:150ms]" />
              <i className="w-1 animate-pulse rounded bg-foreground/40 [animation-delay:300ms]" />
            </span>
            <p className="text-muted-foreground">Chargement de la séance…</p>
          </div>
        </div>
      )}
    </div>
  );
}
