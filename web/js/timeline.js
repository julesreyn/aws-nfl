// Timeline de séance (tous les essais) + timeline d'essai (lecture, scrub, événements).
import { esc } from './settings.js';

export const GRADE_LABEL = { green: 'Validé', orange: 'À revoir', red: 'À corriger' };
export const SIDE_LABEL = { offense: 'Attaque', defense: 'Défense' };

// ---------- Timeline de séance ----------
export function createSessionTimeline(container, { onOpenRep, tooltip }) {
  let session = null, active = null;

  function render(s) {
    session = s;
    const repsById = Object.fromEntries(s.reps.map(r => [r.id, r]));
    const total = s.reps.length;
    container.innerHTML = `
      <div class="stl-head">
        <span class="stl-title">${esc(s.label)}</span>
        <span class="stl-meta">${total} essais · ${s.drills.length} drills</span>
        <span class="stl-legend">
          <i class="lg lg-green"></i>Validé <i class="lg lg-orange"></i>À revoir <i class="lg lg-red"></i>À corriger
        </span>
      </div>
      <div class="stl-track">
        ${s.drills.map(d => `
          <div class="stl-drill side-${d.side}" style="flex-grow:${d.repIds.length}" data-drill="${esc(d.id)}">
            <div class="stl-dname" title="${esc(d.name)}"><b>D${d.index}</b><span>${d.side === 'offense' ? 'Att.' : 'Déf.'}</span></div>
            <div class="stl-reps">
              ${d.repIds.map(id => { const r = repsById[id]; if (!r) return ''; return `
                <button class="stl-rep g-${r.grade}" data-rep="${esc(r.id)}" aria-label="Essai ${r.index} · ${esc(r.label)} · ${GRADE_LABEL[r.grade] || ''}"></button>`; }).join('')}
            </div>
          </div>`).join('')}
      </div>`;

    container.querySelectorAll('.stl-rep').forEach(btn => {
      btn.addEventListener('click', () => onOpenRep(btn.dataset.rep, { autoplay: true }));
      btn.addEventListener('mouseenter', () => {
        const r = repsById[btn.dataset.rep];
        const d = s.drills.find(x => x.id === r.drillId);
        tooltip.show(btn, `
          <div class="tt-top"><span class="pill g-${r.grade}">${GRADE_LABEL[r.grade]}${r.score != null ? ' · ' + r.score : ''}</span>
          <span class="tt-sub">Essai ${r.index} · ${esc(d ? d.name : '')}</span></div>
          <div class="tt-label">${esc(r.label)}</div>
          <div class="tt-sum">${esc(r.coachSummary || '')}</div>`);
      });
      btn.addEventListener('mouseleave', () => tooltip.hide());
    });
    if (active) setActive(active);
  }

  function setActive(repId) {
    active = repId;
    container.querySelectorAll('.stl-rep.is-active').forEach(b => b.classList.remove('is-active'));
    container.querySelectorAll('.stl-drill.is-active').forEach(b => b.classList.remove('is-active'));
    const b = container.querySelector(`.stl-rep[data-rep="${CSS.escape(String(repId))}"]`);
    if (b) { b.classList.add('is-active'); b.closest('.stl-drill')?.classList.add('is-active'); }
  }

  return { render, setActive };
}

// ---------- Timeline d'essai ----------
const SPEEDS = [0.25, 0.5, 1];
const KEY_EVENTS = new Set(['Snap', 'Passe', 'Sack', 'Strip sack', 'Réception', 'Incomplète', 'Interception', 'Plaquage', 'Play action', 'QB scramble', 'Fumble']);

