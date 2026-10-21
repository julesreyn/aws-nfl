// Sideline — état de l'app, chargement des données, lecture, mode séance en direct.
import { createField2D } from './field2d.js';
import { createSessionTimeline, createPlayTimeline } from './timeline.js';
import { createPanel } from './panel.js';
import { openBriefPreview } from './briefs.js';
import * as tts from './tts.js';
import * as settings from './settings.js';
import { analyzeRep } from './analysis.js';

const $ = s => document.querySelector(s);
const FPS = 10;

const state = {
  sessions: [], session: null, tracking: null, repsById: {}, drillsById: {},
  rep: null, frame: 0, playing: false, speed: 1, selected: null,
  dim: '3d', voice: true, ana: null, view: 'seance', live: null, // live: { drillId, step }
};

// ---------- UI helpers ----------
const tooltip = (() => {
  const el = $('#tooltip');
  return {
    show(anchor, html) {
      el.innerHTML = html; el.hidden = false;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
      let y = r.bottom + 10; if (y + h > window.innerHeight - 8) y = r.top - h - 10;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    hide() { el.hidden = true; },
  };
})();

function toast(html, { kind = '', ms = 3200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = html;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 300); }, ms);
}
const esc = settings.esc;

// ---------- Modules ----------
const sessionTL = createSessionTimeline($('#sessionTimeline'), { onOpenRep: (id, o) => { stopLive(); openRep(id, o); }, tooltip });
const playTL = createPlayTimeline($('#playTimeline'), {
  onToggle: () => togglePlay(),
  onSeek: (f) => { pause(); setFrame(f); },
  onStep: (d) => step(d),
  onRestart: () => { setFrame(0); },
  onSpeed: (s) => { state.speed = s; playTL.setSpeed(s); },
});
const panel = createPanel($('#panel'), { onSelectPlayer: id => select(id) });
const field2d = createField2D($('#field2d'), { onSelectPlayer: id => select(id) });
let view3d = null, view3dLoading = null;
const activeView = () => (state.dim === '3d' && view3d ? view3d : field2d);

// ---------- Données ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  try {
    state.sessions = await getJSON('data/sessions.json');
  } catch (e) {
    showFatal('Les données de séance sont introuvables.', 'Lance <code>uv run pipeline/build.py</code> à la racine du repo, puis recharge la page.');
    return;
  }
  const sel = $('#sessionSelect');
  sel.innerHTML = state.sessions.map(s => `<option value="${esc(s.id)}">${esc(s.label)} · ${esc(s.date)}</option>`).join('');
  sel.addEventListener('change', () => { stopLive(); loadSession(sel.value); });

  const hash = new URLSearchParams(location.hash.slice(1));
  const sid = state.sessions.some(s => s.id === hash.get('s')) ? hash.get('s') : state.sessions[0]?.id;
  if (!sid) { showFatal('Aucune séance disponible.', 'Le fichier sessions.json est vide.'); return; }
  sel.value = sid;
  await loadSession(sid, hash.get('r'));
  await setDim('3d');
  $('#boot').classList.add('is-done');
  setTimeout(() => $('#boot').remove(), 500);
  maybeHelp();
}

function showFatal(title, hint) {
  $('#boot').innerHTML = `<div class="boot-in"><span class="brand-mark big" aria-hidden="true"><i></i><i></i><i></i></span><h2>${title}</h2><p>${hint}</p></div>`;
}

async function loadSession(id, repId) {
  $('#field2d').classList.add('is-loading');
  try {
    const [s, t] = await Promise.all([getJSON(`data/session_${id}.json`), getJSON(`data/tracking_${id}.json`)]);
    state.session = s; state.tracking = t;
    state.repsById = Object.fromEntries(s.reps.map(r => [String(r.id), r]));
    state.drillsById = Object.fromEntries(s.drills.map(d => [d.id, d]));
    state.selected = null;
    sessionTL.render(s);
    if (state.view === 'rapports') renderReportsView();
    const first = repId && state.repsById[repId] ? repId : s.reps[0]?.id;
    if (first != null) openRep(String(first), { autoplay: false });
  } catch (e) {
    console.warn(e);
    toast(`Impossible de charger la séance (${esc(e.message)}).`, { kind: 'bad', ms: 6000 });
  } finally {
    $('#field2d').classList.remove('is-loading');
  }
}

