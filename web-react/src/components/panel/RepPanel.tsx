// Panneau latéral d'essai : onglets "Essai" / "Brief du drill",
// carte du joueur sélectionné (retour + métriques + TTS) et roster TB groupé.
import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { AnimatePresence, motion } from "motion/react";
import { Volume2, X } from "lucide-react";
import { useStore } from "@/store";
import type { Drill, Grade, Metric, Rep, RepPlayer, Session } from "@/types";
import { GRADE_LABEL } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import * as tts from "@/lib/tts";

// --------------------------------------------------------------------- consts
const GROUP_ORDER = ["QB", "OL", "RB", "WR", "TE", "DL", "LB", "DB"];
const GROUP_LABEL: Record<string, string> = {
  QB: "Quarterback",
  OL: "Ligne offensive",
  RB: "Running backs",
  WR: "Receveurs",
  TE: "Tight ends",
  DL: "Ligne défensive",
  LB: "Linebackers",
  DB: "Arrière-garde",
};
const POINT_META: Record<string, { icon: string; label: string }> = {
  good: { icon: "✓", label: "Ce qui marche" },
  fix: { icon: "!", label: "À corriger" },
  next: { icon: "→", label: "Prochain essai" },
};
const PASS_RESULT: Record<string, string> = {
  C: "Complète",
  I: "Incomplète",
  S: "Sack",
  IN: "Interception",
  R: "Scramble",
};

const GRADE_PILL: Record<Grade, string> = {
  green: "bg-grade-green/15 text-grade-green",
  orange: "bg-grade-orange/15 text-grade-orange",
  red: "bg-grade-red/15 text-grade-red",
};
const GRADE_BORDER: Record<Grade, string> = {
  green: "border-grade-green/50",
  orange: "border-grade-orange/50",
  red: "border-grade-red/50",
};
const GRADE_DOT: Record<Grade, string> = {
  green: "bg-grade-green",
  orange: "bg-grade-orange",
  red: "bg-grade-red",
};
const GRADE_BIG: Record<Grade, string> = {
  green: "text-grade-green bg-grade-green/10 border-grade-green/40",
  orange: "text-grade-orange bg-grade-orange/10 border-grade-orange/40",
  red: "text-grade-red bg-grade-red/10 border-grade-red/40",
};

// ------------------------------------------------------------------- helpers
function fmtVal(v: number | string | null | undefined): string {
  if (v == null) return "–";
  if (typeof v === "number") return (Math.round(v * 100) / 100).toLocaleString("fr-FR");
  return String(v);
}

function metricState(ok: boolean | null | undefined): "ok" | "ko" | "na" {
  return ok === true ? "ok" : ok === false ? "ko" : "na";
}

// Hook: s'abonne à l'état TTS et renvoie l'id en cours de lecture.
function useSpeakingId(): string | null {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(
    () => tts.onChange(({ speaking, id }) => setId(speaking ? id : null)),
    []
  );
  return id;
}

interface EnrichedPlayer extends RepPlayer {
  id: string;
  name: string;
  jersey?: number;
  position?: string;
  group: string;
  ours: boolean;
}

// -------------------------------------------------------------------- TTS btn
function SpeakButton({
  text,
  id,
  label = "Écouter le retour",
}: {
  text: string;
  id: string;
  label?: string;
}) {
  const speakingId = useSpeakingId();
  const speaking = speakingId === id;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => (speaking ? tts.stop() : tts.speak(text, { id }))}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        speaking
          ? "border-primary bg-primary/20 text-primary"
          : "border-border/70 bg-card/40 text-muted-foreground hover:text-foreground"
      )}
    >
      <motion.span
        animate={speaking ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={speaking ? { duration: 1, repeat: Infinity } : { duration: 0.2 }}
      >
        <Volume2 className="size-4" />
      </motion.span>
    </button>
  );
}

// --------------------------------------------------------------- rep sub-view
function Jersey({ n, them = false }: { n: React.ReactNode; them?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold tnum text-white",
        them ? "bg-them" : "bg-ours"
      )}
    >
      {n}
    </span>
  );
}

function MetricRow({ m }: { m: Metric }) {
  const st = metricState(m.ok);
  const dot =
    st === "ok" ? "bg-grade-green" : st === "ko" ? "bg-grade-red" : "bg-muted-foreground/50";
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
      <span className="flex-1 text-[13px] text-foreground/85">{m.label}</span>
      <b className="tnum text-sm font-bold text-foreground">
        {fmtVal(m.value)}
        {m.value != null && m.unit ? (
          <small className="ml-0.5 font-normal text-muted-foreground">{m.unit}</small>
        ) : null}
      </b>
    </li>
  );
}

