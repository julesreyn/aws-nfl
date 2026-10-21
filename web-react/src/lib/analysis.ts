// analysis.ts — tracés de l'attaque (route tree) + placement simulé (bien / mal placé) pour la démo.
// Repère pipeline: l'attaque avance toujours vers +x ; y = largeur (0..53.3).
// Port fidèle de web/js/analysis.js (PR #1).
import type { PlayTracking, Rep, Session, TrackRow } from "@/types";

const MID_Y = 53.3 / 2;

export const ROUTE_HINT: Record<string, string> = {
  Go: "file tout droit en profondeur",
  Slant: "coupe en diagonale vers le centre",
  Out: "casse à 90° vers la touche",
  In: "casse à 90° vers le centre",
  Post: "monte puis file vers les poteaux",
  Corner: "monte puis file vers le coin",
  Curl: "monte puis revient vers le QB",
  Hitch: "monte 5 yards et se retourne",
  Flat: "sort vers la touche, court",
  Drag: "traverse le terrain à plat",
  Screen: "reste derrière la ligne pour la passe écran",
  Wheel: "sort à plat puis remonte la touche",
};

export interface RouteItem {
  id: string;
  jersey: number | null;
  name: string;
  pos: string;
  route: string;
  hint: string;
  ours: boolean;
}
export interface MisplacedItem {
  id: string;
  jersey: number | null;
  name: string;
  issue: string;
}
export interface PlayerAnalysis {
  route?: string;
  ok?: boolean;
  offset?: { dx: number; dy: number };
  issue?: string;
}
export interface RepAnalysis {
  players: Record<string, PlayerAnalysis>;
  routes: RouteItem[];
  misplaced: MisplacedItem[];
  speech: string;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = number[] | null;
const ok = (r: TrackRow | Row): r is number[] =>
  Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number";

function at(arr: (TrackRow | Row)[], i: number): number[] | null {
  for (let k = Math.min(i, arr.length - 1); k >= 0; k--) if (ok(arr[k])) return arr[k] as number[];
  for (let k = i; k < arr.length; k++) if (ok(arr[k])) return arr[k] as number[];
  return null;
}
function eventIdx(rep: Rep, names: string[]): number {
  for (const e of rep.events || []) if (names.includes(e.name)) return e.frame - 1;
  return -1;
}

function classify(arr: (TrackRow | Row)[], snap: number, end: number): string | null {
  const s = at(arr, snap);
  if (!s) return null;
  const out = Math.sign(s[1] - MID_Y) || 1; // +1 = vers la touche la plus proche
  let maxD = 0;
  for (let i = snap; i <= end; i++) {
    const row = arr[i];
    if (ok(row) && row[0] - s[0] > maxD) maxD = row[0] - s[0];
  }
  const e = at(arr, end)!;
  const fd = e[0] - s[0],
    fo = (e[1] - s[1]) * out;
  if (maxD < 2.5) return Math.abs(fo) < 2 ? "Screen" : fo > 0 ? "Flat" : "Drag";
  if (fd < maxD - 1.8 && maxD < 16) return maxD < 8 ? "Hitch" : "Curl";
  // direction sur la dernière seconde
  const b = at(arr, Math.max(snap, end - 10))!;
  const ddx = e[0] - b[0],
    ddo = (e[1] - b[1]) * out;
  const early = at(arr, Math.min(end, snap + 10));
  const eo = early ? (early[1] - s[1]) * out : 0;
  if (eo > 3 && ddx > 2 && maxD > 8) return "Wheel";
  const ang = (Math.atan2(Math.abs(ddo), Math.max(0.01, ddx)) * 180) / Math.PI;
  if (ddx < 0.5 || ang > 62) {
    if (maxD < 4) return ddo > 0 ? "Flat" : "Drag";
    return ddo > 0 ? "Out" : "In";
  }
  if (ang < 22) return "Go";
  if (ddo < 0) return maxD < 9 ? "Slant" : "Post";
  return "Corner";
}

const fr1 = (v: number) => v.toFixed(1).replace(".", ",");

// Analyse d'un essai: routes + erreurs de placement simulées (seed stable par essai).
export function analyzeRep(
  rep: Rep | null,
  track: PlayTracking | null,
  session: Session | null
): RepAnalysis {
  const res: RepAnalysis = { players: {}, routes: [], misplaced: [], speech: "" };
  if (!rep || !track || !track.players) return res;
  const snap = Math.max(0, (rep.snapFrame || 1) - 1);
  let end = eventIdx(rep, [
    "pass_arrived",
    "pass_outcome_caught",
    "pass_outcome_incomplete",
    "interception",
    "pass_outcome_touchdown",
  ]);
  if (end < 0) end = eventIdx(rep, ["pass_forward", "autoevent_passforward"]);
  if (end < 0) end = Math.min(snap + 30, (track.nFrames || 1) - 1);
  const offenseOurs = rep.side !== "defense";
  const los = rep.losX ?? 60;
  const ball = Array.isArray(track.ball)
    ? at(track.ball.map((b) => (Array.isArray(b) ? [b[0], b[1]] : null)), snap)
    : null;
  const ballY = ball ? ball[1] : MID_Y;
  const meta = (id: string) => (session && session.players && session.players[id]) || null;
  const ours = (id: string) =>
    !!(rep.players && rep.players[id]) || !!(meta(id) && meta(id)!.ours);

  for (const [id, arr] of Object.entries(track.players)) {
    if (!Array.isArray(arr)) continue;
    const m = meta(id),
      rp = rep.players && rep.players[id];
    const isOff = ours(id) === offenseOurs;
    if (!isOff) continue;
    const s = at(arr, snap);
    if (!s) continue;
    let route: string | null = null;
    if (rp) {
      if (rp.role === "Pass Route") route = classify(arr, snap, end);
    } else {
      // adversaire en attaque: receveur = écarté du ballon ou qui part en profondeur
      let maxD = 0;
      for (let i = snap; i <= end; i++) {
        const row = arr[i];
        if (ok(row)) maxD = Math.max(maxD, row[0] - los);
      }
      const wide = Math.abs(s[1] - ballY) > 5;
      const qb = Math.abs(s[1] - ballY) < 1.5 && s[0] < los - 2;
      if (!qb && (wide || maxD > 4)) route = classify(arr, snap, end);
    }
    if (route) {
      const jersey = m ? m.jersey : null;
      const name = m ? m.name : jersey != null ? `#${jersey}` : "Receveur";
      res.routes.push({
        id,
        jersey,
        name,
        pos: (rp && rp.pos) || (m && m.position) || "",
        route,
        hint: ROUTE_HINT[route] || "",
        ours: ours(id),
      });
      res.players[id] = { route };
    }
  }

  // placement simulé sur nos joueurs (1 à 2 erreurs par essai, stables)
  const r = rng(hash(`${session && session.id}:${rep.id}`));
  const ourIds = Object.keys(track.players).filter(
    (id) => ours(id) && at(track.players[id], snap)
  );
  const n = Math.min(ourIds.length, r() < 0.55 ? 1 : 2);
  const pool = ourIds.slice();
  const bad = new Set<string>();
  for (let k = 0; k < n && pool.length; k++)
    bad.add(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  for (const id of ourIds) {
    const p = res.players[id] || (res.players[id] = {});
    if (!bad.has(id)) {
      p.ok = true;
      continue;
    }
    const s = at(track.players[id], snap)!;
    const away = s[0] < los ? -1 : 1; // s'éloigner de la ligne de scrimmage
    const dist = 1.6 + r() * 1.6;
    let issue: string;
    if (r() < 0.5) {
      const dir = r() < 0.5 ? 1 : -1; // +1 vers la touche
      const outS = Math.sign(s[1] - MID_Y) || 1;
      p.offset = { dx: 0, dy: dir * outS * dist };
      issue = `aligné ${fr1(dist)} yard${dist >= 2 ? "s" : ""} trop ${dir > 0 ? "à l’extérieur" : "à l’intérieur"}`;
    } else {
      p.offset = { dx: away * dist, dy: 0 };
      issue = `${fr1(dist)} yard${dist >= 2 ? "s" : ""} trop en retrait`;
    }
    p.ok = false;
    p.issue = issue;
    const m = meta(id);
    res.misplaced.push({ id, jersey: m ? m.jersey : null, name: m ? m.name : `#${id}`, issue });
  }

  // texte annoncé
  const parts: string[] = [];
  if (res.routes.length) {
    parts.push(offenseOurs ? "Tracés de l’attaque." : `Tracés adverses.`);
    for (const t of res.routes)
      parts.push(`${t.jersey != null ? "Numéro " + t.jersey : t.name}, ${t.route}.`);
  }
  for (const b of res.misplaced)
    parts.push(`Attention, numéro ${b.jersey ?? ""} ${b.name.split(" ").slice(-1)[0]}, ${b.issue}.`);
  res.speech = parts.join(" ");
  return res;
}
