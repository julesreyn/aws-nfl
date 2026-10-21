// Vue Rapports — synthèse post-séance : KPI, tableau par joueur, par jeu, par drill,
// fiche joueur détaillée. Graphiques en SVG/CSS, aucune dépendance de charting.
// Portage React de web/js/reports.js. Clic sur un essai -> onOpenRep(id).
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useStore } from "@/store";
import type { Grade, Rep, Session } from "@/types";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------- consts
const GROUPS = ["OL", "QB", "WR", "TE", "RB", "DL", "LB", "DB"];
const RESULT_LABEL: Record<string, string> = {
  C: "Complétée",
  I: "Incomplète",
  S: "Sack",
  IN: "INT",
  R: "Scramble",
};
const SIDE_LABEL: Record<string, string> = { offense: "Attaque", defense: "Défense" };
const FORMATION_LABEL: Record<string, string> = {
  SHOTGUN: "Shotgun",
  EMPTY: "Empty",
  SINGLEBACK: "Singleback",
  I_FORM: "I-Form",
  PISTOL: "Pistol",
  JUMBO: "Jumbo",
  WILDCAT: "Wildcat",
};

// ------------------------------------------------------------------ utilities
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const mean = (arr: (number | null | undefined)[]): number | null => {
  const xs = arr.map((v) => num(v)).filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const fmt = (v: number | null, d = 0): string =>
  num(v) === null ? "–" : (v as number).toFixed(d).replace(".", ",");
const pct = (a: number, b: number): number => (b ? Math.round((100 * a) / b) : 0);
const gradeOf = (g: unknown): Grade | "none" =>
  g === "green" || g === "orange" || g === "red" ? g : "none";
const scoreClass = (s: number | null): Grade | "none" =>
  num(s) === null ? "none" : (s as number) >= 70 ? "green" : (s as number) >= 45 ? "orange" : "red";
const formationLabel = (f?: string): string =>
  (f && FORMATION_LABEL[f]) ||
  (f
    ? String(f).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
    : "Formation inconnue");

interface GradeCount {
  green: number;
  orange: number;
  red: number;
}
function countGrades(items: { grade?: unknown }[]): GradeCount {
  const c: GradeCount = { green: 0, orange: 0, red: 0 };
  for (const it of items) {
    const g = it?.grade;
    if (g === "green" || g === "orange" || g === "red") c[g]++;
  }
  return c;
}

// -------------------------------------------------------------- aggregations
interface MetricStat {
  key: string;
  label: string;
  unit: string;
  n: number;
  ok: number;
  ko: number;
  values: number[];
}
interface PlayerAgg {
  id: string;
  name: string;
  jersey?: number;
  position: string;
  group: string;
  n: number;
  avg: number | null;
  scores: (number | null)[];
  grades: GradeCount;
  reps: { rep: Rep; pr: Rep["players"][string] }[];
  metricStats: MetricStat[];
  worst: MetricStat | null;
  best: MetricStat | null;
}

function aggregatePlayers(session: Session, reps: Rep[]): PlayerAgg[] {
  const players = session.players || {};
  const byId = new Map<string, { id: string; meta: Session["players"][string] | undefined; reps: PlayerAgg["reps"] }>();
  for (const rep of reps) {
    for (const [pid, pr] of Object.entries(rep.players || {})) {
      const meta = players[pid];
      if (meta && meta.ours === false) continue;
      if (!byId.has(pid)) byId.set(pid, { id: pid, meta, reps: [] });
      byId.get(pid)!.reps.push({ rep, pr: pr || ({} as Rep["players"][string]) });
    }
  }
  const out: PlayerAgg[] = [];
  for (const p of byId.values()) {
    p.reps.sort((a, b) => (a.rep.index ?? 0) - (b.rep.index ?? 0));
    const scores = p.reps.map((r) => num(r.pr.score));
    const metricStats = new Map<string, MetricStat>();
    for (const { pr } of p.reps) {
      for (const m of Array.isArray(pr.metrics) ? pr.metrics : []) {
        if (!m || !m.key) continue;
        let stat = metricStats.get(m.key);
        if (!stat) {
          stat = { key: m.key, label: m.label || m.key, unit: m.unit || "", n: 0, ok: 0, ko: 0, values: [] };
          metricStats.set(m.key, stat);
        }
        stat.n++;
        if (m.ok === true) stat.ok++;
        else if (m.ok === false) stat.ko++;
        const mv = num(m.value);
        if (mv !== null) stat.values.push(mv);
      }
    }
    const stats = [...metricStats.values()];
    const judged = stats.filter((s) => s.ok + s.ko > 0);
    const minRep = p.reps.length >= 3 ? 2 : 1;
    const worst =
      judged
        .filter((s) => s.ko >= minRep)
        .sort(
          (a, b) => b.ko - a.ko || b.ko / (b.ok + b.ko) - a.ko / (a.ok + a.ko)
        )[0] || null;
    const best =
      judged
        .filter((s) => s.ok >= minRep && (!worst || s.key !== worst.key))
        .sort((a, b) => b.ok / (b.ok + b.ko) - a.ok / (a.ok + a.ko) || b.ok - a.ok)[0] ||
      null;
    out.push({
      id: p.id,
      name: p.meta?.name || `#${p.id}`,
      jersey: p.meta?.jersey,
      position: p.meta?.position || p.reps[0]?.pr.pos || "",
      group: p.meta?.group || "?",
      n: p.reps.length,
      avg: mean(scores),
      scores,
      grades: countGrades(p.reps.map((r) => r.pr)),
      reps: p.reps,
      metricStats: stats,
      worst,
      best,
    });
  }
  return out;
}

interface PlayAgg {
  key: string;
  side: string;
  label: string;
  reps: Rep[];
  n: number;
  avg: number | null;
  greenRate: number;
  yards: number | null;
  grades: GradeCount;
  results: Record<string, number>;
}
function playKey(rep: Rep): { key: string; side: string; label: string } {
  const side = rep.side === "defense" ? "defense" : "offense";
  const parts = [formationLabel(rep.formation)];
  if (side === "defense") parts.push(rep.coverage || "Couverture inconnue");
  return { key: `${side}|${parts.join("|")}`, side, label: parts.join(" · ") };
}
function aggregatePlays(reps: Rep[]): PlayAgg[] {
  const map = new Map<string, { key: string; side: string; label: string; reps: Rep[] }>();
  for (const rep of reps) {
    const k = playKey(rep);
    if (!map.has(k.key)) map.set(k.key, { ...k, reps: [] });
    map.get(k.key)!.reps.push(rep);
  }
  return [...map.values()].map((g) => {
    const results: Record<string, number> = {};
    for (const r of g.reps) {
      const code = r.passResult && RESULT_LABEL[r.passResult] ? r.passResult : "?";
      results[code] = (results[code] || 0) + 1;
    }
    const grades = countGrades(g.reps);
    return {
      ...g,
      n: g.reps.length,
      avg: mean(g.reps.map((r) => r.score)),
      greenRate: pct(grades.green, g.reps.length),
      yards: mean(g.reps.map((r) => r.playResult)),
      grades,
      results,
    };
  });
}

interface DrillAgg {
  d: Session["drills"][number];
  reps: Rep[];
  avg: number | null;
  grades: GradeCount;
}
function drillStats(session: Session, repById: Map<string, Rep>): DrillAgg[] {
  return (session.drills || []).map((d) => {
    const reps = (d.repIds || []).map((id) => repById.get(String(id))).filter(Boolean) as Rep[];
    const summary = (d as unknown as { summary?: GradeCount }).summary;
    return { d, reps, avg: mean(reps.map((r) => r.score)), grades: summary || countGrades(reps) };
  });
}

// ------------------------------------------------------------------ SVG/CSS
function StackedBar({
  grades,
  height = 14,
  labels = false,
}: {
  grades: GradeCount;
  height?: number;
  labels?: boolean;
}) {
  const total = grades.green + grades.orange + grades.red;
  if (!total)
    return <div className="w-full rounded bg-muted/50" style={{ height }} />;
  const seg = (k: keyof GradeCount, color: string) =>
    grades[k] ? (
      <div
        className={cn("flex items-center justify-center text-[11px] font-bold text-black", color)}
        style={{ flex: grades[k], minWidth: 3 }}
        title={`${k} : ${grades[k]} (${pct(grades[k], total)} %)`}
      >
        {labels && pct(grades[k], total) >= 8 ? grades[k] : ""}
      </div>
    ) : null;
  return (
    <div className="flex w-full gap-0.5 overflow-hidden rounded" style={{ height }}>
      {seg("green", "bg-grade-green")}
      {seg("orange", "bg-grade-orange")}
      {seg("red", "bg-grade-red")}
    </div>
  );
}

function ScorePill({ s }: { s: number | null }) {
  const cls = scoreClass(s);
  const style: Record<string, string> = {
    green: "text-grade-green bg-grade-green/15",
    orange: "text-grade-orange bg-grade-orange/15",
    red: "text-grade-red bg-grade-red/15",
    none: "text-muted-foreground bg-muted/50",
  };
  return (
    <span
      className={cn(
        "inline-block min-w-10 rounded-md px-2 py-0.5 text-center text-[15px] font-bold tnum",
        style[cls]
      )}
    >
      {fmt(s)}
    </span>
  );
}

const FILL: Record<Grade | "none", string> = {
  green: "var(--grade-green)",
  orange: "var(--grade-orange)",
  red: "var(--grade-red)",
  none: "var(--muted-foreground)",
};

function Sparkline({
  scores,
  grades,
  w = 120,
  h = 28,
}: {
  scores: (number | null)[];
  grades: (Grade | undefined)[];
  w?: number;
  h?: number;
}) {
  const pts = scores
    .map((s, i) => [i, s] as [number, number | null])
    .filter((p): p is [number, number] => p[1] !== null);
  if (!pts.length) return <span className="text-muted-foreground">–</span>;
  const n = Math.max(scores.length - 1, 1);
  const X = (i: number) => 3 + (i / n) * (w - 6);
  const Y = (s: number) => h - 3 - (Math.max(0, Math.min(100, s)) / 100) * (h - 6);
  const line = pts.map(([i, s]) => `${X(i).toFixed(1)},${Y(s).toFixed(1)}`).join(" ");
  const [li, ls] = pts[pts.length - 1];
  const lastGrade = gradeOf(grades[li]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block overflow-visible" aria-hidden="true">
      <line x1="0" x2={w} y1={Y(70)} y2={Y(70)} stroke="var(--border)" strokeDasharray="2 3" />
      {pts.length > 1 && (
        <polyline
          points={line}
          fill="none"
          stroke="var(--los)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle cx={X(li)} cy={Y(ls)} r="3" fill={FILL[lastGrade]} />
    </svg>
  );
}

function ScoreChart({ player, onOpenRep }: { player: PlayerAgg; onOpenRep: (id: string) => void }) {
  const w = 640,
    h = 220,
    ml = 34,
    mr = 12,
    mt = 12,
    mb = 28;
  const items = player.reps;
  const n = Math.max(items.length - 1, 1);
  const X = (i: number) =>
    ml + (items.length === 1 ? (w - ml - mr) / 2 : (i / n) * (w - ml - mr));
  const Y = (s: number) => mt + (1 - Math.max(0, Math.min(100, s)) / 100) * (h - mt - mb);
  const valid = items
    .map((it, i) => [i, num(it.pr.score)] as [number, number | null])
    .filter((p): p is [number, number] => p[1] !== null);
  const line = valid.map(([i, s]) => `${X(i).toFixed(1)},${Y(s).toFixed(1)}`).join(" ");
  const trend = valid
    .map(([i], k) => {
      const win = valid.slice(Math.max(0, k - 2), k + 1).map(([, s]) => s);
      return `${X(i).toFixed(1)},${Y(win.reduce((a, b) => a + b, 0) / win.length).toFixed(1)}`;
    })
    .join(" ");
  const step = Math.ceil(items.length / 12);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Score par essai"
      className="block h-auto w-full rounded-xl border border-border/70 bg-card/40"
    >
      <rect x={ml} y={Y(100)} width={w - ml - mr} height={Y(70) - Y(100)} fill="var(--grade-green)" opacity="0.06" />
      <rect x={ml} y={Y(45)} width={w - ml - mr} height={Y(0) - Y(45)} fill="var(--grade-red)" opacity="0.06" />
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={ml} x2={w - mr} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text x={ml - 6} y={Y(v) + 4} fill="var(--muted-foreground)" fontSize="11" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {valid.length > 2 && (
        <polyline points={trend} fill="none" stroke="var(--los)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
      )}
      {valid.length > 1 && (
        <polyline points={line} fill="none" stroke="color-mix(in srgb, var(--foreground) 45%, transparent)" strokeWidth="1.5" strokeLinejoin="round" />
      )}
      {valid.map(([i, s]) => {
        const it = items[i];
        const g = gradeOf(it.pr.grade);
        const tip = `Essai ${it.rep.index ?? i + 1} · ${it.rep.label || ""} · score ${Math.round(s)}`;
        return (
          <g
            key={String(it.rep.id)}
            className="cursor-pointer"
            tabIndex={0}
            role="button"
            aria-label={tip}
            onClick={() => onOpenRep(String(it.rep.id))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenRep(String(it.rep.id));
              }
            }}
          >
            <title>{tip}</title>
            <circle cx={X(i)} cy={Y(s)} r="11" fill="transparent" />
            <circle cx={X(i)} cy={Y(s)} r="5.5" fill={FILL[g]} stroke="var(--background)" strokeWidth="2" />
          </g>
        );
      })}
      {items.map((it, i) =>
        i % step === 0 || i === items.length - 1 ? (
          <text
            key={`x-${i}`}
            x={X(i)}
            y={h - 8}
            fill="var(--muted-foreground)"
            fontSize="11"
            textAnchor="middle"
          >
            {it.rep.index ?? i + 1}
          </text>
        ) : null
      )}
    </svg>
  );
}