// ---------- Essai ----------
function openRep(repId, { autoplay = false } = {}) {
  const rep = state.repsById[String(repId)];
  if (!rep) return;
  if (state.view !== 'seance') setView('seance');
  state.rep = rep;
  const track = state.tracking?.[String(rep.playId)] || state.tracking?.[String(rep.id)] || { nFrames: rep.nFrames, players: {}, ball: [] };
  if (!rep.nFrames) rep.nFrames = track.nFrames;
  // garder la sélection si le joueur est sur l'essai
  if (state.selected && !track.players[state.selected]) state.selected = null;
  field2d.setRep(rep, track, state.session);
  field2d.setSelected(state.selected);
  if (view3d) { try { view3d.setRep(rep, track, state.session); view3d.setSelected(state.selected); } catch (e) { console.warn(e); } }
  playTL.setRep(rep);
  panel.setRep(rep, state.session, state.drillsById[rep.drillId]);
  panel.setSelected(state.selected);
  sessionTL.setActive(rep.id);
  renderBadge();
  state.ana = analyzeRep(rep, track, state.session);
  renderRouteCard();
  setFrame(0);
  history.replaceState(null, '', `#s=${state.session.id}&r=${rep.id}`);
  if (autoplay) play(); else pause();
}

function renderBadge() {
  const r = state.rep, d = state.drillsById[r.drillId];
  const pos = d ? d.repIds.indexOf(r.id) + 1 : 0;
  $('#repBadge').innerHTML = `
    <span class="rb-drill">${esc(d ? d.name : '')}</span>
    <span class="rb-rep">Essai ${pos}/${d ? d.repIds.length : 1}</span>
    <span class="rb-legend"><i class="lg-los"></i>Scrimmage <i class="lg-fd"></i>Ligne à gagner <i class="lg-tb"></i>TB <i class="lg-op"></i>${esc(state.session.opponent || 'Adversaire')}</span>`;
}

function setFrame(f) {
  const n = state.rep ? Math.max(1, (state.rep.nFrames || 1) - 1) : 0;
  state.frame = Math.max(0, Math.min(n, f));
  activeView().setFrame(state.frame);
  playTL.setFrame(state.frame);
}

function play() {
  if (!state.rep) return;
  if (state.frame >= state.rep.nFrames - 1.001) setFrame(0);
  if (state.frame < 1 && state.voice && state.ana?.speech && !tts.speaking()) announceRoutes();
  state.playing = true; playTL.setPlaying(true);
}
function pause() { state.playing = false; playTL.setPlaying(false); }
function togglePlay() { state.playing ? pause() : play(); }
function step(d) { pause(); setFrame(Math.round(state.frame) + d); }

function select(id) {
  state.selected = id == null ? null : String(id);
  field2d.setSelected(state.selected);
  if (view3d) try { view3d.setSelected(state.selected); } catch (e) { console.warn(e); }
  panel.setSelected(state.selected);
  if (!$('#settingsPop').hidden) openSettings(true);
}

// ---------- Boucle ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.playing && state.rep) {
    const end = state.rep.nFrames - 1;
    let f = state.frame + dt * FPS * state.speed;
    if (f >= end) { f = end; pause(); setFrame(f); onRepEnded(); }
    else setFrame(f);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Bascules ----------
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
function setView(v) {
  state.view = v;
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('is-on', b.dataset.view === v); b.setAttribute('aria-selected', String(b.dataset.view === v)); });
  $('#seanceView').hidden = v !== 'seance';
  $('#reportsView').hidden = v !== 'rapports';
  document.body.classList.toggle('view-reports', v === 'rapports');
  if (v === 'rapports') { stopLive(); pause(); renderReportsView(); }
  else requestAnimationFrame(() => { field2d.resize(); if (view3d) try { view3d.resize(); } catch (_) { /* */ } });
}

