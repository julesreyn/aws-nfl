// Onglet "Brief du drill" + aperçu des briefs en fin de drill (mode séance en direct).
import { esc } from './settings.js';

const GROUP_ORDER = ['QB', 'OL', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB'];
const GROUP_LABEL = { QB: 'Quarterback', OL: 'Ligne offensive', RB: 'Running backs', WR: 'Receveurs', TE: 'Tight ends', DL: 'Ligne défensive', LB: 'Linebackers', DB: 'Arrière-garde' };
export const POINT_META = {
  good: { icon: '✓', label: 'Ce qui marche' },
  fix: { icon: '!', label: 'À corriger' },
  next: { icon: '→', label: 'Prochain essai' },
};
export { GROUP_ORDER, GROUP_LABEL };

export const speakBtn = (id, label = 'Écouter') =>
  `<button class="tts-btn" data-tts="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"><span aria-hidden="true">🔊</span><span class="tts-wave" aria-hidden="true"><i></i><i></i><i></i></span></button>`;

export function renderBriefTab(el, { drill, session, selected, onSpeak, onSelectPlayer }) {
  if (!drill) { el.innerHTML = '<p class="empty">Aucun drill pour cet essai.</p>'; return; }
  const b = drill.brief || {};
  const groups = Object.entries(b.groups || {}).sort((a, c) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(c[0]));
  const pb = selected ? b.players?.[selected] : null;
  const pm = selected ? session.players[selected] : null;
  const sm = drill.summary || {};
  const briefPlayers = Object.keys(b.players || {}).map(id => session.players[id]).filter(Boolean)
    .sort((a, c) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(c.group));

  el.innerHTML = `
    <div class="bf-head">
      <div>
        <h2 class="bf-title">${esc(drill.name)}</h2>
        <p class="bf-sub">${drill.repIds.length} essais ·
          <span class="mini g-green">${sm.green || 0}</span><span class="mini g-orange">${sm.orange || 0}</span><span class="mini g-red">${sm.red || 0}</span></p>
      </div>
    </div>

    <section class="card bf-coach">
      <div class="card-h"><h3>Pour l'entraîneur</h3>${b.coach ? speakBtn('coach:' + drill.id, 'Écouter le brief entraîneur') : ''}</div>
      <p>${esc(b.coach || 'Pas de brief pour ce drill.')}</p>
    </section>

    <section class="card bf-player">
      ${pb && pm ? `
        <div class="card-h">
          <h3><span class="jersey">${esc(pm.jersey)}</span>${esc(pm.name)} <small>${esc(pm.position)}</small></h3>
          ${speakBtn('brief:' + drill.id + ':' + selected, 'Écouter le brief du joueur')}
        </div>
        <ol class="points">
          ${(pb.points || []).map(p => `<li class="pt pt-${esc(p.kind)}"><span class="pt-ic" aria-hidden="true">${POINT_META[p.kind]?.icon || '•'}</span>
            <span><small>${POINT_META[p.kind]?.label || ''}</small>${esc(p.text)}</span></li>`).join('')}
        </ol>` : `
        <div class="card-h"><h3>Brief individuel</h3></div>
        <p class="muted">${selected && pm ? `${esc(pm.name)} n'a pas de brief sur ce drill.` : 'Choisis un joueur TB pour voir son brief en 3 points.'}</p>
        <div class="chips">${briefPlayers.slice(0, 14).map(p => `<button class="chip" data-pick="${esc(p.id)}"><b>${esc(p.jersey)}</b> ${esc(p.name.split(' ').slice(-1)[0])}</button>`).join('')}</div>`}
    </section>

    ${groups.length ? `<section class="card bf-groups"><div class="card-h"><h3>Par groupe</h3></div>
      <dl>${groups.map(([g, t]) => `<div class="bf-g"><dt>${esc(GROUP_LABEL[g] || g)}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl></section>` : ''}`;

  el.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('click', () => onSelectPlayer(c.dataset.pick)));
  el.querySelectorAll('[data-tts]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.tts;
    let text = '';
    if (id.startsWith('coach:')) text = b.coach;
    else text = pb?.text || (pb?.points || []).map(p => p.text).join(' ');
    onSpeak(text, id);
  }));
}

// Aperçu des briefs en fin de drill: compte à rebours, annuler / modifier / envoyer.
export function openBriefPreview(root, { drill, session, playerId, seconds = 5, onSend, onCancel }) {
  const b = drill.brief || {};
  const pb = playerId ? b.players?.[playerId] : null;
  const pm = playerId ? session.players[playerId] : null;
  const recipients = Object.keys(b.players || {}).length;
  const text = pb?.text || '';
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bpTitle">
        <div class="modal-h">
          <div>
            <p class="modal-kicker">Fin du drill</p>
            <h2 id="bpTitle">${esc(drill.name)}</h2>
          </div>
          <div class="count" aria-live="polite"><svg viewBox="0 0 40 40"><circle class="count-bg" cx="20" cy="20" r="17"/><circle class="count-fg" cx="20" cy="20" r="17"/></svg><b>${seconds}</b></div>
        </div>
        <p class="modal-auto">Envoi auto dans <b class="count-n">${seconds}</b> s à ${recipients} joueur${recipients > 1 ? 's' : ''}</p>
        <div class="modal-body">
          <section>
            <h3>Brief de ${pm ? `<span class="jersey">${esc(pm.jersey)}</span>${esc(pm.name)}` : 'l’équipe'}</h3>
            <textarea class="bp-text" rows="5" readonly>${esc(text || b.coach || '')}</textarea>
          </section>
          <section class="bp-coach"><h3>Pour l'entraîneur</h3><p>${esc(b.coach || '')}</p></section>
        </div>
        <div class="modal-f">
          <button class="btn ghost" data-act="cancel">Annuler l'envoi</button>
          <button class="btn" data-act="edit">Modifier le texte</button>
          <button class="btn primary" data-act="send">Envoyer maintenant</button>
        </div>
      </div>
    </div>`;
  const ta = root.querySelector('.bp-text');
  const nEl = root.querySelector('.count b');
  const nEl2 = root.querySelector('.count-n');
  const auto = root.querySelector('.modal-auto');
  const ring = root.querySelector('.count-fg');
  const C = 2 * Math.PI * 17;
  ring.style.strokeDasharray = C;
  let left = seconds * 1000, last = performance.now(), raf = 0, paused = false, closed = false;

  const close = () => { closed = true; cancelAnimationFrame(raf); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const send = () => { if (closed) return; const t = ta.value.trim(); close(); onSend(t); };
  const cancel = () => { if (closed) return; close(); onCancel(); };
  const tick = now => {
    if (closed) return;
    if (!paused) left -= now - last;
    last = now;
    const s = Math.max(0, Math.ceil(left / 1000));
    nEl.textContent = s; nEl2.textContent = s;
    ring.style.strokeDashoffset = C * (1 - Math.max(0, left) / (seconds * 1000));
    if (left <= 0) return send();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
  document.addEventListener('keydown', onKey, true);

  root.querySelector('[data-act=cancel]').addEventListener('click', cancel);
  root.querySelector('[data-act=send]').addEventListener('click', send);
  root.querySelector('[data-act=edit]').addEventListener('click', () => {
    paused = true; ta.readOnly = false; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    auto.textContent = 'Envoi automatique en pause. Modifie puis envoie.';
    root.querySelector('.count').classList.add('is-paused');
  });
  root.querySelector('.modal-back').addEventListener('click', e => { if (e.target.classList.contains('modal-back')) { paused = true; } });
  return { close };
}
