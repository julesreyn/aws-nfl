// French TTS via Web Speech API. Picks the best available French voice.
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let voice: SpeechSynthesisVoice | null = null;
let current: { resolve: (ok: boolean) => void; timer: number } | null = null;
const listeners = new Set<(s: { speaking: boolean; id: string | null }) => void>();

const PREFERRED = [
  /premium/i, /enhanced|améliorée/i, /neural|natural/i, /google.*fran/i,
  /amélie|amelie/i, /thomas/i, /audrey/i, /marie/i, /aurélie|aurelie/i,
];

function pickVoice(): SpeechSynthesisVoice | null {
  if (!synth) return null;
  const voices = synth.getVoices().filter((v) => /^fr/i.test(v.lang));
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
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
  try { synth.addEventListener("voiceschanged", () => { voice = pickVoice(); }); } catch { /* ignore */ }
}

export function isAvailable() { return !!synth; }
export function onChange(fn: (s: { speaking: boolean; id: string | null }) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emit(state: { speaking: boolean; id: string | null }) {
  listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
}

export function stop() {
  if (synth) { try { synth.cancel(); } catch { /* ignore */ } }
  if (current) { clearTimeout(current.timer); const r = current.resolve; current = null; r(false); }
  emit({ speaking: false, id: null });
}

export function speak(text: string, { id = null, rate = 1.02 }: { id?: string | null; rate?: number } = {}): Promise<boolean> {
  stop();
  if (!text) return Promise.resolve(false);
  const words = text.split(/\s+/).length;
  const estimate = Math.max(1800, (words / 2.6) * 1000 + 1200);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      if (!current || current.resolve !== resolve) return;
      clearTimeout(current.timer);
      current = null;
      emit({ speaking: false, id: null });
      resolve(ok);
    };
    current = { resolve, timer: window.setTimeout(() => done(true), estimate * 1.6 + 2000) };
    emit({ speaking: true, id });
    if (!synth) { current.timer = window.setTimeout(() => done(true), estimate); return; }
    try {
      if (!voice) voice = pickVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "fr-FR";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onend = () => done(true);
      u.onerror = () => done(false);
      synth.speak(u);
    } catch {
      clearTimeout(current.timer);
      current.timer = window.setTimeout(() => done(false), estimate);
    }
  });
}
