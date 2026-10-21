// Terrain 2D vue de dessus (canvas). Même interface que view3d: setRep, setFrame, setSelected, resize, dispose.
const FIELD_W = 120, FIELD_H = 53.3;
const HASH_Y = [23.58, 29.72];
const TRAIL = 12; // frames de traînée

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export function createField2D(container, { onSelectPlayer } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'field2d';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let rep = null, track = null, session = null;
  let frame = 0, selected = null;
  let view = { x0: 0, x1: FIELD_W }; // fenêtre en x (yards)
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let hover = null;
  const colors = {};

  function readColors() {
    colors.ours = cssVar('--ours', '#d50a0a');
    colors.them = cssVar('--them', '#64748b');
    colors.accent = cssVar('--accent', '#f2d14b');
    colors.los = cssVar('--los', '#4aa3ff');
  }
  readColors();

  function computeView() {
    if (!rep || !track) { view = { x0: 0, x1: FIELD_W }; return; }
    let mn = Infinity, mx = -Infinity;
    for (const id in track.players) {
      for (const p of track.players[id]) { if (p) { if (p[0] < mn) mn = p[0]; if (p[0] > mx) mx = p[0]; } }
    }
    if (track.ball) for (const b of track.ball) { if (b) { mn = Math.min(mn, b[0]); mx = Math.max(mx, b[0]); } }
    if (!isFinite(mn)) { mn = rep.losX - 15; mx = rep.losX + 25; }
    const fd = rep.losX + (rep.yardsToGo || 0);
    mn = Math.min(mn, rep.losX - 8); mx = Math.max(mx, fd + 4);
    mn -= 5; mx += 5;
    view = { x0: mn, x1: mx };
    fit();
  }

  function fit() {
    // Ajuste la fenêtre à l'aspect du conteneur, terrain entier en hauteur.
    const pad = 14;
    const aw = W - pad * 2, ah = H - pad * 2;
    if (aw <= 0 || ah <= 0) return;
    let x0 = view.x0, x1 = view.x1;
    const minW = Math.max(30, (aw / ah) * FIELD_H);
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
    // limiter à [-2, 122]
    const span = x1 - x0;
    if (span >= FIELD_W + 4) { x0 = -2; x1 = FIELD_W + 2; }
    else { if (x0 < -2) { x0 = -2; x1 = x0 + span; } if (x1 > FIELD_W + 2) { x1 = FIELD_W + 2; x0 = x1 - span; } }
    scale = Math.min(aw / (x1 - x0), ah / FIELD_H);
    ox = (W - (x1 - x0) * scale) / 2 - x0 * scale;
    oy = (H - FIELD_H * scale) / 2;
    view.fx0 = x0; view.fx1 = x1;
  }

  // NFL: y=0 est la ligne de touche du bas en vue "attaque vers la droite"; on dessine y vers le haut.
  const X = x => ox + x * scale;
  const Y = y => oy + (FIELD_H - y) * scale;

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    fit();
    draw();
  }

  function sample(arr, f) {
    if (!arr || !arr.length) return null;
    const n = arr.length;
    const fc = Math.max(0, Math.min(n - 1, f));
    const i = Math.floor(fc), t = fc - i;
    const a = arr[i], b = arr[Math.min(n - 1, i + 1)];
    if (!a) return b || null;
    if (!b || t === 0) return a;
    const out = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (a.length > 2) { out.push(a[2] + (b[2] - a[2]) * t); out.push(lerpAngle(a[3] ?? 0, b[3] ?? 0, t)); }
    return out;
  }

  function drawField() {
    const g = ctx;
    // fond hors terrain
    g.fillStyle = '#0b1611';
    g.fillRect(0, 0, W, H);
    // pelouse: bandes de 5 yards
    for (let x = 10; x < 110; x += 5) {
      g.fillStyle = ((x / 5) % 2 === 0) ? '#1c4a31' : '#1a452e';
      g.fillRect(X(x), Y(FIELD_H), 5 * scale + 0.5, FIELD_H * scale);
    }
    // en-buts
    g.fillStyle = '#16402a';
    g.fillRect(X(0), Y(FIELD_H), 10 * scale, FIELD_H * scale);
    g.fillRect(X(110), Y(FIELD_H), 10 * scale, FIELD_H * scale);
    // texte en-but
    g.save();
    g.fillStyle = 'rgba(233,239,233,0.10)';
    g.font = `700 ${Math.max(10, scale * 4.2)}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [cx, rot, txt] of [[5, -Math.PI / 2, 'TAMPA BAY'], [115, Math.PI / 2, 'BUCCANEERS']]) {
      g.save(); g.translate(X(cx), Y(FIELD_H / 2)); g.rotate(rot); g.fillText(txt, 0, 0); g.restore();
    }
    g.restore();

    // lignes
    g.strokeStyle = 'rgba(240,244,240,0.55)';
    g.lineWidth = Math.max(1, scale * 0.12);
    g.beginPath();
    for (let x = 10; x <= 110; x += 5) { g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(FIELD_H)); }
    g.stroke();
    // lignes de but et de touche plus épaisses
    g.strokeStyle = 'rgba(245,248,245,0.85)';
    g.lineWidth = Math.max(1.5, scale * 0.25);
    g.strokeRect(X(0), Y(FIELD_H), FIELD_W * scale, FIELD_H * scale);
    g.beginPath(); g.moveTo(X(10), Y(0)); g.lineTo(X(10), Y(FIELD_H)); g.moveTo(X(110), Y(0)); g.lineTo(X(110), Y(FIELD_H)); g.stroke();

    // hash marks + repères de touche à chaque yard
    g.strokeStyle = 'rgba(240,244,240,0.45)';
    g.lineWidth = Math.max(1, scale * 0.1);
    g.beginPath();
    const hl = 0.7;
    for (let x = 11; x < 110; x++) {
      if (x % 5 === 0) continue;
      for (const hy of HASH_Y) { g.moveTo(X(x), Y(hy - hl / 2)); g.lineTo(X(x), Y(hy + hl / 2)); }
      g.moveTo(X(x), Y(0.3)); g.lineTo(X(x), Y(1.3));
      g.moveTo(X(x), Y(FIELD_H - 0.3)); g.lineTo(X(x), Y(FIELD_H - 1.3));
    }
    g.stroke();

    // numéros
    g.fillStyle = 'rgba(240,244,240,0.5)';
    g.font = `700 ${Math.max(9, scale * 2.1)}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let x = 20; x <= 100; x += 10) {
      const n = x <= 60 ? x - 10 : 110 - x;
      g.save(); g.translate(X(x), Y(12)); g.fillText(String(n), 0, 0); g.restore();
      g.save(); g.translate(X(x), Y(FIELD_H - 12)); g.rotate(Math.PI); g.fillText(String(n), 0, 0); g.restore();
    }
  }

  function drawLines() {
    if (!rep) return;
    const g = ctx;
    // ligne de scrimmage
    g.strokeStyle = colors.los; g.lineWidth = Math.max(2, scale * 0.28); g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(X(rep.losX), Y(0)); g.lineTo(X(rep.losX), Y(FIELD_H)); g.stroke();
    // ligne à gagner
    if (rep.yardsToGo) {
      const fx = rep.losX + rep.yardsToGo;
      if (fx < 110) {
        g.strokeStyle = colors.accent;
        g.beginPath(); g.moveTo(X(fx), Y(0)); g.lineTo(X(fx), Y(FIELD_H)); g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  function playersAt(f) {
    const out = [];
    if (!track) return out;
    for (const id in track.players) {
      const p = sample(track.players[id], f);
      if (!p) continue;
      const meta = session?.players?.[id];
      out.push({ id, x: p[0], y: p[1], s: p[2], o: p[3], meta, ours: meta ? !!meta.ours : false, inRep: !!rep?.players?.[id] });
    }
    return out;
  }

  function drawTrails(f) {
    if (!track) return;
    const g = ctx;
    const end = Math.floor(f);
    const start = Math.max(0, end - TRAIL);
    for (const id in track.players) {
      const arr = track.players[id];
      const isSel = id === String(selected);
      const ours = !!session?.players?.[id]?.ours;
      g.strokeStyle = isSel ? colors.accent : (ours ? 'rgba(255,120,110,0.55)' : 'rgba(190,200,215,0.35)');
      g.lineWidth = isSel ? Math.max(2, scale * 0.3) : Math.max(1, scale * 0.16);
      g.lineCap = 'round';
      const from = isSel ? 0 : start;
      let prev = null;
      for (let i = from; i <= end; i++) {
        const p = arr[i];
        if (!p) { prev = null; continue; }
        if (prev) {
          g.globalAlpha = isSel ? 0.25 + 0.75 * ((i - from) / Math.max(1, end - from)) : (i - start) / TRAIL * 0.9;
          g.beginPath(); g.moveTo(X(prev[0]), Y(prev[1])); g.lineTo(X(p[0]), Y(p[1])); g.stroke();
        }
        prev = p;
      }
      const cur = sample(arr, f);
      if (prev && cur) { g.beginPath(); g.moveTo(X(prev[0]), Y(prev[1])); g.lineTo(X(cur[0]), Y(cur[1])); g.stroke(); }
    }
    g.globalAlpha = 1;
  }

  function drawPlayers(f) {
    const g = ctx;
    const r = Math.max(7, scale * 0.95);
    const list = playersAt(f).sort((a, b) => (a.id === String(selected)) - (b.id === String(selected)));
    for (const p of list) {
      const cx = X(p.x), cy = Y(p.y);
      const isSel = p.id === String(selected);
      const isHover = p.id === hover;
      // orientation: vecteur (sin o, cos o) en (x, y); y canvas inversé
      if (p.o != null) {
        const a = p.o * Math.PI / 180;
        const dx = Math.sin(a), dy = -Math.cos(a);
        g.fillStyle = p.ours ? 'rgba(255,190,180,0.9)' : 'rgba(210,218,230,0.75)';
        g.beginPath();
        g.moveTo(cx + dx * r * 1.75, cy + dy * r * 1.75);
        g.lineTo(cx + (dx * 0.9 - dy * 0.55) * r, cy + (dy * 0.9 + dx * 0.55) * r);
        g.lineTo(cx + (dx * 0.9 + dy * 0.55) * r, cy + (dy * 0.9 - dx * 0.55) * r);
        g.closePath(); g.fill();
      }
      if (isSel) {
        g.save();
        g.shadowColor = colors.accent; g.shadowBlur = 18;
        g.strokeStyle = colors.accent; g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      g.fillStyle = p.ours ? colors.ours : colors.them;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = isHover || isSel ? 2.5 : 1.5;
      g.strokeStyle = isSel ? colors.accent : (isHover ? '#fff' : (p.ours ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.6)'));
      g.stroke();
      const num = p.meta?.jersey ?? '';
      g.fillStyle = p.ours ? '#fff' : '#e8edf3';
      g.font = `700 ${Math.round(r * 1.05)}px "Barlow Condensed", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), cx, cy + r * 0.06);
      if (isSel || isHover) {
        const name = p.meta ? `${p.meta.name} · ${p.meta.position}` : '';
        if (name) {
          g.font = `600 13px "Barlow", sans-serif`;
          const tw = g.measureText(name).width + 14;
          const ly = cy - r - 22;
          g.fillStyle = 'rgba(8,14,11,0.88)';
          roundRect(g, cx - tw / 2, ly - 10, tw, 20, 6); g.fill();
          g.fillStyle = isSel ? colors.accent : '#fff';
          g.fillText(name, cx, ly + 0.5);
        }
      }
    }
  }

  function drawBall(f) {
    if (!track?.ball) return;
    const b = sample(track.ball, f);
    if (!b) return;
    const g = ctx;
    const cx = X(b[0]), cy = Y(b[1]);
    const rw = Math.max(5, scale * 0.55), rh = rw * 0.62;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6;
    g.fillStyle = '#8a4b22';
    g.beginPath(); g.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = '#f6efe3'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - rw * 0.4, cy); g.lineTo(cx + rw * 0.4, cy); g.stroke();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField();
    drawLines();
    drawTrails(frame);
    drawPlayers(frame);
    drawBall(frame);
    if (!rep) {
      ctx.fillStyle = 'rgba(233,239,233,0.6)';
      ctx.font = '600 16px "Barlow", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Choisis un essai dans la timeline', W / 2, H / 2);
    }
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const p of playersAt(frame)) {
      const d = Math.hypot(X(p.x) - mx, Y(p.y) - my);
      if (d < bd) { bd = d; best = p; }
    }
    const lim = Math.max(14, scale * 1.6);
    return best && bd <= lim ? best : null;
  }

  canvas.addEventListener('click', ev => {
    const p = pick(ev);
    if (p && onSelectPlayer) onSelectPlayer(p.id);
    else if (!p && onSelectPlayer) onSelectPlayer(null);
  });
  canvas.addEventListener('mousemove', ev => {
    const p = pick(ev);
    const id = p ? p.id : null;
    canvas.style.cursor = p ? 'pointer' : 'default';
    if (id !== hover) { hover = id; draw(); }
  });
  canvas.addEventListener('mouseleave', () => { if (hover) { hover = null; draw(); } });

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  if (document.fonts?.ready) document.fonts.ready.then(() => draw());

  return {
    setRep(r, t, s) { rep = r; track = t; session = s; frame = 0; readColors(); computeView(); draw(); },
    setFrame(f) { frame = f; draw(); },
    setSelected(id) { selected = id == null ? null : String(id); draw(); },
    resize,
    dispose() { ro.disconnect(); canvas.remove(); },
  };
}
