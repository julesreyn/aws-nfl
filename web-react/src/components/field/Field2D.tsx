import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { sampleRow } from "@/lib/tracking";
import type { PlayTracking, PlayerInfo, Rep, Session } from "@/types";

// Terrain 2D vue de dessus (canvas), porté fidèlement de web/js/field2d.js.
const FIELD_W = 120;
const FIELD_H = 53.3;
const HASH_Y = [23.58, 29.72];
const TRAIL = 12; // frames de traînée

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Colors {
  ours: string;
  them: string;
  accent: string;
  los: string;
}

interface DrawPlayer {
  id: string;
  x: number;
  y: number;
  s: number | undefined;
  o: number | undefined;
  meta: PlayerInfo | undefined;
  ours: boolean;
  inRep: boolean;
}

interface Scene {
  rep: Rep | null;
  track: PlayTracking | null;
  session: Session | null;
  frame: number;
  selected: string | null;
}

export function Field2D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // State needed for drawing, read through selectors and mirrored into a ref so
  // the rAF-independent draw routine always sees the latest values.
  const rep = useStore((s) => s.rep);
  const tracking = useStore((s) => s.tracking);
  const session = useStore((s) => s.session);
  const frame = useStore((s) => s.frame);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);

  // Resolve the tracking slice for the current rep (keyed by playId, fallback id).
  const track: PlayTracking | null = rep
    ? tracking?.[String(rep.playId)] ?? tracking?.[String(rep.id)] ?? null
    : null;

  // Mutable scene snapshot for event handlers (hover/pick) and draw.
  const sceneRef = useRef<Scene>({ rep: null, track: null, session: null, frame: 0, selected: null });
  sceneRef.current = { rep, track, session, frame, selected };

  // Rendering geometry + hover kept in refs (imperative canvas state).
  const geomRef = useRef({ W: 0, H: 0, dpr: 1, scale: 1, ox: 0, oy: 0 });
  const viewRef = useRef({ x0: 0, x1: FIELD_W, fx0: 0, fx1: FIELD_W });
  const hoverRef = useRef<string | null>(null);
  const colorsRef = useRef<Colors>({ ours: "#d50a0a", them: "#64748b", accent: "#f2d14b", los: "#4aa3ff" });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const geom = geomRef.current;
    const view = viewRef.current;
    const colors = colorsRef.current;

    function readColors() {
      colors.ours = cssVar("--ours", "#d50a0a");
      colors.them = cssVar("--them", "#64748b");
      colors.accent = cssVar("--brand-accent", "") || cssVar("--accent", "#f2d14b");
      colors.los = cssVar("--los", "#4aa3ff");
    }
    readColors();

    // yards -> pixels
    const X = (x: number) => geom.ox + x * geom.scale;
    const Y = (y: number) => geom.oy + (FIELD_H - y) * geom.scale;

    function fit() {
      const pad = 14;
      const aw = geom.W - pad * 2;
      const ah = geom.H - pad * 2;
      if (aw <= 0 || ah <= 0) return;
      let x0 = view.x0;
      let x1 = view.x1;
      const minW = Math.max(30, (aw / ah) * FIELD_H);
      if (x1 - x0 < minW) {
        const c = (x0 + x1) / 2;
        x0 = c - minW / 2;
        x1 = c + minW / 2;
      }
      const span = x1 - x0;
      if (span >= FIELD_W + 4) {
        x0 = -2;
        x1 = FIELD_W + 2;
      } else {
        if (x0 < -2) {
          x0 = -2;
          x1 = x0 + span;
        }
        if (x1 > FIELD_W + 2) {
          x1 = FIELD_W + 2;
          x0 = x1 - span;
        }
      }
      geom.scale = Math.min(aw / (x1 - x0), ah / FIELD_H);
      geom.ox = (geom.W - (x1 - x0) * geom.scale) / 2 - x0 * geom.scale;
      geom.oy = (geom.H - FIELD_H * geom.scale) / 2;
      view.fx0 = x0;
      view.fx1 = x1;
    }

    function computeView() {
      const { rep, track } = sceneRef.current;
      if (!rep || !track) {
        view.x0 = 0;
        view.x1 = FIELD_W;
        fit();
        return;
      }
      let mn = Infinity;
      let mx = -Infinity;
      for (const id in track.players) {
        for (const p of track.players[id]) {
          if (p) {
            if (p[0] < mn) mn = p[0];
            if (p[0] > mx) mx = p[0];
          }
        }
      }
      if (track.ball) {
        for (const b of track.ball) {
          if (b) {
            mn = Math.min(mn, b[0]);
            mx = Math.max(mx, b[0]);
          }
        }
      }
      if (!isFinite(mn)) {
        mn = rep.losX - 15;
        mx = rep.losX + 25;
      }
      const fd = rep.losX + (rep.yardsToGo || 0);
      mn = Math.min(mn, rep.losX - 8);
      mx = Math.max(mx, fd + 4);
      mn -= 5;
      mx += 5;
      view.x0 = mn;
      view.x1 = mx;
      fit();
    }

    function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function playersAt(f: number): DrawPlayer[] {
      const out: DrawPlayer[] = [];
      const { track, session, rep } = sceneRef.current;
      if (!track) return out;
      for (const id in track.players) {
        const p = sampleRow(track.players[id], f);
        if (!p) continue;
        const meta = session?.players?.[id];
        out.push({
          id,
          x: p[0],
          y: p[1],
          s: p[2],
          o: p[3],
          meta,
          ours: meta ? !!meta.ours : false,
          inRep: !!rep?.players?.[id],
        });
      }
      return out;
    }

    function drawField() {
      const g = ctx!;
      const { W, H, scale } = geom;
      g.fillStyle = "#0b1611";
      g.fillRect(0, 0, W, H);
      // pelouse: bandes de 5 yards
      for (let x = 10; x < 110; x += 5) {
        g.fillStyle = (x / 5) % 2 === 0 ? "#1c4a31" : "#1a452e";
        g.fillRect(X(x), Y(FIELD_H), 5 * scale + 0.5, FIELD_H * scale);
      }
      // en-buts
      g.fillStyle = "#16402a";
      g.fillRect(X(0), Y(FIELD_H), 10 * scale, FIELD_H * scale);
      g.fillRect(X(110), Y(FIELD_H), 10 * scale, FIELD_H * scale);
      // texte en-but
      g.save();
      g.fillStyle = "rgba(233,239,233,0.10)";
      g.font = `700 ${Math.max(10, scale * 4.2)}px "Barlow Condensed", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const endzones: Array<[number, number, string]> = [
        [5, -Math.PI / 2, "TAMPA BAY"],
        [115, Math.PI / 2, "BUCCANEERS"],
      ];
      for (const [cx, rot, txt] of endzones) {
        g.save();
        g.translate(X(cx), Y(FIELD_H / 2));
        g.rotate(rot);
        g.fillText(txt, 0, 0);
        g.restore();
      }
      g.restore();

      // lignes
      g.strokeStyle = "rgba(240,244,240,0.55)";
      g.lineWidth = Math.max(1, scale * 0.12);
      g.beginPath();
      for (let x = 10; x <= 110; x += 5) {
        g.moveTo(X(x), Y(0));
        g.lineTo(X(x), Y(FIELD_H));
      }
      g.stroke();
      // lignes de but et de touche plus épaisses
      g.strokeStyle = "rgba(245,248,245,0.85)";
      g.lineWidth = Math.max(1.5, scale * 0.25);
      g.strokeRect(X(0), Y(FIELD_H), FIELD_W * scale, FIELD_H * scale);
      g.beginPath();
      g.moveTo(X(10), Y(0));
      g.lineTo(X(10), Y(FIELD_H));
      g.moveTo(X(110), Y(0));
      g.lineTo(X(110), Y(FIELD_H));
      g.stroke();

      // hash marks + repères de touche à chaque yard
      g.strokeStyle = "rgba(240,244,240,0.45)";
      g.lineWidth = Math.max(1, scale * 0.1);
      g.beginPath();
      const hl = 0.7;
      for (let x = 11; x < 110; x++) {
        if (x % 5 === 0) continue;
        for (const hy of HASH_Y) {
          g.moveTo(X(x), Y(hy - hl / 2));
          g.lineTo(X(x), Y(hy + hl / 2));
        }
        g.moveTo(X(x), Y(0.3));
        g.lineTo(X(x), Y(1.3));
        g.moveTo(X(x), Y(FIELD_H - 0.3));
        g.lineTo(X(x), Y(FIELD_H - 1.3));
      }
      g.stroke();

      // numéros
      g.fillStyle = "rgba(240,244,240,0.5)";
      g.font = `700 ${Math.max(9, scale * 2.1)}px "Barlow Condensed", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (let x = 20; x <= 100; x += 10) {
        const n = x <= 60 ? x - 10 : 110 - x;
        g.save();
        g.translate(X(x), Y(12));
        g.fillText(String(n), 0, 0);
        g.restore();
        g.save();
        g.translate(X(x), Y(FIELD_H - 12));
        g.rotate(Math.PI);
        g.fillText(String(n), 0, 0);
        g.restore();
      }
    }

    function drawLines() {
      const { rep } = sceneRef.current;
      if (!rep) return;
      const g = ctx!;
      const { scale } = geom;
      // ligne de scrimmage
      g.strokeStyle = colors.los;
      g.lineWidth = Math.max(2, scale * 0.28);
      g.globalAlpha = 0.9;
      g.beginPath();
      g.moveTo(X(rep.losX), Y(0));
      g.lineTo(X(rep.losX), Y(FIELD_H));
      g.stroke();
      // ligne à gagner
      if (rep.yardsToGo) {
        const fx = rep.losX + rep.yardsToGo;
        if (fx < 110) {
          g.strokeStyle = colors.accent;
          g.beginPath();
          g.moveTo(X(fx), Y(0));
          g.lineTo(X(fx), Y(FIELD_H));
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    function drawTrails(f: number) {
      const { track, session, selected } = sceneRef.current;
      if (!track) return;
      const g = ctx!;
      const { scale } = geom;
      const end = Math.floor(f);
      const start = Math.max(0, end - TRAIL);
      for (const id in track.players) {
        const arr = track.players[id];
        const isSel = id === String(selected);
        const ours = !!session?.players?.[id]?.ours;
        g.strokeStyle = isSel ? colors.accent : ours ? "rgba(255,120,110,0.55)" : "rgba(190,200,215,0.35)";
        g.lineWidth = isSel ? Math.max(2, scale * 0.3) : Math.max(1, scale * 0.16);
        g.lineCap = "round";
        const from = isSel ? 0 : start;
        let prev: number[] | null = null;
        for (let i = from; i <= end; i++) {
          const p = arr[i];
          if (!p) {
            prev = null;
            continue;
          }
          if (prev) {
            g.globalAlpha = isSel
              ? 0.25 + 0.75 * ((i - from) / Math.max(1, end - from))
              : ((i - start) / TRAIL) * 0.9;
            g.beginPath();
            g.moveTo(X(prev[0]), Y(prev[1]));
            g.lineTo(X(p[0]), Y(p[1]));
            g.stroke();
          }
          prev = p;
        }
        const cur = sampleRow(arr, f);
        if (prev && cur) {
          g.beginPath();
          g.moveTo(X(prev[0]), Y(prev[1]));
          g.lineTo(X(cur[0]), Y(cur[1]));
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    function drawPlayers(f: number) {
      const g = ctx!;
      const { scale } = geom;
      const { selected } = sceneRef.current;
      const r = Math.max(7, scale * 0.95);
      const list = playersAt(f).sort(
        (a, b) => Number(a.id === String(selected)) - Number(b.id === String(selected)),
      );
      for (const p of list) {
        const cx = X(p.x);
        const cy = Y(p.y);
        const isSel = p.id === String(selected);
        const isHover = p.id === hoverRef.current;
        // orientation: vecteur (sin o, cos o) en (x, y); y canvas inversé
        if (p.o != null) {
          const a = (p.o * Math.PI) / 180;
          const dx = Math.sin(a);
          const dy = -Math.cos(a);
          g.fillStyle = p.ours ? "rgba(255,190,180,0.9)" : "rgba(210,218,230,0.75)";
          g.beginPath();
          g.moveTo(cx + dx * r * 1.75, cy + dy * r * 1.75);
          g.lineTo(cx + (dx * 0.9 - dy * 0.55) * r, cy + (dy * 0.9 + dx * 0.55) * r);
          g.lineTo(cx + (dx * 0.9 + dy * 0.55) * r, cy + (dy * 0.9 - dx * 0.55) * r);
          g.closePath();
          g.fill();
        }
        if (isSel) {
          g.save();
          g.shadowColor = colors.accent;
          g.shadowBlur = 18;
          g.strokeStyle = colors.accent;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(cx, cy, r + 5, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        }
        g.fillStyle = p.ours ? colors.ours : colors.them;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = isHover || isSel ? 2.5 : 1.5;
        g.strokeStyle = isSel
          ? colors.accent
          : isHover
            ? "#fff"
            : p.ours
              ? "rgba(255,255,255,0.85)"
              : "rgba(15,23,42,0.6)";
        g.stroke();
        const num = p.meta?.jersey ?? "";
        g.fillStyle = p.ours ? "#fff" : "#e8edf3";
        g.font = `700 ${Math.round(r * 1.05)}px "Barlow Condensed", sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(num), cx, cy + r * 0.06);
        if (isSel || isHover) {
          const name = p.meta ? `${p.meta.name} · ${p.meta.position}` : "";
          if (name) {
            g.font = `600 13px "Barlow", sans-serif`;
            const tw = g.measureText(name).width + 14;
            const ly = cy - r - 22;
            g.fillStyle = "rgba(8,14,11,0.88)";
            roundRect(g, cx - tw / 2, ly - 10, tw, 20, 6);
            g.fill();
            g.fillStyle = isSel ? colors.accent : "#fff";
            g.fillText(name, cx, ly + 0.5);
          }
        }
      }
    }

    function drawBall(f: number) {
      const { track } = sceneRef.current;
      if (!track?.ball) return;
      const b = sampleRow(track.ball as (number[] | null)[], f);
      if (!b) return;
      const g = ctx!;
      const { scale } = geom;
      const cx = X(b[0]);
      const cy = Y(b[1]);
      const rw = Math.max(5, scale * 0.55);
      const rh = rw * 0.62;
      g.save();
      g.shadowColor = "rgba(0,0,0,0.6)";
      g.shadowBlur = 6;
      g.fillStyle = "#8a4b22";
      g.beginPath();
      g.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = "#f6efe3";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - rw * 0.4, cy);
      g.lineTo(cx + rw * 0.4, cy);
      g.stroke();
    }

    function draw() {
      const { dpr, W, H } = geom;
      const { rep, frame } = sceneRef.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawField();
      drawLines();
      drawTrails(frame);
      drawPlayers(frame);
      drawBall(frame);
      if (!rep) {
        ctx!.fillStyle = "rgba(233,239,233,0.6)";
        ctx!.font = '600 16px "Barlow", sans-serif';
        ctx!.textAlign = "center";
        ctx!.fillText("Choisis un essai dans la timeline", W / 2, H / 2);
      }
    }

    function resize() {
      const rect = container!.getBoundingClientRect();
      geom.dpr = Math.min(window.devicePixelRatio || 1, 2);
      geom.W = Math.max(10, rect.width);
      geom.H = Math.max(10, rect.height);
      canvas!.width = Math.round(geom.W * geom.dpr);
      canvas!.height = Math.round(geom.H * geom.dpr);
      canvas!.style.width = geom.W + "px";
      canvas!.style.height = geom.H + "px";
      fit();
      draw();
    }

    // rAF loop driven by scene snapshot: redraws whenever frame/selected/scene change.
    let raf = 0;
    const prev = { frame: -1, selected: "\u0000", repId: "\u0000", hover: "\u0000", track: null as PlayTracking | null };
    function tick() {
      const sc = sceneRef.current;
      const repId = sc.rep ? String(sc.rep.id) : "";
      const hov = hoverRef.current ?? "";
      const sel = sc.selected ?? "";
      if (
        sc.frame !== prev.frame ||
        sel !== prev.selected ||
        repId !== prev.repId ||
        hov !== prev.hover ||
        sc.track !== prev.track
      ) {
        if (repId !== prev.repId || sc.track !== prev.track) {
          readColors();
          computeView();
        }
        prev.frame = sc.frame;
        prev.selected = sel;
        prev.repId = repId;
        prev.hover = hov;
        prev.track = sc.track;
        draw();
      }
      raf = requestAnimationFrame(tick);
    }

    // pick nearest player to pointer
    function pick(ev: MouseEvent): DrawPlayer | null {
      const rect = canvas!.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      let best: DrawPlayer | null = null;
      let bd = Infinity;
      for (const p of playersAt(sceneRef.current.frame)) {
        const d = Math.hypot(X(p.x) - mx, Y(p.y) - my);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      const lim = Math.max(14, geom.scale * 1.6);
      return best && bd <= lim ? best : null;
    }

    function onClick(ev: MouseEvent) {
      const p = pick(ev);
      select(p ? p.id : null);
    }
    function onMove(ev: MouseEvent) {
      const p = pick(ev);
      const id = p ? p.id : null;
      canvas!.style.cursor = p ? "pointer" : "default";
      if (id !== hoverRef.current) hoverRef.current = id;
    }
    function onLeave() {
      if (hoverRef.current) hoverRef.current = null;
    }

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);

    resize();
    computeView();
    if (document.fonts?.ready) document.fonts.ready.then(() => draw());
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
    // Set up once; all dynamic data flows through sceneRef + rAF loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

export default Field2D;