function SelectedCard({
  sel,
  repId,
  onUnselect,
}: {
  sel: EnrichedPlayer;
  repId: string;
  onUnselect: () => void;
}) {
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "glass rounded-2xl border p-3.5 shadow-lg",
        GRADE_BORDER[sel.grade]
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-sm font-semibold text-foreground">
          <Jersey n={sel.jersey} />
          <span className="leading-tight">
            {sel.name}{" "}
            <small className="block text-[11px] font-normal text-muted-foreground">
              {sel.pos || sel.position} · {sel.role || ""}
            </small>
          </span>
        </h3>
        <button
          type="button"
          onClick={onUnselect}
          aria-label="Désélectionner"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-2 flex items-start gap-2">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold tnum",
            GRADE_PILL[sel.grade]
          )}
        >
          {GRADE_LABEL[sel.grade]}
          {sel.score != null ? ` · ${sel.score}` : ""}
        </span>
      </div>
      <blockquote className="border-l-2 border-border pl-3 text-[13.5px] leading-snug text-foreground/90">
        {sel.feedback || "Pas de retour pour cet essai."}
      </blockquote>
      {sel.feedback ? (
        <div className="mt-2">
          <SpeakButton text={sel.feedback} id={`fb:${repId}:${sel.id}`} />
        </div>
      ) : null}

      {sel.metrics && sel.metrics.length ? (
        <ul className="mt-2 divide-y divide-border/50 border-t border-border/50 pt-1">
          {sel.metrics.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}
        </ul>
      ) : null}
    </motion.section>
  );
}