async function renderReportsView() {
  const host = $('#reportsView');
  host.innerHTML = '';
  if (!state.session) return;
  try {
    const mod = await import('./reports.js');
    host.innerHTML = '';
    mod.renderReports(host, state.session, { onOpenRep: id => { setView('seance'); openRep(String(id), { autoplay: true }); } });
  } catch (e) {
    console.warn('Rapports indisponibles', e);
    host.innerHTML = `<div class="soon"><h2>Rapports</h2><p>Le module de rapports n'est pas encore disponible. Reviens sur la vue Séance pour rejouer les essais.</p></div>`;
  }
}

document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => setDim(b.dataset.dim)));
async function setDim(d) {
  if (d === '3d' && !view3d) {
    try {
      view3dLoading = view3dLoading || import('./view3d.js');
      const mod = await view3dLoading;
      $('#field3d').hidden = false;
      view3d = mod.createView3D($('#field3d'), { onSelectPlayer: id => select(id) });
      if (state.rep) {
        const track = state.tracking?.[String(state.rep.playId)] || state.tracking?.[String(state.rep.id)];
        view3d.setRep(state.rep, track, state.session);
        view3d.setSelected(state.selected);
      }
    } catch (e) {
      console.warn('Vue 3D indisponible', e);
      view3dLoading = null; view3d = null;
      $('#field3d').hidden = true;
      toast('La vue 3D n’est pas disponible pour le moment. Le terrain 2D reste actif.', { kind: 'bad' });
      return;
    }
  }
  state.dim = d;
  document.querySelectorAll('[data-dim]').forEach(b => b.classList.toggle('is-on', b.dataset.dim === d));
  $('#field2d').hidden = d !== '2d';
  $('#field3d').hidden = d !== '3d';
  $('#camTools').hidden = d !== '3d';
  requestAnimationFrame(() => {
    if (d === '3d') { try { view3d.resize(); } catch (_) { /* */ } } else field2d.resize();
    setFrame(state.frame);
  });
}
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-cam]').forEach(x => x.classList.toggle('is-on', x === b));
  try { view3d?.setCamera(b.dataset.cam); } catch (e) { console.warn(e); }
}));
$('#voiceBtn').addEventListener('click', e => {
  state.voice = !state.voice;
  e.currentTarget.setAttribute('aria-pressed', String(state.voice));
  e.currentTarget.classList.toggle('is-on', state.voice);
  e.currentTarget.textContent = state.voice ? '🔊 Annonce' : '🔇 Annonce';
  if (!state.voice) tts.stop();
});

// ---------- Tracés : carte + annonce vocale ----------
function renderRouteCard() {
  const el = $('#routeCard'), a = state.ana;
  if (!a || (!a.routes.length && !a.misplaced.length)) { el.hidden = true; return; }
  const off = state.rep.side !== 'defense';
  const li = (n, r, small, i) => `<li style="animation-delay:${(i * 0.06).toFixed(2)}s"><span class="n">${n}</span><span class="r">${r}</span>${small ? `<small>${esc(small)}</small>` : ''}</li>`;
  el.innerHTML = `
    <h4>${off ? 'Tracés de l’attaque' : `Tracés ${esc(state.session.opponent || 'adverses')}`}</h4>
    <ul>${a.routes.map((t, i) => li(t.jersey != null ? '#' + t.jersey : '', esc(t.route), `${t.name} · ${t.hint}`, i)).join('')}</ul>
    ${a.misplaced.length ? `<div class="rc-sec rc-bad"><h4 style="color:#f87171">Mal placés</h4><ul>${a.misplaced.map((b, i) => li('#' + (b.jersey ?? ''), esc(b.issue), b.name, i + a.routes.length)).join('')}</ul></div>` : ''}
    <div class="rc-legend"><span><i style="border-color:#22c55e"></i>Bien placé</span><span><i style="border-color:#ef4444"></i>Mal placé</span></div>`;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
function announceRoutes() {
  if (!state.ana?.speech) return;
  tts.speak(state.ana.speech, { id: 'routes', rate: 1.05 });
}

// ---------- Réglages ----------
function openSettings(refresh = false) {
  const pop = $('#settingsPop');
  if (!refresh) pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    const m = state.selected ? state.session?.players[state.selected] : null;
    settings.renderSettings(pop, { trackedName: m && m.ours ? `#${m.jersey} ${m.name}` : null });
  }
}
$('#settingsBtn').addEventListener('click', e => { e.stopPropagation(); openSettings(); });
document.addEventListener('click', e => {
  const pop = $('#settingsPop');
  if (!pop.hidden && !pop.contains(e.target) && e.target !== $('#settingsBtn')) pop.hidden = true;
});

