import { create } from "zustand";
import type {
  CameraPreset,
  Dim,
  Drill,
  PhoneMessage,
  Rep,
  RouteInfo,
  Session,
  SessionSummary,
  Tracking,
  ViewName,
  ViewToggles,
} from "@/types";
export type { ViewToggles } from "@/types";
import { analyzeRep, type RepAnalysis } from "@/lib/analysis";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface LiveState {
  drillId: string;
  idx: number;
  trackedId: string | null;
}

interface AppState {
  // data
  sessions: SessionSummary[];
  session: Session | null;
  tracking: Tracking | null;
  repsById: Record<string, Rep>;
  drillsById: Record<string, Drill>;
  loading: boolean;
  fatal: string | null;

  // playback / selection
  rep: Rep | null;
  analysis: RepAnalysis | null;
  frame: number;
  playing: boolean;
  speed: number;
  selected: string | null;

  // view
  dim: Dim;
  view: ViewName;
  camera: CameraPreset;
  toggles: ViewToggles;
  routes: RouteInfo[];

  // live session
  live: LiveState | null;
  phone: PhoneMessage[];

  // actions
  boot: () => Promise<void>;
  loadSession: (id: string, repId?: string | null) => Promise<void>;
  openRep: (repId: string, opts?: { autoplay?: boolean }) => void;
  setFrame: (f: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  step: (d: number) => void;
  select: (id: string | null) => void;
  setDim: (d: Dim) => void;
  setView: (v: ViewName) => void;
  setCamera: (c: CameraPreset) => void;
  toggle: (key: keyof ViewToggles, value?: boolean) => void;
  setRoutes: (r: RouteInfo[]) => void;
  setSpeed: (s: number) => void;
  setLive: (l: LiveState | null) => void;
  pushPhone: (m: Omit<PhoneMessage, "time">) => void;
}

export const FPS = 10;

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  session: null,
  tracking: null,
  repsById: {},
  drillsById: {},
  loading: false,
  fatal: null,

  rep: null,
  analysis: null,
  frame: 0,
  playing: false,
  speed: 1,
  selected: null,

  dim: "2d",
  view: "seance",
  camera: "free",
  toggles: { ghost: false, bubbles: false, routes: false, misalign: false },
  routes: [],

  live: null,
  phone: [],

  async boot() {
    try {
      const sessions = await getJSON<SessionSummary[]>("data/sessions.json");
      set({ sessions });
      const hash = new URLSearchParams(location.hash.slice(1));
      const wanted = sessions.find((s) => s.id === hash.get("s"))?.id ?? sessions[0]?.id;
      if (!wanted) {
        set({ fatal: "Aucune séance disponible." });
        return;
      }
      await get().loadSession(wanted, hash.get("r"));
    } catch {
      set({ fatal: "Les données de séance sont introuvables. Lance `uv run pipeline/build.py` puis recharge." });
    }
  },

  async loadSession(id, repId) {
    set({ loading: true });
    try {
      const [session, tracking] = await Promise.all([
        getJSON<Session>(`data/session_${id}.json`),
        getJSON<Tracking>(`data/tracking_${id}.json`),
      ]);
      const repsById = Object.fromEntries(session.reps.map((r) => [String(r.id), r]));
      const drillsById = Object.fromEntries(session.drills.map((d) => [d.id, d]));
      set({ session, tracking, repsById, drillsById, selected: null });
      const first = repId && repsById[repId] ? repId : session.reps[0]?.id;
      if (first != null) get().openRep(String(first), { autoplay: false });
    } catch {
      set({ fatal: "Impossible de charger la séance." });
    } finally {
      set({ loading: false });
    }
  },

  openRep(repId, opts = {}) {
    const { repsById, session, selected, tracking } = get();
    const rep = repsById[String(repId)];
    if (!rep || !session) return;
    const nextSelected = selected && !rep.players[selected] ? null : selected;
    const track =
      (tracking && (tracking[String(rep.playId)] || tracking[String(rep.id)])) || null;
    const analysis = analyzeRep(rep, track, session);
    set({ rep, analysis, view: "seance", selected: nextSelected, frame: 0, routes: [] });
    history.replaceState(null, "", `#s=${session.id}&r=${rep.id}`);
    if (opts.autoplay) get().play();
    else get().pause();
  },

  setFrame(f) {
    const { rep } = get();
    const n = rep ? Math.max(1, (rep.nFrames || 1) - 1) : 0;
    set({ frame: Math.max(0, Math.min(n, f)) });
  },

  play() {
    const { rep, frame, setFrame } = get();
    if (!rep) return;
    if (frame >= rep.nFrames - 1.001) setFrame(0);
    set({ playing: true });
  },
  pause() {
    set({ playing: false });
  },
  togglePlay() {
    get().playing ? get().pause() : get().play();
  },
  step(d) {
    get().pause();
    get().setFrame(Math.round(get().frame) + d);
  },

  select(id) {
    set({ selected: id == null ? null : String(id) });
  },

  setDim(d) {
    set({ dim: d });
  },
  setView(v) {
    if (v === "rapports") get().pause();
    set({ view: v });
  },
  setCamera(c) {
    set({ camera: c });
  },
  toggle(key, value) {
    set((s) => ({ toggles: { ...s.toggles, [key]: value ?? !s.toggles[key] } }));
  },
  setRoutes(r) {
    set({ routes: r });
  },
  setSpeed(s) {
    set({ speed: s });
  },
  setLive(l) {
    set({ live: l });
  },
  pushPhone(m) {
    set((s) => ({ phone: [{ ...m, time: new Date() }, ...s.phone] }));
  },
}));
