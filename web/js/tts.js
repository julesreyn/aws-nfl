// Synthèse vocale fr-FR (speechSynthesis). Choisit la meilleure voix française disponible.
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voice = null;
let current = null; // { resolve, timer }
const listeners = new Set();

const PREFERRED = [/premium/i, /enhanced|améliorée/i, /neural|natural/i, /google.*fran/i, /amélie|amelie/i, /thomas/i, /audrey/i, /marie/i, /aurélie|aurelie/i];

function pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices().filter(v => /^fr/i.test(v.lang));
  if (!voices.length) return null;
  const score = v => {
    let s = 0;
    PREFERRED.forEach((re, i) => { if (re.test(v.name)) s += 100 - i * 5; });
    if (/fr[-_]FR/i.test(v.lang)) s += 20;
    if (v.localService) s += 3;
    return s;
  };
  return voices.sort((a, b) => score(b) - score(a))[0];
}

if (synth) {
  voice = pickVoice();
  try { synth.addEventListener('voiceschanged', () => { voice = pickVoice(); }); } catch (_) { /* ignore */ }
}

export function isAvailable() { return !!synth; }
export function voiceName() { return voice ? voice.name : null; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(state) { listeners.forEach(fn => { try { fn(state); } catch (_) { /* ignore */ } }); }

export function stop() {
  if (synth) { try { synth.cancel(); } catch (_) { /* ignore */ } }
  if (current) { clearTimeout(current.timer); const r = current.resolve; current = null; r(false); }
  emit({ speaking: false, id: null });
}

// speak(text, { id }) -> Promise<boolean> résolue à la fin de la lecture (ou après une durée estimée).
export function speak(text, { id = null, rate = 1.02 } = {}) {
  stop();
  if (!text) return Promise.resolve(false);
  const words = text.split(/\s+/).length;
  const estimate = Math.max(1800, (words / 2.6) * 1000 + 1200);
  return new Promise(resolve => {
    const done = ok => {
      if (!current || current.resolve !== resolve) return;
      clearTimeout(current.timer); current = null;
      emit({ speaking: false, id: null });
      resolve(ok);
    };
    current = { resolve, timer: setTimeout(() => done(true), estimate * 1.6 + 2000) };
    emit({ speaking: true, id });
    if (!synth) { current.timer = setTimeout(() => done(true), estimate); return; }
    try {
      if (!voice) voice = pickVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onend = () => done(true);
      u.onerror = () => done(false);
      synth.speak(u);
    } catch (_) {
      clearTimeout(current.timer);
      current.timer = setTimeout(() => done(false), estimate);
    }
  });
}

export function speaking() { return !!current; }
