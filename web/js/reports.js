// Rapports post-séance — vanilla JS, SVG inline, aucune dépendance.
// export function renderReports(container, session, { onOpenRep })

const GROUPS = ["OL", "QB", "WR", "TE", "RB", "DL", "LB", "DB"];
const GRADE_LABEL = { green: "Bien", orange: "À revoir", red: "À corriger" };
const RESULT_LABEL = { C: "Complétée", I: "Incomplète", S: "Sack", IN: "INT", R: "Scramble" };
const SIDE_LABEL = { offense: "Attaque", defense: "Défense" };
const FORMATION_LABEL = {
  SHOTGUN: "Shotgun", EMPTY: "Empty", SINGLEBACK: "Singleback", I_FORM: "I-Form",
  PISTOL: "Pistol", JUMBO: "Jumbo", WILDCAT: "Wildcat",
};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mean = (arr) => {
  const xs = arr.map(num).filter((x) => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const fmt = (v, d = 0) => (num(v) === null ? "–" : v.toFixed(d).replace(".", ","));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const gradeOf = (g) => (g === "green" || g === "orange" || g === "red" ? g : "none");
const scoreClass = (s) => (num(s) === null ? "none" : s >= 70 ? "green" : s >= 45 ? "orange" : "red");
const formationLabel = (f) => FORMATION_LABEL[f] || (f ? String(f).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Formation inconnue");

// ---------------------------------------------------------------------------
// Agrégations

function countGrades(items) {
  const c = { green: 0, orange: 0, red: 0 };
  for (const it of items) if (c[it?.grade] !== undefined) c[it.grade]++;
  return c;
}

function aggregatePlayers(session, reps) {
  const players = session.players || {};
  const byId = new Map();
  for (const rep of reps) {
    for (const [pid, pr] of Object.entries(rep.players || {})) {
      const meta = players[pid];
      if (meta && meta.ours === false) continue;
      if (!byId.has(pid)) {
        byId.set(pid, {
          id: pid, meta: meta || { name: `#${pid}`, group: "?" }, reps: [],
        });
      }
      byId.get(pid).reps.push({ rep, pr: pr || {} });
    }
  }
  const out = [];
  for (const p of byId.values()) {
    p.reps.sort((a, b) => (a.rep.index ?? 0) - (b.rep.index ?? 0));
    const scores = p.reps.map((r) => num(r.pr.score));
    const metricStats = new Map();
    for (const { pr } of p.reps) {
      for (const m of Array.isArray(pr.metrics) ? pr.metrics : []) {
        if (!m || !m.key) continue;
        let st = metricStats.get(m.key);
        if (!st) {
          st = { key: m.key, label: m.label || m.key, unit: m.unit || "", n: 0, ok: 0, ko: 0, values: [] };
          metricStats.set(m.key, st);
        }
        st.n++;
        if (m.ok === true) st.ok++;
        else if (m.ok === false) st.ko++;
        if (num(m.value) !== null) st.values.push(m.value);
      }
    }
    const stats = [...metricStats.values()];
    const judged = stats.filter((s) => s.ok + s.ko > 0);
    const minRep = p.reps.length >= 3 ? 2 : 1;
    const worst = judged.filter((s) => s.ko >= minRep)
      .sort((a, b) => b.ko - a.ko || b.ko / (b.ok + b.ko) - a.ko / (a.ok + a.ko))[0] || null;
    const best = judged.filter((s) => s.ok >= minRep && (!worst || s.key !== worst.key))
      .sort((a, b) => b.ok / (b.ok + b.ko) - a.ok / (a.ok + a.ko) || b.ok - a.ok)[0] || null;
    out.push({
      ...p,
      name: p.meta.name || `#${p.id}`,
      jersey: p.meta.jersey,
      position: p.meta.position || p.reps[0]?.pr.pos || "",
      group: p.meta.group || "?",
      n: p.reps.length,
      avg: mean(scores),
      scores,
      grades: countGrades(p.reps.map((r) => r.pr)),
      metricStats: stats,
      worst,
      best,
    });
  }
  return out;
}

function playKey(rep) {
  const side = rep.side === "defense" ? "defense" : "offense";
  const parts = [formationLabel(rep.formation)];
  if (side === "defense") parts.push(rep.coverage || "Couverture inconnue");
  return { key: `${side}|${parts.join("|")}`, side, label: parts.join(" · ") };
}

function aggregatePlays(reps) {
  const map = new Map();
  for (const rep of reps) {
    const k = playKey(rep);
    if (!map.has(k.key)) map.set(k.key, { ...k, reps: [] });
    map.get(k.key).reps.push(rep);
  }
  return [...map.values()].map((g) => {
    const results = {};
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

function drillStats(session, repById) {
  return (session.drills || []).map((d) => {
    const reps = (d.repIds || []).map((id) => repById.get(String(id))).filter(Boolean);
    return { d, reps, avg: mean(reps.map((r) => r.score)), grades: d.summary || countGrades(reps) };
  });
}

// ---------------------------------------------------------------------------
// SVG

function stackedBar(grades, { height = 14, labels = false } = {}) {
  const total = grades.green + grades.orange + grades.red;
  if (!total) return `<div class="rp-stack rp-stack--empty" style="height:${height}px"></div>`;
  const seg = (k) => grades[k]
    ? `<div class="rp-stack__seg rp-bg-${k}" style="flex:${grades[k]}" title="${GRADE_LABEL[k]} : ${grades[k]} (${pct(grades[k], total)} %)">${labels && pct(grades[k], total) >= 8 ? `${grades[k]}` : ""}</div>`
    : "";
  return `<div class="rp-stack" style="height:${height}px">${seg("green")}${seg("orange")}${seg("red")}</div>`;
}

function sparkline(scores, grades, w = 120, h = 28) {
  const pts = scores.map((s, i) => [i, s]).filter(([, s]) => s !== null);
  if (!pts.length) return `<span class="rp-muted">–</span>`;
  const n = Math.max(scores.length - 1, 1);
  const X = (i) => 3 + (i / n) * (w - 6);
  const Y = (s) => h - 3 - (Math.max(0, Math.min(100, s)) / 100) * (h - 6);
  const line = pts.map(([i, s]) => `${X(i).toFixed(1)},${Y(s).toFixed(1)}`).join(" ");
  const [li, ls] = pts[pts.length - 1];
  const lastGrade = gradeOf(grades[li]);
  return `<svg class="rp-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${Y(70)}" y2="${Y(70)}" class="rp-spark__ref"/>
    ${pts.length > 1 ? `<polyline points="${line}" class="rp-spark__line"/>` : ""}
    <circle cx="${X(li)}" cy="${Y(ls)}" r="3" class="rp-fill-${lastGrade}"/>
  </svg>`;
}

function scoreChart(player) {
  const w = 640, h = 220, ml = 34, mr = 12, mt = 12, mb = 28;
  const items = player.reps;
  const n = Math.max(items.length - 1, 1);
  const X = (i) => ml + (items.length === 1 ? (w - ml - mr) / 2 : (i / n) * (w - ml - mr));
  const Y = (s) => mt + (1 - Math.max(0, Math.min(100, s)) / 100) * (h - mt - mb);
  const grid = [0, 25, 50, 75, 100].map((v) =>
    `<line x1="${ml}" x2="${w - mr}" y1="${Y(v)}" y2="${Y(v)}" class="rp-chart__grid"/>
     <text x="${ml - 6}" y="${Y(v) + 4}" class="rp-chart__axis" text-anchor="end">${v}</text>`).join("");
  const valid = items.map((it, i) => [i, num(it.pr.score)]).filter(([, s]) => s !== null);
  const line = valid.map(([i, s]) => `${X(i).toFixed(1)},${Y(s).toFixed(1)}`).join(" ");
  // Moyenne glissante sur 3 essais pour lire la tendance.
  const trend = valid.map(([i], k) => {
    const win = valid.slice(Math.max(0, k - 2), k + 1).map(([, s]) => s);
    return `${X(i).toFixed(1)},${Y(win.reduce((a, b) => a + b, 0) / win.length).toFixed(1)}`;
  }).join(" ");
  const step = Math.ceil(items.length / 12);
  const xlabels = items.map((it, i) => (i % step === 0 || i === items.length - 1)
    ? `<text x="${X(i)}" y="${h - 8}" class="rp-chart__axis" text-anchor="middle">${esc(it.rep.index ?? i + 1)}</text>` : "").join("");
  const dots = valid.map(([i, s]) => {
    const it = items[i];
    const g = gradeOf(it.pr.grade);
    const tip = `Essai ${it.rep.index ?? i + 1} · ${it.rep.label || ""} · score ${Math.round(s)}${it.pr.feedback ? " — " + it.pr.feedback : ""}`;
    return `<g class="rp-chart__pt" data-rep="${esc(it.rep.id)}" tabindex="0" role="button" aria-label="${esc(tip)}">
      <title>${esc(tip)}</title>
      <circle cx="${X(i)}" cy="${Y(s)}" r="11" class="rp-chart__hit"/>
      <circle cx="${X(i)}" cy="${Y(s)}" r="5.5" class="rp-fill-${g} rp-chart__dot"/>
    </g>`;
  }).join("");
  return `<svg class="rp-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Score par essai">
    <rect x="${ml}" y="${Y(100)}" width="${w - ml - mr}" height="${Y(70) - Y(100)}" class="rp-chart__band rp-fill-green"/>
    <rect x="${ml}" y="${Y(45)}" width="${w - ml - mr}" height="${Y(0) - Y(45)}" class="rp-chart__band rp-fill-red"/>
    ${grid}
    ${valid.length > 2 ? `<polyline points="${trend}" class="rp-chart__trend"/>` : ""}
    ${valid.length > 1 ? `<polyline points="${line}" class="rp-chart__line"/>` : ""}
    ${dots}${xlabels}
    <text x="${w - mr}" y="${h - 8}" class="rp-chart__axis" text-anchor="end" dy="0"></text>
  </svg>`;
}

function dots(reps, { big = false } = {}) {
  if (!reps.length) return `<span class="rp-muted">Aucun essai</span>`;
  return `<div class="rp-dots${big ? " rp-dots--big" : ""}">${reps.map((r) => {
    const tip = `Essai ${r.index ?? ""} · ${r.label || ""}${num(r.score) !== null ? " · score " + Math.round(r.score) : ""}${r.passResult ? " · " + (RESULT_LABEL[r.passResult] || r.passResult) : ""}`;
    return `<button type="button" class="rp-dot rp-bg-${gradeOf(r.grade)}" data-rep="${esc(r.id)}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
  }).join("")}</div>`;
}

const scorePill = (s) => `<span class="rp-score rp-score--${scoreClass(s)}">${fmt(s)}</span>`;

// ---------------------------------------------------------------------------
// Sections

function renderSummary(session, reps, drills) {
  const g = countGrades(reps);
  const total = reps.length;
  const off = reps.filter((r) => r.side === "offense");
  const def = reps.filter((r) => r.side === "defense");
  const scored = drills.filter((x) => x.avg !== null);
  const pool = scored.filter((x) => x.reps.length >= 2);
  const ranked = (pool.length >= 2 ? pool : scored).sort((a, b) => b.avg - a.avg);
  const best = ranked[0], worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const sideBox = (label, arr) => `
    <div class="rp-kpi">
      <div class="rp-kpi__label">${label}</div>
      <div class="rp-kpi__value">${scorePill(mean(arr.map((r) => r.score)))}<span class="rp-kpi__sub">${arr.length} essai${arr.length > 1 ? "s" : ""}</span></div>
      ${stackedBar(countGrades(arr), { height: 6 })}
    </div>`;
  const drillBox = (label, x, cls) => `
    <button type="button" class="rp-kpi rp-kpi--drill rp-kpi--${cls}" ${x ? `data-goto-drill="${esc(x.d.id)}"` : "disabled"}>
      <div class="rp-kpi__label">${label}</div>
      ${x ? `<div class="rp-kpi__value">${scorePill(x.avg)}<span class="rp-kpi__name">${esc(x.d.name || x.d.id)}</span></div>
             <div class="rp-kpi__sub">${x.reps.length} essai${x.reps.length > 1 ? "s" : ""} · ${esc(SIDE_LABEL[x.d.side] || "")}</div>`
          : `<div class="rp-kpi__sub">–</div>`}
    </button>`;
  return `
  <section class="rp-summary" aria-label="Synthèse de la séance">
    <div class="rp-summary__head">
      <div>
        <h2 class="rp-h2">Bilan de séance</h2>
        <div class="rp-muted">${esc(session.label || "")}${session.date ? ` · ${esc(session.date)}` : ""}${session.opponent ? ` · opposition ${esc(session.opponent)}` : ""}</div>
      </div>
      <div class="rp-legend">
        <span><i class="rp-bg-green"></i>Bien</span><span><i class="rp-bg-orange"></i>À revoir</span><span><i class="rp-bg-red"></i>À corriger</span>
      </div>
    </div>
    <div class="rp-kpis">
      <div class="rp-kpi rp-kpi--wide">
        <div class="rp-kpi__label">Essais</div>
        <div class="rp-kpi__value"><span class="rp-big">${total}</span><span class="rp-kpi__sub">${drills.length} drills</span></div>
        ${stackedBar(g, { height: 22, labels: true })}
        <div class="rp-kpi__split">
          <span class="rp-c-green">${pct(g.green, total)} % bien</span>
          <span class="rp-c-orange">${pct(g.orange, total)} % à revoir</span>
          <span class="rp-c-red">${pct(g.red, total)} % à corriger</span>
        </div>
      </div>
      ${sideBox("Score moyen attaque", off)}
      ${sideBox("Score moyen défense", def)}
      ${drillBox("Drill le mieux exécuté", best, "best")}
      ${drillBox("Drill le moins bien exécuté", worst, "worst")}
    </div>
  </section>`;
}

const PLAYER_COLS = [
  { key: "name", label: "Joueur", sort: (p) => p.name.toLowerCase() },
  { key: "group", label: "Groupe", sort: (p) => GROUPS.indexOf(p.group) },
  { key: "n", label: "Essais", sort: (p) => p.n, num: true },
  { key: "avg", label: "Score moy.", sort: (p) => p.avg ?? -1, num: true },
  { key: "trend", label: "Progression", sort: null },
  { key: "worst", label: "Erreur récurrente", sort: (p) => (p.worst ? p.worst.ko : -1) },
  { key: "best", label: "Point fort", sort: null },
];

function renderPlayersTable(players, state) {
  const present = GROUPS.filter((g) => players.some((p) => p.group === g));
  const filtered = state.group === "ALL" ? players : players.filter((p) => p.group === state.group);
  const col = PLAYER_COLS.find((c) => c.key === state.sortKey) || PLAYER_COLS[3];
  const rows = [...filtered].sort((a, b) => {
    const va = col.sort(a), vb = col.sort(b);
    const r = va < vb ? -1 : va > vb ? 1 : 0;
    return state.sortDir === "asc" ? r : -r;
  });
  const chips = [["ALL", "Tous"], ...present.map((g) => [g, g])].map(([k, l]) => {
    const n = k === "ALL" ? players.length : players.filter((p) => p.group === k).length;
    return `<button type="button" class="rp-chip${state.group === k ? " is-active" : ""}" data-group="${k}" aria-pressed="${state.group === k}">${l}<span>${n}</span></button>`;
  }).join("");
  const head = PLAYER_COLS.map((c) => {
    const active = c.key === state.sortKey;
    const arrow = active ? (state.sortDir === "asc" ? "▲" : "▼") : "";
    return c.sort
      ? `<th class="${c.num ? "rp-num" : ""}" aria-sort="${active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="rp-th" data-sort="${c.key}">${c.label}<span class="rp-arrow">${arrow}</span></button></th>`
      : `<th>${c.label}</th>`;
  }).join("");
  const body = rows.map((p) => `
    <tr class="rp-row${p.n < 3 ? " rp-row--few" : ""}" data-player="${esc(p.id)}" tabindex="0" title="${p.n < 3 ? "Peu d'essais : à interpréter avec prudence" : ""}">
      <td><div class="rp-player"><span class="rp-jersey">${esc(p.jersey ?? "")}</span><span><strong>${esc(p.name)}</strong><small class="rp-muted">${esc(p.position)}</small></span></div></td>
      <td><span class="rp-group">${esc(p.group)}</span></td>
      <td class="rp-num">${p.n}</td>
      <td class="rp-num">${scorePill(p.avg)}</td>
      <td>${sparkline(p.scores, p.reps.map((r) => r.pr.grade))}</td>
      <td>${p.worst ? `<span class="rp-issue">${esc(p.worst.label)}</span><small class="rp-muted">${p.worst.ko} fois sur ${p.worst.ok + p.worst.ko}</small>` : `<span class="rp-muted">${p.metricStats.length ? "Rien de récurrent" : "Pas de mesure"}</span>`}</td>
      <td>${p.best ? `<span class="rp-strength">${esc(p.best.label)}</span><small class="rp-muted">${p.best.ok}/${p.best.ok + p.best.ko} réussis</small>` : `<span class="rp-muted">–</span>`}</td>
    </tr>`).join("");
  return `
    <div class="rp-toolbar"><div class="rp-chips" role="group" aria-label="Filtrer par groupe">${chips}</div>
      <span class="rp-muted rp-hint">Clique sur un joueur pour sa fiche détaillée</span></div>
    <div class="rp-tablewrap">
      <table class="rp-table rp-table--players">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="7" class="rp-empty">Aucun joueur dans ce groupe.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderPlayerDetail(p) {
  const metrics = p.metricStats.filter((m) => m.ok + m.ko > 0 || m.values.length).sort((a, b) => (b.ko / Math.max(1, b.ok + b.ko)) - (a.ko / Math.max(1, a.ok + a.ko)));
  const mrows = metrics.map((m) => {
    const judged = m.ok + m.ko;
    const rate = judged ? pct(m.ok, judged) : null;
    const avg = mean(m.values);
    const cls = rate === null ? "none" : rate >= 75 ? "green" : rate >= 50 ? "orange" : "red";
    return `<tr>
      <td>${esc(m.label)}</td>
      <td class="rp-num">${avg === null ? "–" : `${fmt(avg, Math.abs(avg) < 10 ? 2 : 1)}${m.unit ? " " + esc(m.unit) : ""}`}</td>
      <td class="rp-num">${judged ? `${m.ok}/${judged}` : "–"}</td>
      <td><div class="rp-meter">${rate === null ? "" : `<div class="rp-meter__fill rp-bg-${cls}" style="width:${rate}%"></div>`}</div></td>
    </tr>`;
  }).join("");
  const feedbacks = p.reps.filter((r) => r.pr.feedback).map((r) => `
    <li><button type="button" class="rp-fb" data-rep="${esc(r.rep.id)}">
      <span class="rp-fb__dot rp-bg-${gradeOf(r.pr.grade)}"></span>
      <span class="rp-fb__meta">Essai ${esc(r.rep.index ?? "")} · ${esc(r.rep.label || "")}</span>
      <span class="rp-fb__text">${esc(r.pr.feedback)}</span>
      <span class="rp-fb__score">${fmt(num(r.pr.score))}</span>
    </button></li>`).join("");
  const first = mean(p.scores.slice(0, Math.ceil(p.scores.length / 2)));
  const last = mean(p.scores.slice(Math.ceil(p.scores.length / 2)));
  const delta = first !== null && last !== null && p.scores.length >= 4 ? last - first : null;
  const trendTxt = delta === null ? "" : Math.abs(delta) < 3 ? "Stable sur la séance"
    : delta > 0 ? `En progrès : +${fmt(delta)} pts en 2e moitié` : `En baisse : ${fmt(delta)} pts en 2e moitié`;
  return `
    <div class="rp-detail" role="dialog" aria-modal="true" aria-label="Fiche ${esc(p.name)}">
      <div class="rp-detail__card">
        <header class="rp-detail__head">
          <div class="rp-player rp-player--lg"><span class="rp-jersey">${esc(p.jersey ?? "")}</span>
            <span><strong>${esc(p.name)}</strong><small class="rp-muted">${esc(p.position)} · ${esc(p.group)} · ${p.n} essai${p.n > 1 ? "s" : ""}</small></span></div>
          <div class="rp-detail__kpis">
            <div><small class="rp-muted">Score moyen</small>${scorePill(p.avg)}</div>
            <div class="rp-detail__stack"><small class="rp-muted">Répartition</small>${stackedBar(p.grades, { height: 12, labels: true })}</div>
          </div>
          <button type="button" class="rp-close" data-close aria-label="Fermer">✕</button>
        </header>
        <div class="rp-detail__body">
          <section class="rp-block rp-block--chart">
            <h3 class="rp-h3">Score essai par essai <small class="rp-muted">${esc(trendTxt)}${trendTxt ? " · " : ""}clique un point pour ouvrir le replay</small></h3>
            ${scoreChart(p)}
          </section>
          <div class="rp-detail__cols">
            <section class="rp-block">
              <h3 class="rp-h3">Métriques</h3>
              ${mrows ? `<table class="rp-table rp-table--compact"><thead><tr><th>Critère</th><th class="rp-num">Moyenne</th><th class="rp-num">Réussi</th><th>Taux</th></tr></thead><tbody>${mrows}</tbody></table>` : `<p class="rp-empty">Pas de métrique mesurée.</p>`}
            </section>
            <section class="rp-block">
              <h3 class="rp-h3">Retours donnés</h3>
              ${feedbacks ? `<ul class="rp-fbs">${feedbacks}</ul>` : `<p class="rp-empty">Aucun retour enregistré.</p>`}
            </section>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPlays(plays) {
  const resultsHtml = (res) => Object.entries(res).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="rp-res rp-res--${k === "?" ? "unk" : k}">${esc(RESULT_LABEL[k] || "Autre")} ${v}</span>`).join("");
  const sideBlock = (side) => {
    const list = plays.filter((p) => p.side === side).sort((a, b) => b.n - a.n);
    if (!list.length) return "";
    const rows = list.map((p) => `
      <tr>
        <td><strong>${esc(p.label)}</strong></td>
        <td class="rp-num">${p.n}</td>
        <td class="rp-num">${scorePill(p.avg)}</td>
        <td><div class="rp-rate"><span class="rp-num">${p.greenRate} %</span>${stackedBar(p.grades, { height: 6 })}</div></td>
        <td class="rp-num">${p.yards === null ? "–" : `${fmt(p.yards, 1)} yds`}</td>
        <td><div class="rp-results">${resultsHtml(p.results)}</div></td>
        <td>${dots(p.reps)}</td>
      </tr>`).join("");
    return `<h3 class="rp-h3">${SIDE_LABEL[side]} <small class="rp-muted">${side === "defense" ? "formation adverse · couverture jouée" : "formation"}</small></h3>
      <div class="rp-tablewrap"><table class="rp-table">
        <thead><tr><th>Jeu</th><th class="rp-num">Nb</th><th class="rp-num">Score moy.</th><th>Taux vert</th><th class="rp-num">Gain moy.</th><th>Résultats</th><th>Essais</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  };
  const eligible = plays.filter((p) => p.n >= 2 && p.avg !== null).sort((a, b) => b.avg - a.avg);
  const top = eligible.slice(0, 3);
  const bottom = eligible.slice(-3).reverse().filter((p) => !top.includes(p));
  const card = (p, cls) => `<li class="rp-insight rp-insight--${cls}">
    <span class="rp-insight__side">${SIDE_LABEL[p.side]}</span>
    <strong>${esc(p.label)}</strong>
    <span>${scorePill(p.avg)} <span class="rp-muted">sur ${p.n} essais · ${p.greenRate} % vert</span></span></li>`;
  return `
    <div class="rp-insights">
      <div><h3 class="rp-h3 rp-c-green">Ce qui marche</h3>
        ${top.length ? `<ul>${top.map((p) => card(p, "good")).join("")}</ul>` : `<p class="rp-empty">Pas assez d'essais répétés.</p>`}</div>
      <div><h3 class="rp-h3 rp-c-red">Ce qui pose problème</h3>
        ${bottom.length ? `<ul>${bottom.map((p) => card(p, "bad")).join("")}</ul>` : `<p class="rp-empty">Rien à signaler.</p>`}</div>
    </div>
    ${sideBlock("offense")}
    ${sideBlock("defense")}`;
}

function renderDrills(drills) {
  if (!drills.length) return `<p class="rp-empty">Aucun drill dans cette séance.</p>`;
  return `<ol class="rp-drills">${drills.map(({ d, reps, avg, grades }) => `
    <li class="rp-drill" id="rp-drill-${esc(d.id)}">
      <div class="rp-drill__head">
        <span class="rp-drill__idx">${esc(d.index ?? "")}</span>
        <div class="rp-drill__title"><strong>${esc(d.name || d.id)}</strong>
          <small class="rp-muted">${esc(SIDE_LABEL[d.side] || "")} · ${reps.length} essai${reps.length > 1 ? "s" : ""}</small></div>
        ${scorePill(avg)}
        <div class="rp-drill__stack">${stackedBar({ green: grades.green || 0, orange: grades.orange || 0, red: grades.red || 0 }, { height: 8 })}</div>
      </div>
      ${dots(reps, { big: true })}
      ${d.brief?.coach ? `<p class="rp-drill__brief"><span class="rp-tag">Brief coach</span>${esc(d.brief.coach)}</p>` : ""}
    </li>`).join("")}</ol>`;
}

// ---------------------------------------------------------------------------
// Entrée

export function renderReports(container, session, { onOpenRep } = {}) {
  session = session || {};
  const reps = (Array.isArray(session.reps) ? session.reps : []).filter(Boolean)
    .slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const repById = new Map(reps.map((r) => [String(r.id), r]));
  const drills = drillStats(session, repById);
  const players = aggregatePlayers(session, reps);
  const plays = aggregatePlays(reps);
  const state = { tab: "players", group: "ALL", sortKey: "avg", sortDir: "desc", detail: null };
  try { state.tab = localStorage.getItem("rp-tab") || state.tab; } catch { /* ignore */ }

  const root = document.createElement("div");
  root.className = "rp-root";
  container.appendChild(root);

  const TABS = [["players", "Par joueur"], ["plays", "Par jeu"], ["drills", "Par drill"]];

  function draw() {
    const scroll = root.querySelector(".rp-tabpanel")?.scrollTop;
    let panel = "";
    if (state.tab === "players") panel = players.length ? renderPlayersTable(players, state) : `<p class="rp-empty">Aucun joueur suivi.</p>`;
    else if (state.tab === "plays") panel = plays.length ? renderPlays(plays) : `<p class="rp-empty">Aucun essai.</p>`;
    else panel = renderDrills(drills);
    const detailP = state.detail && players.find((p) => p.id === state.detail);
    root.innerHTML = `
      ${renderSummary(session, reps, drills)}
      <nav class="rp-tabs" role="tablist">${TABS.map(([k, l]) =>
        `<button type="button" role="tab" class="rp-tab${state.tab === k ? " is-active" : ""}" aria-selected="${state.tab === k}" data-tab="${k}">${l}</button>`).join("")}</nav>
      <div class="rp-tabpanel" role="tabpanel">${panel}</div>
      ${detailP ? renderPlayerDetail(detailP) : ""}`;
    if (scroll) root.querySelector(".rp-tabpanel").scrollTop = scroll;
    if (detailP) root.querySelector(".rp-close")?.focus({ preventScroll: true });
  }

  const openRep = (id) => { if (id && typeof onOpenRep === "function") onOpenRep(String(id)); };

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-group],[data-sort],[data-rep],[data-close],[data-goto-drill],.rp-row,.rp-detail");
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; try { localStorage.setItem("rp-tab", state.tab); } catch { /* ignore */ } draw(); }
    else if (t.dataset.group) { state.group = t.dataset.group; draw(); }
    else if (t.dataset.sort) {
      if (state.sortKey === t.dataset.sort) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = t.dataset.sort; state.sortDir = t.dataset.sort === "name" || t.dataset.sort === "group" ? "asc" : "desc"; }
      draw();
    } else if (t.dataset.rep) { e.stopPropagation(); openRep(t.dataset.rep); }
    else if (t.hasAttribute("data-close")) { state.detail = null; draw(); }
    else if (t.dataset.gotoDrill) {
      state.tab = "drills"; draw();
      const el = root.querySelector(`#rp-drill-${CSS.escape(t.dataset.gotoDrill)}`);
      if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("is-flash"); }
    } else if (t.classList.contains("rp-row")) { state.detail = t.dataset.player; draw(); }
    else if (t.classList.contains("rp-detail") && e.target === t) { state.detail = null; draw(); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.detail) { state.detail = null; draw(); return; }
    if (e.key !== "Enter" && e.key !== " ") return;
    const pt = e.target.closest(".rp-chart__pt");
    if (pt) { e.preventDefault(); openRep(pt.dataset.rep); return; }
    const row = e.target.closest(".rp-row");
    if (row) { e.preventDefault(); state.detail = row.dataset.player; draw(); }
  });

  draw();
}