// ---------- Mode séance en direct ----------
$('#liveBtn').addEventListener('click', () => (state.live ? stopLive() : startLive()));

function trackedPlayer(rep) {
  const s = settings.get();
  const ids = Object.keys(rep.players || {});
  if (s.tracked === 'selected' && state.selected && rep.players?.[state.selected]) return state.selected;
  if (state.live?.trackedId && rep.players?.[state.live.trackedId]) return state.live.trackedId;
  const meta = id => state.session.players[id] || {};
  const want = rep.side === 'offense' ? ['QB', 'WR', 'TE', 'RB', 'OL'] : ['DL', 'LB', 'DB'];
  for (const g of want) { const id = ids.find(i => meta(i).group === g); if (id) return id; }
  return ids[0] || null;
}

function startLive() {
  if (!state.rep) return;
  let drill = state.drillsById[state.rep.drillId];
  if (!drill) return;
  // Pour la démo, on préfère un drill d'au moins 3 essais (le suivant dans la séance si besoin).
  if (drill.repIds.length < 3) {
    const ds = state.session.drills;
    const from = ds.indexOf(drill);
    const better = ds.slice(from).concat(ds.slice(0, from)).find(d => d.repIds.length >= 3);
    if (better) drill = better;
  }
  setView('seance');
  // On repart du début du drill si l'essai courant est le dernier.
  let idx = drill.repIds.indexOf(state.rep.id);
  if (drill.id !== state.rep.drillId) idx = 0;
  if (idx < 0 || idx === drill.repIds.length - 1) idx = 0;
  state.live = { drillId: drill.id, idx, trackedId: null };
  const first = state.repsById[drill.repIds[idx]];
  state.live.trackedId = trackedPlayer(first);
  document.body.classList.add('is-live');
  $('#liveBtn .live-txt').textContent = 'Arrêter le direct';
  state.speed = 1; playTL.setSpeed(1);
  hideHelp();
  openRep(drill.repIds[idx], { autoplay: true });
  if (state.live.trackedId) select(state.live.trackedId);
  updateLiveBanner('Essai en cours');
  toast(`<b>Séance en direct</b> · ${esc(drill.name)} · retours envoyés à chaque fin d’essai`, { ms: 3500 });
}

function stopLive() {
  if (!state.live) return;
  state.live = null;
  tts.stop();
  document.body.classList.remove('is-live');
  $('#liveBtn .live-txt').textContent = 'Séance en direct';
  $('#liveBanner').hidden = true;
  $('#modalRoot').innerHTML = '';
}

function updateLiveBanner(status) {
  if (!state.live) return;
  const d = state.drillsById[state.live.drillId];
  const id = state.live.trackedId, m = id ? state.session.players[id] : null;
  $('#liveBanner').hidden = false;
  $('#liveBanner').innerHTML = `<span class="lb-dot"></span><b>En direct</b><span>${esc(d.name)} · essai ${state.live.idx + 1}/${d.repIds.length}</span>
    <span class="lb-status">${esc(status)}</span>${m ? `<span class="lb-trk">Suivi : #${esc(m.jersey)} ${esc(m.name)}</span>` : ''}`;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function onRepEnded() {
  if (!state.live) return;
  const live = state.live;
  const rep = state.rep;
  const drill = state.drillsById[live.drillId];
  const pid = trackedPlayer(rep);
  live.trackedId = pid || live.trackedId;
  const pr = pid ? rep.players[pid] : null;
  const m = pid ? state.session.players[pid] : null;
  if (settings.get().level !== 'silent') {
    const n = Object.values(rep.players || {}).filter(p => p.feedback).length;
    if (settings.wantsRep()) {
      toast(`<span class="t-ic">📱</span><span><b>Retour envoyé</b><small>${n} joueur${n > 1 ? 's' : ''} · essai ${live.idx + 1}</small></span>`, { kind: 'sent' });
      if (pr?.feedback && m) panel.pushPhone({ to: `#${m.jersey} ${m.name}`, kind: 'rep', text: pr.feedback });
      updateLiveBanner('Retour envoyé');
      if (pr?.feedback) await tts.speak(pr.feedback, { id: 'live' });
      else await wait(1500);
    } else await wait(1200);
  } else await wait(1000);
  if (state.live !== live) return;
  await wait(700);
  if (state.live !== live) return;
  if (live.idx < drill.repIds.length - 1) {
    live.idx += 1;
    openRep(drill.repIds[live.idx], { autoplay: true });
    if (live.trackedId && state.rep.players?.[live.trackedId]) select(live.trackedId);
    updateLiveBanner('Essai en cours');
  } else {
    endOfDrill(live, drill);
  }
}

