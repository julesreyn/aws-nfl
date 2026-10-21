// Panneau droit: infos de l'essai, joueurs TB, feedback du joueur sélectionné, brief du drill, téléphone joueur.
import { esc } from './settings.js';
import { GRADE_LABEL } from './timeline.js';
import { renderBriefTab, speakBtn, GROUP_ORDER, GROUP_LABEL } from './briefs.js';
import * as tts from './tts.js';

const PASS_RESULT = { C: 'Complète', I: 'Incomplète', S: 'Sack', IN: 'Interception', R: 'Scramble' };

export function createPanel(container, { onSelectPlayer }) {
  let rep = null, session = null, drill = null, selected = null, tab = 'rep';
  const phone = [];

  container.innerHTML = `
    <div class="tabs" role="tablist">
      <button class="tab is-on" data-tab="rep" role="tab">Essai</button>
      <button class="tab" data-tab="brief" role="tab">Brief du drill</button>
    </div>
    <div class="panel-body"></div>
    <div class="phone is-closed" aria-label="Aperçu du téléphone joueur">
      <button class="phone-h" aria-expanded="false">
        <span class="phone-ic" aria-hidden="true"></span>
        <span>Téléphone joueur</span>
        <span class="phone-n">0</span>
      </button>
      <div class="phone-screen">
        <div class="phone-notch"></div>
        <div class="phone-list"><p class="phone-empty">Les retours envoyés aux joueurs apparaissent ici. Lance la séance en direct.</p></div>
      </div>
    </div>`;
  const body = container.querySelector('.panel-body');
  const list = container.querySelector('.phone-list');
  const phoneN = container.querySelector('.phone-n');
  const phoneEl = container.querySelector('.phone');

  container.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  container.querySelector('.phone-h').addEventListener('click', e => {
    const open = phoneEl.classList.toggle('is-closed');
    e.currentTarget.setAttribute('aria-expanded', String(!open));
  });

  tts.onChange(({ speaking, id }) => {
    container.querySelectorAll('[data-tts]').forEach(b => b.classList.toggle('is-speaking', speaking && b.dataset.tts === id));
  });

  function speakToggle(text, id) {
    const btn = container.querySelector(`[data-tts="${CSS.escape(id)}"]`);
    if (btn && btn.classList.contains('is-speaking')) { tts.stop(); return; }
    tts.speak(text, { id });
  }

  function setTab(t) {
    tab = t;
    container.querySelectorAll('.tab').forEach(b => { b.classList.toggle('is-on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    render();
  }

  function renderRep() {
    if (!rep) { body.innerHTML = '<p class="empty">Choisis un essai dans la timeline.</p>'; return; }
    const ps = Object.entries(rep.players || {}).map(([id, p]) => ({ id, ...p, meta: session.players[id] || {} }));
    const byGroup = {};
    ps.forEach(p => { const g = p.meta.group || 'Autres'; (byGroup[g] = byGroup[g] || []).push(p); });
    const groups = Object.keys(byGroup).sort((a, b) => (GROUP_ORDER.indexOf(a) + 99) % 99 - (GROUP_ORDER.indexOf(b) + 99) % 99);
    const sel = selected && rep.players?.[selected] ? { id: selected, ...rep.players[selected], meta: session.players[selected] || {} } : null;
    const selOther = selected && !sel ? session.players[selected] : null;
    const result = rep.passResult ? (PASS_RESULT[rep.passResult] || rep.passResult) : '';
    const gain = rep.playResult != null ? `${rep.playResult > 0 ? '+' : ''}${rep.playResult} yd` : '';

    body.innerHTML = `
      <section class="rep-info">
        <div class="rep-top">
          <span class="grade-big g-${rep.grade}"><b>${rep.score ?? '–'}</b><small>${GRADE_LABEL[rep.grade] || ''}</small></span>
          <div class="rep-titles">
            <p class="rep-kicker">Essai ${rep.index} · ${rep.side === 'offense' ? 'Attaque' : 'Défense'} · Q${rep.quarter} ${esc(rep.gameClock || '')}</p>
            <h2 class="rep-label">${esc(rep.label)}</h2>
          </div>
        </div>
        <p class="coach-sum">${esc(rep.coachSummary || '')}</p>
        <div class="facts">
          ${rep.formation ? `<span><small>Formation</small>${esc(rep.formation.replace('_', ' ').toLowerCase())}</span>` : ''}
          ${rep.coverage ? `<span><small>Couverture</small>${esc(rep.coverage)}</span>` : ''}
          ${result ? `<span><small>Résultat</small>${esc(result)}</span>` : ''}
          ${gain ? `<span><small>Gain</small>${esc(gain)}</span>` : ''}
        </div>
        <details class="desc"><summary>Description officielle</summary><p>${esc(rep.description || '')}</p></details>
      </section>

      ${sel ? `
      <section class="card sel-card g-border-${sel.grade}">
        <div class="card-h">
          <h3><span class="jersey">${esc(sel.meta.jersey)}</span>${esc(sel.meta.name)} <small>${esc(sel.pos || sel.meta.position)} · ${esc(sel.role || '')}</small></h3>
          <button class="x-btn" data-unsel aria-label="Désélectionner">×</button>
        </div>
        <div class="fb">
          <span class="pill g-${sel.grade}">${GRADE_LABEL[sel.grade] || ''}${sel.score != null ? ' · ' + sel.score : ''}</span>
          <blockquote>${esc(sel.feedback || 'Pas de retour pour cet essai.')}</blockquote>
          ${sel.feedback ? speakBtn('fb:' + rep.id + ':' + sel.id, 'Écouter le retour') : ''}
        </div>
        ${(sel.metrics || []).length ? `<ul class="metrics">
          ${sel.metrics.map(m => `<li class="m-${m.ok === true ? 'ok' : m.ok === false ? 'ko' : 'na'}">
            <span class="m-dot" aria-hidden="true"></span><span class="m-l">${esc(m.label)}</span>
            <b class="m-v">${esc(fmtVal(m.value))}<small>${m.value == null ? '' : esc(m.unit || '')}</small></b></li>`).join('')}
        </ul>` : ''}
      </section>` : selOther ? `
      <section class="card sel-card"><div class="card-h"><h3><span class="jersey them">${esc(selOther.jersey)}</span>${esc(selOther.name)} <small>${esc(selOther.team)} · ${esc(selOther.position)}</small></h3>
      <button class="x-btn" data-unsel aria-label="Désélectionner">×</button></div>
      <p class="muted">${selOther.ours ? 'Ce joueur ne participe pas à cet essai.' : 'Joueur adverse : pas de retour individuel.'}</p></section>` : `
      <p class="hint-sel">Clique un joueur rouge sur le terrain ou dans la liste pour voir son retour.</p>`}

      <section class="roster">
        <h3 class="roster-h">Joueurs TB sur l'essai <small>${ps.length}</small></h3>
        ${groups.map(g => `
          <div class="rg">
            <h4>${esc(GROUP_LABEL[g] || g)}</h4>
            <ul>${byGroup[g].sort((a, b) => (a.meta.jersey || 0) - (b.meta.jersey || 0)).map(p => `
              <li><button class="pl ${p.id === selected ? 'is-sel' : ''}" data-pl="${esc(p.id)}">
                <span class="dot g-${p.grade}" title="${GRADE_LABEL[p.grade] || ''}"></span>
                <span class="pl-n">${esc(p.meta.jersey)}</span>
                <span class="pl-name">${esc(p.meta.name || p.id)}</span>
                <span class="pl-pos">${esc(p.pos || p.meta.position || '')}</span>
                <span class="pl-sc">${p.score ?? ''}</span>
              </button></li>`).join('')}</ul>
          </div>`).join('')}
      </section>`;

    body.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => onSelectPlayer(b.dataset.pl === selected ? null : b.dataset.pl)));
    body.querySelector('[data-unsel]')?.addEventListener('click', () => onSelectPlayer(null));
    body.querySelectorAll('[data-tts]').forEach(b => b.addEventListener('click', () => speakToggle(sel?.feedback, b.dataset.tts)));
  }

  function render() {
    const st = body.scrollTop;
    if (tab === 'brief') renderBriefTab(body, { drill, session, selected, onSpeak: speakToggle, onSelectPlayer });
    else renderRep();
    body.scrollTop = st;
  }

  function pushPhone(msg) {
    phone.unshift({ ...msg, time: new Date() });
    phoneN.textContent = String(phone.length);
    phoneEl.classList.remove('is-closed');
    container.querySelector('.phone-h').setAttribute('aria-expanded', 'true');
    list.innerHTML = phone.slice(0, 30).map((m, i) => `
      <div class="ph-msg ${i === 0 ? 'is-new' : ''} k-${esc(m.kind)}">
        <div class="ph-top"><b>Sideline</b><span>${m.time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="ph-to">${m.kind === 'brief' ? 'Brief de drill' : "Retour d'essai"} · ${esc(m.to)}</div>
        <p>${esc(m.text)}</p>
      </div>`).join('');
  }

  return {
    setRep(r, s, d) { const changed = !rep || r.id !== rep.id; rep = r; session = s; drill = d; if (changed) body.scrollTop = 0; render(); },
    setSelected(id) { selected = id == null ? null : String(id); render(); },
    setTab,
    pushPhone,
  };
}

function fmtVal(v) {
  if (v == null) return '–';
  if (typeof v === 'number') return (Math.round(v * 100) / 100).toLocaleString('fr-FR');
  return String(v);
}