function RepTab({
  rep,
  session,
  selected,
  onSelect,
}: {
  rep: Rep | null;
  session: Session | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!rep || !session) {
    return (
      <p className="py-10 text-center text-sm italic text-muted-foreground">
        Choisis un essai dans la timeline.
      </p>
    );
  }

  const enriched: EnrichedPlayer[] = Object.entries(rep.players || {}).map(([id, p]) => {
    const meta = session.players[id];
    return {
      ...p,
      id,
      name: meta?.name || id,
      jersey: meta?.jersey,
      position: meta?.position,
      group: meta?.group || "Autres",
      ours: meta?.ours ?? true,
    };
  });

  const byGroup: Record<string, EnrichedPlayer[]> = {};
  enriched.forEach((p) => {
    (byGroup[p.group] = byGroup[p.group] || []).push(p);
  });
  const groups = Object.keys(byGroup).sort(
    (a, b) =>
      (GROUP_ORDER.indexOf(a) + 99) % 99 - (GROUP_ORDER.indexOf(b) + 99) % 99
  );

  const sel = selected ? enriched.find((p) => p.id === selected) ?? null : null;
  const selOther = selected && !sel ? session.players[selected] : null;

  const result = rep.passResult ? PASS_RESULT[rep.passResult] ?? rep.passResult : "";
  const gain =
    rep.playResult != null ? `${rep.playResult > 0 ? "+" : ""}${rep.playResult} yd` : "";

  const facts: { label: string; value: string }[] = [];
  if (rep.formation)
    facts.push({ label: "Formation", value: rep.formation.replace(/_/g, " ").toLowerCase() });
  if (rep.coverage) facts.push({ label: "Couverture", value: rep.coverage });
  if (result) facts.push({ label: "Résultat", value: result });
  if (gain) facts.push({ label: "Gain", value: gain });

  return (
    <div className="flex flex-col gap-3">
      {/* Infos essai */}
      <section className="glass rounded-2xl border border-border/70 p-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border leading-none",
              GRADE_BIG[rep.grade]
            )}
          >
            <b className="text-2xl font-extrabold tnum">{rep.score ?? "–"}</b>
            <small className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
              {GRADE_LABEL[rep.grade]}
            </small>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Essai {rep.index} · {rep.side === "offense" ? "Attaque" : "Défense"} · Q
              {rep.quarter} {rep.gameClock || ""}
            </p>
            <h2 className="font-display text-lg font-bold leading-tight text-foreground">
              {rep.label}
            </h2>
          </div>
        </div>

        {rep.coachSummary ? (
          <p className="mt-2.5 text-[13.5px] leading-snug text-foreground/85">
            {rep.coachSummary}
          </p>
        ) : null}

        {facts.length ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {facts.map((f) => (
              <span
                key={f.label}
                className="flex flex-col rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5"
              >
                <small className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </small>
                <b className="text-[13px] font-semibold capitalize text-foreground">{f.value}</b>
              </span>
            ))}
          </div>
        ) : null}

        {rep.description ? (
          <details className="group mt-3 text-[13px]">
            <summary className="cursor-pointer list-none select-none text-muted-foreground transition-colors hover:text-foreground">
              <span className="font-semibold">Description officielle</span>
              <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <p className="mt-1.5 leading-snug text-foreground/75">{rep.description}</p>
          </details>
        ) : null}
      </section>

      {/* Joueur sélectionné */}
      <AnimatePresence mode="popLayout">
        {sel ? (
          <SelectedCard
            key={sel.id}
            sel={sel}
            repId={String(rep.id)}
            onUnselect={() => onSelect(null)}
          />
        ) : selOther ? (
          <motion.section
            key="other"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass rounded-2xl border border-border/70 p-3.5"
          >
            <div className="mb-1.5 flex items-start gap-2">
              <h3 className="flex flex-1 items-center gap-2 text-sm font-semibold text-foreground">
                <Jersey n={selOther.jersey} them={!selOther.ours} />
                <span className="leading-tight">
                  {selOther.name}{" "}
                  <small className="block text-[11px] font-normal text-muted-foreground">
                    {selOther.team} · {selOther.position}
                  </small>
                </span>
              </h3>
              <button
                type="button"
                onClick={() => onSelect(null)}
                aria-label="Désélectionner"
                className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {selOther.ours
                ? "Ce joueur ne participe pas à cet essai."
                : "Joueur adverse : pas de retour individuel."}
            </p>
          </motion.section>
        ) : (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-[13px] text-muted-foreground"
          >
            Clique un joueur rouge sur le terrain ou dans la liste pour voir son retour.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Roster TB */}
      <section>
        <h3 className="mb-2 flex items-baseline gap-2 font-display text-base font-bold text-foreground">
          Joueurs TB sur l'essai
          <small className="tnum text-xs font-normal text-muted-foreground">
            {enriched.length}
          </small>
        </h3>
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g}>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABEL[g] || g}
              </h4>
              <ul className="flex flex-col gap-1">
                {byGroup[g]
                  .slice()
                  .sort((a, b) => (a.jersey || 0) - (b.jersey || 0))
                  .map((p) => {
                    const active = p.id === selected;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(active ? null : p.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                            "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                            active
                              ? "border-primary/60 bg-primary/10"
                              : "border-transparent hover:bg-accent/40"
                          )}
                        >
                          <span
                            className={cn("size-2.5 shrink-0 rounded-full", GRADE_DOT[p.grade])}
                            title={GRADE_LABEL[p.grade]}
                            aria-hidden="true"
                          />
                          <span className="tnum w-6 text-right text-[13px] font-bold text-muted-foreground">
                            {p.jersey}
                          </span>
                          <span className="flex-1 truncate text-[13.5px] text-foreground">
                            {p.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {p.pos || p.position || ""}
                          </span>
                          <span className="tnum w-6 text-right text-[13px] font-bold text-foreground/80">
                            {p.score ?? ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------- brief sub-view
interface BriefPoint {
  kind: string;
  text: string;
}
interface BriefPlayerShape {
  text?: string;
  points?: BriefPoint[];
}
interface BriefShape {
  coach?: string;
  groups?: Record<string, string>;
  players?: Record<string, BriefPlayerShape>;
}

function BriefTab({
  drill,
  session,
  selected,
  onSelect,
}: {
  drill: Drill | null;
  session: Session | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!drill || !session) {
    return (
      <p className="py-10 text-center text-sm italic text-muted-foreground">
        Aucun drill pour cet essai.
      </p>
    );
  }
  const b = (drill.brief || {}) as BriefShape;
  const summary = ((drill as unknown as { summary?: Record<Grade, number> }).summary) || {
    green: 0,
    orange: 0,
    red: 0,
  };
  const groups = Object.entries(b.groups || {}).sort(
    (a, c) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(c[0])
  );
  const pb = selected ? b.players?.[selected] : null;
  const pm = selected ? session.players[selected] : null;
  const briefPlayers = Object.keys(b.players || {})
    .map((id) => ({ id, meta: session.players[id] }))
    .filter((x) => x.meta)
    .sort(
      (a, c) =>
        GROUP_ORDER.indexOf(a.meta!.group || "") - GROUP_ORDER.indexOf(c.meta!.group || "")
    );

  const playerText = pb ? pb.text || (pb.points || []).map((p) => p.text).join(" ") : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold leading-tight text-foreground">
            {drill.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {drill.repIds.length} essais ·
            <span className="tnum font-bold g-green">{summary.green || 0}</span>
            <span className="tnum font-bold g-orange">{summary.orange || 0}</span>
            <span className="tnum font-bold g-red">{summary.red || 0}</span>
          </p>
        </div>
      </div>

      {/* Coach */}
      <section className="glass rounded-2xl border border-border/70 p-3.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Pour l'entraîneur</h3>
          {b.coach ? (
            <SpeakButton
              text={b.coach}
              id={`coach:${drill.id}`}
              label="Écouter le brief entraîneur"
            />
          ) : null}
        </div>
        <p className="text-[13.5px] leading-snug text-foreground/85">
          {b.coach || "Pas de brief pour ce drill."}
        </p>
      </section>

      {/* Brief individuel */}
      <section className="glass rounded-2xl border border-border/70 p-3.5">
        {pb && pm ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Jersey n={pm.jersey} />
                <span className="leading-tight">
                  {pm.name}{" "}
                  <small className="block text-[11px] font-normal text-muted-foreground">
                    {pm.position}
                  </small>
                </span>
              </h3>
              {playerText ? (
                <SpeakButton
                  text={playerText}
                  id={`brief:${drill.id}:${selected}`}
                  label="Écouter le brief du joueur"
                />
              ) : null}
            </div>
            <ol className="flex flex-col gap-1.5">
              {(pb.points || []).map((p, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-2"
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                      p.kind === "good"
                        ? "bg-grade-green/20 text-grade-green"
                        : p.kind === "fix"
                          ? "bg-grade-red/20 text-grade-red"
                          : "bg-primary/20 text-primary"
                    )}
                    aria-hidden="true"
                  >
                    {POINT_META[p.kind]?.icon || "•"}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <small className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      {POINT_META[p.kind]?.label || ""}
                    </small>
                    <span className="text-[13px] text-foreground/90">{p.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Brief individuel</h3>
            <p className="mb-2.5 text-[13px] text-muted-foreground">
              {selected && pm
                ? `${pm.name} n'a pas de brief sur ce drill.`
                : "Choisis un joueur TB pour voir son brief en 3 points."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {briefPlayers.slice(0, 14).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/40 px-2.5 py-1 text-[12.5px] font-semibold transition-colors hover:bg-accent/40"
                >
                  <b className="tnum text-primary">{p.meta!.jersey}</b>
                  {p.meta!.name.split(" ").slice(-1)[0]}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Par groupe */}
      {groups.length ? (
        <section className="glass rounded-2xl border border-border/70 p-3.5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Par groupe</h3>
          <dl className="flex flex-col gap-2.5">
            {groups.map(([g, t]) => (
              <div key={g}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABEL[g] || g}
                </dt>
                <dd className="mt-0.5 text-[13px] leading-snug text-foreground/85">{t}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------- main
export function RepPanel() {
  const rep = useStore((s) => s.rep);
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const drillsById = useStore((s) => s.drillsById);
  const [tab, setTab] = React.useState<"rep" | "brief">("rep");

  const drill = rep ? drillsById[rep.drillId] ?? null : null;

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as "rep" | "brief")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Tabs.List
        className="relative flex shrink-0 gap-1 border-b border-border/70 px-1"
        aria-label="Panneau d'essai"
      >
        {([
          ["rep", "Essai"],
          ["brief", "Brief du drill"],
        ] as const).map(([value, label]) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className={cn(
              "relative px-4 py-2.5 text-sm font-semibold transition-colors outline-none",
              "cursor-pointer data-[state=active]:text-foreground",
              "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            {tab === value && (
              <motion.span
                layoutId="rep-panel-tab"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Tabs.Content value="rep" className="outline-none">
          <RepTab rep={rep} session={session} selected={selected} onSelect={select} />
        </Tabs.Content>
        <Tabs.Content value="brief" className="outline-none">
          <BriefTab drill={drill} session={session} selected={selected} onSelect={select} />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