export function createPlayTimeline(container, { onToggle, onSeek, onStep, onRestart, onSpeed }) {
  container.innerHTML = `
    <div class="ptl-ctrls">
      <button class="ptl-btn" data-act="restart" aria-label="Revenir au début" title="Revenir au début (Début)">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
      <button class="ptl-btn" data-act="back" aria-label="Image précédente" title="Image précédente (←)">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15 6v12l-8-6z"/></svg></button>
      <button class="ptl-play" data-act="toggle" aria-label="Lecture" title="Lecture / pause (Espace)">
        <svg class="i-play" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
        <svg class="i-pause" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>
      <button class="ptl-btn" data-act="fwd" aria-label="Image suivante" title="Image suivante (→)">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6v12l8-6z"/></svg></button>
      <div class="ptl-speed seg seg-sm" aria-label="Vitesse">
        ${SPEEDS.map(s => `<button class="seg-btn ${s === 1 ? 'is-on' : ''}" data-speed="${s}">${String(s).replace('.', ',')}×</button>`).join('')}
      </div>
    </div>
    <div class="ptl-scrub">
      <div class="ptl-events"></div>
      <div class="ptl-bar">
        <div class="ptl-pre"></div>
        <div class="ptl-fill"></div>
        <div class="ptl-head"></div>
      </div>
    </div>
    <div class="ptl-time"><b class="ptl-cur">0,0 s</b><span class="ptl-tot">/ 0,0 s</span></div>`;

  const bar = container.querySelector('.ptl-bar');
  const fill = container.querySelector('.ptl-fill');
  const head = container.querySelector('.ptl-head');
  const pre = container.querySelector('.ptl-pre');
  const evWrap = container.querySelector('.ptl-events');
  const cur = container.querySelector('.ptl-cur');
  const tot = container.querySelector('.ptl-tot');
  const playBtn = container.querySelector('.ptl-play');
  let n = 1, rep = null;

  container.querySelector('[data-act=toggle]').addEventListener('click', onToggle);
  container.querySelector('[data-act=back]').addEventListener('click', () => onStep(-1));
  container.querySelector('[data-act=fwd]').addEventListener('click', () => onStep(1));
  container.querySelector('[data-act=restart]').addEventListener('click', onRestart);
  container.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => onSpeed(Number(b.dataset.speed))));

  const fmt = f => (f / 10).toFixed(1).replace('.', ',') + ' s';
  const pct = f => (n <= 1 ? 0 : (f / (n - 1)) * 100);

  function frameFromEvent(ev) {
    const r = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    return t * (n - 1);
  }
  let dragging = false;
  const scrubZone = container.querySelector('.ptl-scrub');
  scrubZone.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.ptl-ev')) return;
    dragging = true; scrubZone.setPointerCapture(ev.pointerId); onSeek(frameFromEvent(ev), true);
  });
  scrubZone.addEventListener('pointermove', ev => { if (dragging) onSeek(frameFromEvent(ev), true); });
  const end = () => { dragging = false; };
  scrubZone.addEventListener('pointerup', end);
  scrubZone.addEventListener('pointercancel', end);

  function setRep(r) {
    rep = r;
    n = Math.max(2, r.nFrames || 2);
    tot.textContent = '/ ' + fmt(n - 1);
    pre.style.width = pct(Math.max(0, (r.snapFrame || 1) - 1)) + '%';
    // marqueurs d'événements (on espace les labels qui se chevauchent)
    const evs = (r.events || []).filter(e => e.label);
    let lastPct = -100, row = 0;
    evWrap.innerHTML = evs.map(e => {
      const p = pct(e.frame - 1);
      row = (p - lastPct < 9) ? (row + 1) % 2 : 0;
      lastPct = p;
      const key = KEY_EVENTS.has(e.label) ? 'is-key' : '';
      return `<button class="ptl-ev ${key} row-${row}" style="left:${p}%" data-frame="${e.frame - 1}" title="${esc(e.label)} · ${fmt(e.frame - 1)}">
        <span>${esc(e.label)}</span></button>`;
    }).join('');
    evWrap.querySelectorAll('.ptl-ev').forEach(b => b.addEventListener('click', () => onSeek(Number(b.dataset.frame), true)));
    setFrame(0);
  }

  function setFrame(f) {
    const p = pct(f);
    fill.style.width = p + '%';
    head.style.left = p + '%';
    cur.textContent = fmt(f);
    if (rep) {
      evWrap.querySelectorAll('.ptl-ev').forEach(b => b.classList.toggle('is-past', Number(b.dataset.frame) <= f + 0.01));
    }
  }

  function setPlaying(p) { playBtn.classList.toggle('is-playing', p); playBtn.setAttribute('aria-label', p ? 'Pause' : 'Lecture'); }
  function setSpeed(s) { container.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('is-on', Number(b.dataset.speed) === s)); }

  return { setRep, setFrame, setPlaying, setSpeed };
}