function endOfDrill(live, drill) {
  if (!settings.wantsBrief()) {
    toast(`<b>Drill terminé</b> · ${esc(drill.name)}`);
    stopLive();
    return;
  }
  updateLiveBanner('Fin du drill');
  const pid = live.trackedId && drill.brief?.players?.[live.trackedId] ? live.trackedId : Object.keys(drill.brief?.players || {})[0];
  openBriefPreview($('#modalRoot'), {
    drill, session: state.session, playerId: pid, seconds: 5,
    onSend: async text => {
      if (state.live !== live) return;
      const n = Object.keys(drill.brief?.players || {}).length;
      const m = pid ? state.session.players[pid] : null;
      toast(`<span class="t-ic">📱</span><span><b>Briefs envoyés</b><small>${n} joueur${n > 1 ? 's' : ''} · ${esc(drill.name)}</small></span>`, { kind: 'sent' });
      panel.pushPhone({ to: m ? `#${m.jersey} ${m.name}` : 'Équipe', kind: 'brief', text });
      panel.setTab('brief');
      if (pid) select(pid);
      updateLiveBanner('Brief envoyé');
      await tts.speak(text, { id: 'live-brief' });
      if (state.live === live) { stopLive(); toast('Drill terminé. Choisis un autre essai ou relance le direct.'); }
    },
    onCancel: () => { toast('Envoi des briefs annulé.'); stopLive(); },
  });
}

// ---------- Clavier ----------
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || $('#modalRoot').children.length) return;
  if (state.view !== 'seance') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); neighbour(-1); }
  else if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); neighbour(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'Home') { e.preventDefault(); setFrame(0); }
  else if (e.key === 'Escape') { if (state.live) stopLive(); else select(null); }
});
function neighbour(d) {
  if (!state.rep) return;
  const reps = state.session.reps;
  const i = reps.findIndex(r => r.id === state.rep.id);
  const n = reps[i + d];
  if (n) { stopLive(); openRep(n.id); }
}

// ---------- Aide ----------
const HELP_KEY = 'sideline.help.dismissed';
function maybeHelp() {
  if (settings.lsGet(HELP_KEY) === '1') return;
  const el = $('#help');
  el.innerHTML = `
    <button class="x-btn" aria-label="Fermer l'aide">×</button>
    <h3>Prise en main</h3>
    <ol>
      <li><b>Choisis un essai</b> dans la barre du haut. Chaque bloc est un essai, coloré selon la note.</li>
      <li><b>Lance la lecture</b> (Espace) puis clique un joueur rouge TB pour lire son retour.</li>
      <li><b>Clique « Séance en direct »</b> : le drill s’enchaîne et chaque joueur reçoit son retour audio.</li>
    </ol>
    <button class="btn primary sm" data-go>Compris</button>`;
  el.hidden = false;
  el.querySelectorAll('.x-btn, [data-go]').forEach(b => b.addEventListener('click', hideHelp));
}
function hideHelp() { const el = $('#help'); if (!el.hidden) { el.hidden = true; settings.lsSet(HELP_KEY, '1'); } }

window.addEventListener('resize', () => tooltip.hide());
boot();
