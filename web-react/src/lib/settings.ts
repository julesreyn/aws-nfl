// Réglages persistés en localStorage (toujours protégés par try/catch).
// Clé unique partagée avec la version vanilla pour garder la continuité.

const KEY = "sideline.settings.v1";

export type FeedbackLevel = "silent" | "rep" | "brief" | "both";
export type TrackedMode = "auto" | "selected";

export interface Settings {
  level: FeedbackLevel;
  tracked: TrackedMode;
}

const DEFAULTS: Settings = { level: "both", tracked: "auto" };

export interface LevelOption {
  id: FeedbackLevel;
  label: string;
  hint: string;
}

export const LEVELS: LevelOption[] = [
  { id: "silent", label: "Silencieux", hint: "Aucun envoi, aucune voix" },
  { id: "rep", label: "Retour d'essai", hint: "Une phrase après chaque essai" },
  { id: "brief", label: "Briefs de drill", hint: "Un brief à la fin du drill" },
  { id: "both", label: "Les deux", hint: "Retour d'essai et brief de drill" },
];

// -------------------------------------------------------------- localStorage
export function lsGet(key: string, fallback: string | null = null): string | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

// -------------------------------------------------------------- state + subs
let state: Settings = { ...DEFAULTS };
try {
  const raw = lsGet(KEY);
  if (raw) state = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
} catch {
  /* json invalide */
}

const subs = new Set<(s: Settings) => void>();

export function get(): Settings {
  return { ...state };
}

export function set(patch: Partial<Settings>): void {
  state = { ...state, ...patch };
  lsSet(KEY, JSON.stringify(state));
  subs.forEach((fn) => {
    try {
      fn(get());
    } catch {
      /* ignore */
    }
  });
}

export function subscribe(fn: (s: Settings) => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export const wantsRep = (): boolean => state.level === "rep" || state.level === "both";
export const wantsBrief = (): boolean => state.level === "brief" || state.level === "both";