function Dots({
  reps,
  big = false,
  onOpenRep,
}: {
  reps: Rep[];
  big?: boolean;
  onOpenRep: (id: string) => void;
}) {
  if (!reps.length) return <span className="text-muted-foreground">Aucun essai</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {reps.map((r) => {
        const g = gradeOf(r.grade);
        const bg =
          g === "green"
            ? "bg-grade-green"
            : g === "orange"
              ? "bg-grade-orange"
              : g === "red"
                ? "bg-grade-red"
                : "bg-muted-foreground";
        const tip = `Essai ${r.index ?? ""} · ${r.label || ""}${num(r.score) !== null ? " · score " + Math.round(r.score as number) : ""}`;
        return (
          <button
            key={String(r.id)}
            type="button"
            onClick={() => onOpenRep(String(r.id))}
            title={tip}
            aria-label={tip}
            className={cn(
              "cursor-pointer border-0 p-0 transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground",
              bg,
              big ? "size-5 rounded-md" : "size-3 rounded-full"
            )}
          />
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------- summary block
function Summary({
  session,
  reps,
  drills,
  onGotoDrill,
}: {
  session: Session;
  reps: Rep[];
  drills: DrillAgg[];
  onGotoDrill: (id: string) => void;
}) {
  const g = countGrades(reps);
  const total = reps.length;
  const off = reps.filter((r) => r.side === "offense");
  const def = reps.filter((r) => r.side === "defense");
  const scored = drills.filter((x) => x.avg !== null);
  const pool = scored.filter((x) => x.reps.length >= 2);
  const ranked = (pool.length >= 2 ? pool : scored).slice().sort((a, b) => (b.avg as number) - (a.avg as number));
  const best = ranked[0] || null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  const SideBox = ({ label, arr }: { label: string; arr: Rep[] }) => (
    <div className="glass flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 p-3">
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2.5">
        <ScorePill s={mean(arr.map((r) => r.score))} />
        <span className="text-xs text-muted-foreground">
          {arr.length} essai{arr.length > 1 ? "s" : ""}
        </span>
      </div>
      <StackedBar grades={countGrades(arr)} height={6} />
    </div>
  );

  const DrillBox = ({ label, x, cls }: { label: string; x: DrillAgg | null; cls: "best" | "worst" }) => (
    <button
      type="button"
      disabled={!x}
      onClick={() => x && onGotoDrill(x.d.id)}
      className={cn(
        "glass flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 p-3 text-left transition-colors",
        x && "cursor-pointer hover:border-los/70",
        cls === "best" ? "border-l-2 border-l-grade-green" : "border-l-2 border-l-grade-red"
      )}
    >
      <div className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {x ? (
        <>
          <div className="flex items-baseline gap-2.5">
            <ScorePill s={x.avg} />
            <span className="truncate font-semibold text-foreground">{x.d.name || x.d.id}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {x.reps.length} essai{x.reps.length > 1 ? "s" : ""} · {SIDE_LABEL[x.d.side] || ""}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">–</div>
      )}
    </button>
  );

  return (
    <section className="glass rounded-2xl border border-border/70 p-4" aria-label="Synthèse de la séance">
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Bilan de séance</h2>
          <div className="text-[13px] text-muted-foreground">
            {session.label}
            {session.date ? ` · ${session.date}` : ""}
            {session.opponent ? ` · opposition ${session.opponent}` : ""}
          </div>
        </div>
        <div className="flex gap-3.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-grade-green" />
            Bien
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-grade-orange" />
            À revoir
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm bg-grade-red" />
            À corriger
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))]">
        <div className="glass col-span-2 flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 p-3 lg:col-span-1">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground">Essais</div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-3xl font-extrabold leading-none tnum">{total}</span>
            <span className="text-xs text-muted-foreground">{drills.length} drills</span>
          </div>
          <StackedBar grades={g} height={22} labels />
          <div className="flex flex-wrap gap-3.5 text-xs font-semibold">
            <span className="g-green">{pct(g.green, total)} % bien</span>
            <span className="g-orange">{pct(g.orange, total)} % à revoir</span>
            <span className="g-red">{pct(g.red, total)} % à corriger</span>
          </div>
        </div>
        <SideBox label="Score moyen attaque" arr={off} />
        <SideBox label="Score moyen défense" arr={def} />
        <DrillBox label="Drill le mieux exécuté" x={best} cls="best" />
        <DrillBox label="Drill le moins bien exécuté" x={worst} cls="worst" />
      </div>
    </section>
  );
}

// --------------------------------------------------------------- players tab
type SortKey = "name" | "group" | "n" | "avg" | "worst";
function PlayersTab({
  players,
  onOpenDetail,
}: {
  players: PlayerAgg[];
  onOpenDetail: (id: string) => void;
}) {
  const [group, setGroup] = React.useState<string>("ALL");
  const [sortKey, setSortKey] = React.useState<SortKey>("avg");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const present = GROUPS.filter((g) => players.some((p) => p.group === g));
  const filtered = group === "ALL" ? players : players.filter((p) => p.group === group);

  const sortVal = (p: PlayerAgg): number | string => {
    switch (sortKey) {
      case "name":
        return p.name.toLowerCase();
      case "group":
        return GROUPS.indexOf(p.group);
      case "n":
        return p.n;
      case "avg":
        return p.avg ?? -1;
      case "worst":
        return p.worst ? p.worst.ko : -1;
    }
  };
  const rows = filtered.slice().sort((a, b) => {
    const va = sortVal(a),
      vb = sortVal(b);
    const r = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "asc" ? r : -r;
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "group" ? "asc" : "desc");
    }
  };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "");

  const chips: [string, string][] = [["ALL", "Tous"], ...present.map((g) => [g, g] as [string, string])];

  if (!players.length)
    return <p className="py-3 italic text-muted-foreground">Aucun joueur suivi.</p>;

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par groupe">
          {chips.map(([k, l]) => {
            const n = k === "ALL" ? players.length : players.filter((p) => p.group === k).length;
            const active = group === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setGroup(k)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors",
                  active
                    ? "border-ours bg-ours text-white"
                    : "border-border/70 bg-card/40 hover:border-los/70"
                )}
              >
                {l}
                <span className={cn("text-xs", active ? "text-white/80" : "text-muted-foreground")}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">
          Clique sur un joueur pour sa fiche détaillée
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full border-collapse text-sm tnum">
          <thead>
            <tr>
              {(
                [
                  ["name", "Joueur", false],
                  ["group", "Groupe", false],
                  ["n", "Essais", true],
                  ["avg", "Score moy.", true],
                  [null, "Progression", false],
                  ["worst", "Erreur récurrente", false],
                  [null, "Point fort", false],
                ] as [SortKey | null, string, boolean][]
              ).map(([k, label, right], i) => (
                <th
                  key={i}
                  className={cn(
                    "border-b border-border/70 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    right && "text-right"
                  )}
                >
                  {k ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(k)}
                      className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                    >
                      {label}
                      <span className="text-[9px] text-los">{arrow(k)}</span>
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((p) => (
                <tr
                  key={p.id}
                  tabIndex={0}
                  onClick={() => onOpenDetail(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenDetail(p.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none",
                    p.n < 3 && "opacity-60"
                  )}
                  title={p.n < 3 ? "Peu d'essais : à interpréter avec prudence" : ""}
                >
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ours text-[13px] font-extrabold text-white">
                        {p.jersey ?? ""}
                      </span>
                      <span>
                        <strong className="whitespace-nowrap">{p.name}</strong>
                        <small className="block text-muted-foreground">{p.position}</small>
                      </span>
                    </div>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <span className="rounded border border-border/70 bg-card/40 px-1.5 py-0.5 text-xs font-bold">
                      {p.group}
                    </span>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5 text-right">{p.n}</td>
                  <td className="border-b border-border/60 px-3 py-2.5 text-right">
                    <ScorePill s={p.avg} />
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <Sparkline scores={p.scores} grades={p.reps.map((r) => r.pr.grade)} />
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    {p.worst ? (
                      <>
                        <span className="font-semibold text-grade-red">{p.worst.label}</span>
                        <small className="block text-muted-foreground">
                          {p.worst.ko} fois sur {p.worst.ok + p.worst.ko}
                        </small>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {p.metricStats.length ? "Rien de récurrent" : "Pas de mesure"}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    {p.best ? (
                      <>
                        <span className="font-semibold text-grade-green">{p.best.label}</span>
                        <small className="block text-muted-foreground">
                          {p.best.ok}/{p.best.ok + p.best.ko} réussis
                        </small>
                      </>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center italic text-muted-foreground">
                  Aucun joueur dans ce groupe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- player detail
function PlayerDetail({
  p,
  onClose,
  onOpenRep,
}: {
  p: PlayerAgg;
  onClose: () => void;
  onOpenRep: (id: string) => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const metrics = p.metricStats
    .filter((m) => m.ok + m.ko > 0 || m.values.length)
    .sort((a, b) => b.ko / Math.max(1, b.ok + b.ko) - a.ko / Math.max(1, a.ok + a.ko));
  const feedbacks = p.reps.filter((r) => r.pr.feedback);
  const first = mean(p.scores.slice(0, Math.ceil(p.scores.length / 2)));
  const last = mean(p.scores.slice(Math.ceil(p.scores.length / 2)));
  const delta = first !== null && last !== null && p.scores.length >= 4 ? last - first : null;
  const trendTxt =
    delta === null
      ? ""
      : Math.abs(delta) < 3
        ? "Stable sur la séance"
        : delta > 0
          ? `En progrès : +${fmt(delta)} pts en 2e moitié`
          : `En baisse : ${fmt(delta)} pts en 2e moitié`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Fiche ${p.name}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className="glass w-full max-w-[1040px] rounded-2xl border border-border/70 shadow-2xl shadow-black/50"
      >
        <header className="flex flex-wrap items-center gap-5 border-b border-border/70 p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-ours text-[17px] font-extrabold text-white">
              {p.jersey ?? ""}
            </span>
            <span>
              <strong className="font-display text-xl">{p.name}</strong>
              <small className="block text-muted-foreground">
                {p.position} · {p.group} · {p.n} essai{p.n > 1 ? "s" : ""}
              </small>
            </span>
          </div>
          <div className="ml-auto flex items-end gap-5">
            <div className="flex flex-col gap-1">
              <small className="text-muted-foreground">Score moyen</small>
              <ScorePill s={p.avg} />
            </div>
            <div className="flex w-48 flex-col gap-1">
              <small className="text-muted-foreground">Répartition</small>
              <StackedBar grades={p.grades} height={12} labels />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-9 place-items-center rounded-lg border border-border/70 bg-card/40 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="p-4">
          <section>
            <h3 className="mb-2 flex flex-wrap items-baseline gap-2 font-display text-[15px] font-semibold">
              Score essai par essai
              <small className="font-normal text-muted-foreground">
                {trendTxt}
                {trendTxt ? " · " : ""}clique un point pour ouvrir le replay
              </small>
            </h3>
            <ScoreChart player={p} onOpenRep={onOpenRep} />
          </section>

          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <section>
              <h3 className="mb-2 font-display text-[15px] font-semibold">Métriques</h3>
              {metrics.length ? (
                <table className="w-full border-collapse text-sm tnum">
                  <thead>
                    <tr>
                      <th className="border-b border-border/70 px-2 py-1.5 text-left text-xs font-semibold uppercase text-muted-foreground">
                        Critère
                      </th>
                      <th className="border-b border-border/70 px-2 py-1.5 text-right text-xs font-semibold uppercase text-muted-foreground">
                        Moyenne
                      </th>
                      <th className="border-b border-border/70 px-2 py-1.5 text-right text-xs font-semibold uppercase text-muted-foreground">
                        Réussi
                      </th>
                      <th className="border-b border-border/70 px-2 py-1.5 text-left text-xs font-semibold uppercase text-muted-foreground">
                        Taux
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => {
                      const judged = m.ok + m.ko;
                      const rate = judged ? pct(m.ok, judged) : null;
                      const avg = mean(m.values);
                      const cls =
                        rate === null
                          ? "bg-muted-foreground"
                          : rate >= 75
                            ? "bg-grade-green"
                            : rate >= 50
                              ? "bg-grade-orange"
                              : "bg-grade-red";
                      return (
                        <tr key={m.key}>
                          <td className="border-b border-border/60 px-2 py-1.5">{m.label}</td>
                          <td className="border-b border-border/60 px-2 py-1.5 text-right">
                            {avg === null
                              ? "–"
                              : `${fmt(avg, Math.abs(avg) < 10 ? 2 : 1)}${m.unit ? " " + m.unit : ""}`}
                          </td>
                          <td className="border-b border-border/60 px-2 py-1.5 text-right">
                            {judged ? `${m.ok}/${judged}` : "–"}
                          </td>
                          <td className="border-b border-border/60 px-2 py-1.5">
                            <div className="h-1.5 min-w-[70px] overflow-hidden rounded-full bg-muted/50">
                              {rate !== null && (
                                <div className={cn("h-full rounded-full", cls)} style={{ width: `${rate}%` }} />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="italic text-muted-foreground">Pas de métrique mesurée.</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-display text-[15px] font-semibold">Retours donnés</h3>
              {feedbacks.length ? (
                <ul className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
                  {feedbacks.map((r) => {
                    const g = gradeOf(r.pr.grade);
                    const dot =
                      g === "green"
                        ? "bg-grade-green"
                        : g === "orange"
                          ? "bg-grade-orange"
                          : g === "red"
                            ? "bg-grade-red"
                            : "bg-muted-foreground";
                    return (
                      <li key={String(r.rep.id)}>
                        <button
                          type="button"
                          onClick={() => onOpenRep(String(r.rep.id))}
                          className="grid w-full grid-cols-[10px_1fr_auto] items-center gap-x-2.5 rounded-lg border border-transparent bg-card/40 px-2.5 py-2 text-left transition-colors hover:border-los/70"
                        >
                          <span className={cn("row-span-2 mt-1 size-2.5 self-start rounded-full", dot)} />
                          <span className="text-[11.5px] text-muted-foreground">
                            Essai {r.rep.index ?? ""} · {r.rep.label || ""}
                          </span>
                          <span className="col-start-3 row-span-2 self-center font-bold text-muted-foreground">
                            {fmt(num(r.pr.score))}
                          </span>
                          <span className="col-start-2 text-[13.5px]">{r.pr.feedback}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="italic text-muted-foreground">Aucun retour enregistré.</p>
              )}
            </section>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------- plays tab
function PlaysTab({ plays, onOpenRep }: { plays: PlayAgg[]; onOpenRep: (id: string) => void }) {
  if (!plays.length) return <p className="py-3 italic text-muted-foreground">Aucun essai.</p>;
  const eligible = plays.filter((p) => p.n >= 2 && p.avg !== null).sort((a, b) => (b.avg as number) - (a.avg as number));
  const top = eligible.slice(0, 3);
  const bottom = eligible.slice(-3).reverse().filter((p) => !top.includes(p));

  const Card = ({ p, cls }: { p: PlayAgg; cls: "good" | "bad" }) => (
    <li
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border border-border/70 bg-card/40 px-3 py-2",
        cls === "good" ? "border-l-2 border-l-grade-green" : "border-l-2 border-l-grade-red"
      )}
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {SIDE_LABEL[p.side]}
      </span>
      <strong>{p.label}</strong>
      <span className="flex items-center gap-1.5">
        <ScorePill s={p.avg} />
        <span className="text-xs text-muted-foreground">
          sur {p.n} essais · {p.greenRate} % vert
        </span>
      </span>
    </li>
  );

  const SideBlock = ({ side }: { side: string }) => {
    const list = plays.filter((p) => p.side === side).sort((a, b) => b.n - a.n);
    if (!list.length) return null;
    return (
      <>
        <h3 className="mb-2 mt-4 flex items-baseline gap-2 font-display text-[15px] font-semibold">
          {SIDE_LABEL[side]}
          <small className="font-normal text-muted-foreground">
            {side === "defense" ? "formation adverse · couverture jouée" : "formation"}
          </small>
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full border-collapse text-sm tnum">
            <thead>
              <tr>
                {["Jeu", "Nb", "Score moy.", "Taux vert", "Gain moy.", "Résultats", "Essais"].map(
                  (h, i) => (
                    <th
                      key={i}
                      className={cn(
                        "border-b border-border/70 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        (i === 1 || i === 2 || i === 4) && "text-right"
                      )}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.key}>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <strong>{p.label}</strong>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5 text-right">{p.n}</td>
                  <td className="border-b border-border/60 px-3 py-2.5 text-right">
                    <ScorePill s={p.avg} />
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <div className="flex min-w-[80px] flex-col gap-1">
                      <span className="text-right">{p.greenRate} %</span>
                      <StackedBar grades={p.grades} height={6} />
                    </div>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5 text-right">
                    {p.yards === null ? "–" : `${fmt(p.yards, 1)} yds`}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(p.results)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <span
                            key={k}
                            className="whitespace-nowrap rounded border border-border/70 bg-card/40 px-1.5 py-0.5 text-xs"
                          >
                            {RESULT_LABEL[k] || "Autre"} {v}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2.5">
                    <Dots reps={p.reps} onOpenRep={onOpenRep} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-display text-[15px] font-semibold g-green">Ce qui marche</h3>
          {top.length ? (
            <ul className="flex flex-col gap-1.5">
              {top.map((p) => (
                <Card key={p.key} p={p} cls="good" />
              ))}
            </ul>
          ) : (
            <p className="italic text-muted-foreground">Pas assez d'essais répétés.</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-display text-[15px] font-semibold g-red">Ce qui pose problème</h3>
          {bottom.length ? (
            <ul className="flex flex-col gap-1.5">
              {bottom.map((p) => (
                <Card key={p.key} p={p} cls="bad" />
              ))}
            </ul>
          ) : (
            <p className="italic text-muted-foreground">Rien à signaler.</p>
          )}
        </div>
      </div>
      <SideBlock side="offense" />
      <SideBlock side="defense" />
    </div>
  );
}

// --------------------------------------------------------------- drills tab
function DrillsTab({
  drills,
  flashId,
  onOpenRep,
}: {
  drills: DrillAgg[];
  flashId: string | null;
  onOpenRep: (id: string) => void;
}) {
  if (!drills.length)
    return <p className="py-3 italic text-muted-foreground">Aucun drill dans cette séance.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {drills.map(({ d, reps, avg, grades }) => {
        const coach = (d.brief as { coach?: string } | undefined)?.coach;
        return (
          <li
            key={d.id}
            id={`rp-drill-${d.id}`}
            className={cn(
              "glass flex flex-col gap-2.5 rounded-xl border p-3 transition-colors",
              flashId === d.id ? "border-los" : "border-border/70"
            )}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 bg-card/40 text-[13px] font-bold tnum">
                {d.index ?? ""}
              </span>
              <div className="flex-1">
                <strong>{d.name || d.id}</strong>
                <small className="block text-muted-foreground">
                  {SIDE_LABEL[d.side] || ""} · {reps.length} essai{reps.length > 1 ? "s" : ""}
                </small>
              </div>
              <ScorePill s={avg} />
              <div className="w-40">
                <StackedBar
                  grades={{ green: grades.green || 0, orange: grades.orange || 0, red: grades.red || 0 }}
                  height={8}
                />
              </div>
            </div>
            <Dots reps={reps} big onOpenRep={onOpenRep} />
            {coach ? (
              <p className="text-[13.5px] text-foreground/90">
                <span className="mr-2 text-[11px] font-bold uppercase tracking-wide text-los">
                  Brief coach
                </span>
                {coach}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ----------------------------------------------------------------------- main
type TabName = "players" | "plays" | "drills";
const TAB_KEY = "rp-tab";

export function ReportsView({ onOpenRep }: { onOpenRep: (id: string) => void }) {
  const session = useStore((s) => s.session);
  const [tab, setTab] = React.useState<TabName>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY);
      return t === "plays" || t === "drills" ? t : "players";
    } catch {
      return "players";
    }
  });
  const [detail, setDetail] = React.useState<string | null>(null);
  const [flashId, setFlashId] = React.useState<string | null>(null);

  const { reps, drills, players, plays } = React.useMemo(() => {
    if (!session)
      return {
        reps: [] as Rep[],
        drills: [] as DrillAgg[],
        players: [] as PlayerAgg[],
        plays: [] as PlayAgg[],
      };
    const r = (Array.isArray(session.reps) ? session.reps : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const repById = new Map(r.map((x) => [String(x.id), x]));
    return {
      reps: r,
      drills: drillStats(session, repById),
      players: aggregatePlayers(session, r),
      plays: aggregatePlays(r),
    };
  }, [session]);

  const selectTab = (t: TabName) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const gotoDrill = (id: string) => {
    selectTab("drills");
    setFlashId(id);
    requestAnimationFrame(() => {
      document.getElementById(`rp-drill-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    window.setTimeout(() => setFlashId(null), 1600);
  };

  if (!session) return null;

  const TABS: [TabName, string][] = [
    ["players", "Par joueur"],
    ["plays", "Par jeu"],
    ["drills", "Par drill"],
  ];
  const detailPlayer = detail ? players.find((p) => p.id === detail) ?? null : null;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 tnum">
      <Summary session={session} reps={reps} drills={drills} onGotoDrill={gotoDrill} />

      <nav className="flex gap-1 border-b border-border/70" role="tablist">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => selectTab(k)}
            className={cn(
              "relative -mb-px border-b-2 px-4 py-2.5 text-[15px] font-semibold transition-colors",
              tab === k
                ? "border-ours text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {l}
          </button>
        ))}
      </nav>

      <div role="tabpanel">
        {tab === "players" && <PlayersTab players={players} onOpenDetail={setDetail} />}
        {tab === "plays" && <PlaysTab plays={plays} onOpenRep={onOpenRep} />}
        {tab === "drills" && <DrillsTab drills={drills} flashId={flashId} onOpenRep={onOpenRep} />}
      </div>

      <AnimatePresence>
        {detailPlayer && (
          <PlayerDetail
            key={detailPlayer.id}
            p={detailPlayer}
            onClose={() => setDetail(null)}
            onOpenRep={(id) => {
              setDetail(null);
              onOpenRep(id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
