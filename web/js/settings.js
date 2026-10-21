// Réglages persistés (localStorage, toujours en try/catch).
const KEY = 'sideline.settings.v1';
const DEFAULTS = { level: 'both', tracked: 'auto' };

export const LEVELS = [
  { id: 'silent', label: 'Silencieux', hint: 'Aucun envoi, aucune voix' },
  { id: 'rep', label: "Retour d'essai", hint: 'Une phrase après chaque essai' },
  { id: 'brief', label: 'Briefs de drill', hint: 'Un brief à la fin du drill' },
  { id: 'both', label: 'Les deux', hint: 'Retour d’essai et brief de drill' },
];

let state = { ...DEFAULTS };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...DEFAULTS, ...JSON.parse(raw) };
} catch (_) { /* stockage indisponible */ }

const subs = new Set();
export function get() { return { ...state }; }
export function set(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  subs.forEach(fn => fn(get()));
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export const wantsRep = () => state.level === 'rep' || state.level === 'both';
export const wantsBrief = () => state.level === 'brief' || state.level === 'both';

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (_) { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Popover des réglages.
export function renderSettings(pop, { trackedName } = {}) {
  const s = get();
  pop.innerHTML = `
    <h3 class="pop-title">Retours aux joueurs</h3>
    <div class="pop-group" role="radiogroup" aria-label="Niveau de retour">
      ${LEVELS.map(l => `
        <label class="radio-row ${s.level === l.id ? 'is-on' : ''}">
          <input type="radio" name="lvl" value="${l.id}" ${s.level === l.id ? 'checked' : ''}>
          <span><b>${l.label}</b><small>${l.hint}</small></span>
        </label>`).join('')}
    </div>
    <h3 class="pop-title">Joueur suivi en direct</h3>
    <div class="pop-group" role="radiogroup" aria-label="Joueur suivi">
      <label class="radio-row ${s.tracked === 'auto' ? 'is-on' : ''}">
        <input type="radio" name="trk" value="auto" ${s.tracked === 'auto' ? 'checked' : ''}>
        <span><b>Automatique</b><small>Le QB en attaque, un joueur de ligne en défense</small></span>
      </label>
      <label class="radio-row ${s.tracked === 'selected' ? 'is-on' : ''}">
        <input type="radio" name="trk" value="selected" ${s.tracked === 'selected' ? 'checked' : ''}>
        <span><b>Joueur sélectionné</b><small>${trackedName ? esc(trackedName) : 'Clique un joueur TB sur le terrain'}</small></span>
      </label>
    </div>`;
  pop.querySelectorAll('input[name=lvl]').forEach(i => i.addEventListener('change', () => { set({ level: i.value }); renderSettings(pop, { trackedName }); }));
  pop.querySelectorAll('input[name=trk]').forEach(i => i.addEventListener('change', () => { set({ tracked: i.value }); renderSettings(pop, { trackedName }); }));
}
