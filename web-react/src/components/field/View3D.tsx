import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useStore } from "@/store";
import type {
  CameraPreset,
  PlayTracking,
  Rep,
  RouteInfo,
  Session,
} from "@/types";

// View3D — replay 3D d'un essai (terrain, joueurs, ballon, caméras, fantôme).
// Porté fidèlement de web/js/view3d.js en composant React.
// Repère: terrain (x, y) en yards -> three (X = x, Y = haut, Z = -y). 1 unité = 1 yard.

const FIELD_L = 120;
const FIELD_W = 53.3;
const OURS = "#d50a0a";
const THEM = "#64748b";
const GHOST = 0x22d3ee;
const HASH_Y = 23.58;
const SPR = 0.021; // taille écran des pastilles de numéro (plus petites pour voir les joueurs)

type Vec2 = { x: number; y: number };
type SampleResult = { x: number; y: number; s: number; o: number | null };
type Row = number[] | null;

const W = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const num = (v: unknown, d = 0) =>
  typeof v === "number" && isFinite(v) ? v : d;

// ---------------------------------------------------------------- échantillonnage
function validRow(r: Row | undefined): r is number[] {
  return Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number";
}
function nearestValid(arr: Row[], i: number, dir: number): number {
  for (let k = i; k >= 0 && k < arr.length; k += dir) if (validRow(arr[k])) return k;
  return -1;
}
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}
// Retourne {x, y, s, o} interpolé au frame flottant f (0-based) ou null.
function sample(arr: Row[] | null | undefined, f: number): SampleResult | null {
  if (!Array.isArray(arr) || !arr.length) return null;
  const n = arr.length;
  const fc = clamp(f, 0, n - 1);
  const i0 = Math.floor(fc);
  const i1 = Math.min(n - 1, i0 + 1);
  const t = fc - i0;
  let a = validRow(arr[i0]) ? i0 : -1;
  let b = validRow(arr[i1]) ? i1 : -1;
  if (a < 0 && b < 0) {
    a = nearestValid(arr, i0, -1);
    b = nearestValid(arr, i1, 1);
    if (a < 0 && b < 0) return null;
  }
  if (a < 0) a = b;
  if (b < 0) b = a;
  const ra = arr[a] as number[];
  const rb = arr[b] as number[];
  const tt = a === b ? 0 : t;
  return {
    x: ra[0] + (rb[0] - ra[0]) * tt,
    y: ra[1] + (rb[1] - ra[1]) * tt,
    s: num(ra[2]) + (num(rb[2]) - num(ra[2])) * tt,
    o:
      ra[3] == null && rb[3] == null
        ? null
        : lerpAngle(num(ra[3], num(rb[3])), num(rb[3], num(ra[3])), tt),
  };
}

// ---------------------------------------------------------------- textures canvas
function makeFieldTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 32; // px par yard
  const cw = FIELD_L * S,
    ch = Math.round(FIELD_W * S);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d")!;
  const py = (y: number) => (FIELD_W - y) * S;
  // pelouse: bandes alternées de 5 yd
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? "#2f7a34" : "#2a6f30";
    g.fillRect(i * 5 * S, 0, 5 * S + 1, ch);
  }
  // bruit léger
  const img = g.getImageData(0, 0, cw, ch);
  for (let k = 0; k < img.data.length; k += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[k] += n;
    img.data[k + 1] += n;
    img.data[k + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // en-buts
  g.fillStyle = "#7a0a0a";
  g.fillRect(0, 0, 10 * S, ch);
  g.fillStyle = "#334155";
  g.fillRect(110 * S, 0, 10 * S, ch);
  g.save();
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.font = `900 ${5.2 * S}px "Arial Black", Impact, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.translate(5 * S, ch / 2);
  g.rotate(-Math.PI / 2);
  g.fillText("TAMPA BAY", 0, 0);
  g.restore();
  g.save();
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = `900 ${4.6 * S}px "Arial Black", Impact, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.translate(115 * S, ch / 2);
  g.rotate(Math.PI / 2);
  g.fillText("SIDELINE", 0, 0);
  g.restore();
  // lignes
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.lineWidth = 0.13 * S;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cw - g.lineWidth, ch - g.lineWidth);
  for (let x = 10; x <= 110; x += 5) {
    g.lineWidth = x === 10 || x === 110 ? 0.25 * S : 0.13 * S;
    g.beginPath();
    g.moveTo(x * S, 0);
    g.lineTo(x * S, ch);
    g.stroke();
  }
  // ticks 1 yd: bords + hash marks
  g.lineWidth = 0.1 * S;
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const [y0, y1] of [
      [0.3, 1.0],
      [FIELD_W - 1.0, FIELD_W - 0.3],
      [HASH_Y - 0.35, HASH_Y + 0.35],
      [FIELD_W - HASH_Y - 0.35, FIELD_W - HASH_Y + 0.35],
    ]) {
      g.beginPath();
      g.moveTo(x * S, py(y0));
      g.lineTo(x * S, py(y1));
      g.stroke();
    }
  }
  // points d'essai (2 yd)
  for (const x of [12, 108]) {
    g.beginPath();
    g.moveTo(x * S, py(FIELD_W / 2 - 0.4));
    g.lineTo(x * S, py(FIELD_W / 2 + 0.4));
    g.stroke();
  }
  // numéros
  g.font = `bold ${2 * S}px "Clarendon", Georgia, serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let x = 20; x <= 100; x += 10) {
    const v = x <= 60 ? x - 10 : 110 - x;
    const label = String(v);
    // bas (y ≈ 12) lisible depuis la touche y=0
    g.save();
    g.translate(x * S, py(12));
    g.fillText(label.split("").join(" "), 0, 0);
    g.restore();
    // haut (y ≈ 41.3) retourné
    g.save();
    g.translate(x * S, py(FIELD_W - 12));
    g.rotate(Math.PI);
    g.fillText(label.split("").join(" "), 0, 0);
    g.restore();
    // flèches directionnelles
    if (v !== 50) {
      const dir = x < 60 ? -1 : 1;
      for (const [yy, flip] of [
        [12, 1],
        [FIELD_W - 12, -1],
      ]) {
        const ax = x * S + dir * 1.9 * S,
          ay = py(yy) - flip * 0.55 * S;
        g.beginPath();
        g.moveTo(ax + dir * 0.55 * S, ay);
        g.lineTo(ax, ay - 0.3 * S);
        g.lineTo(ax, ay + 0.3 * S);
        g.closePath();
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#05070d");
  gr.addColorStop(0.55, "#0d1526");
  gr.addColorStop(1, "#1b2a44");
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeNumberTexture(
  jersey: number | null | undefined,
  color: string,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.stroke();
  g.fillStyle = "#fff";
  g.font = `bold ${String(jersey).length > 1 ? 58 : 66}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(jersey == null ? "?" : String(jersey), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- bulles d'explication
// Crée une texture "bulle BD" avec un titre + une ligne de détail. Renvoie {tex, w, h}.
function makeBubbleTexture(
  title: string,
  detail: string | null,
  { accent = "#38bdf8", warn = false }: { accent?: string; warn?: boolean } = {},
): { tex: THREE.CanvasTexture; w: number; h: number } {
  const DPR = 2;
  const padX = 26,
    padY = 16,
    tail = 20;
  const fTitle = 34,
    fDetail = 26,
    gap = 8;
  const mc = document.createElement("canvas").getContext("2d")!;
  mc.font = `800 ${fTitle}px "Barlow Condensed", system-ui, sans-serif`;
  const wTitle = mc.measureText(title || "").width;
  mc.font = `600 ${fDetail}px Barlow, system-ui, sans-serif`;
  const wDetail = detail ? mc.measureText(detail).width : 0;
  const innerW = Math.max(wTitle, wDetail, 60);
  const bw = Math.ceil(innerW + padX * 2);
  const bh = Math.ceil(fTitle + (detail ? gap + fDetail : 0) + padY * 2);
  const Wd = bw,
    H = bh + tail;
  const c = document.createElement("canvas");
  c.width = Wd * DPR;
  c.height = H * DPR;
  const g = c.getContext("2d")!;
  g.scale(DPR, DPR);
  // corps arrondi
  const r = 14;
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(bw, 0, bw, bh, r);
  g.arcTo(bw, bh, 0, bh, r);
  g.arcTo(0, bh, 0, 0, r);
  g.arcTo(0, 0, bw, 0, r);
  g.closePath();
  // queue (triangle vers le bas)
  g.moveTo(bw / 2 - tail * 0.6, bh);
  g.lineTo(bw / 2, bh + tail);
  g.lineTo(bw / 2 + tail * 0.6, bh);
  g.fillStyle = warn ? "rgba(69, 10, 10, 0.92)" : "rgba(8, 15, 28, 0.92)";
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = warn ? "#f87171" : accent;
  g.stroke();
  // textes
  g.textAlign = "center";
  g.fillStyle = warn ? "#fecaca" : "#fff";
  g.font = `800 ${fTitle}px "Barlow Condensed", system-ui, sans-serif`;
  g.textBaseline = "top";
  g.fillText(title || "", bw / 2, padY);
  if (detail) {
    g.fillStyle = warn ? "#fca5a5" : "#cbd5e1";
    g.font = `600 ${fDetail}px Barlow, system-ui, sans-serif`;
    g.fillText(detail, bw / 2, padY + fTitle + gap);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w: Wd, h: H };
}

type RouteClass = { name: string; depth: number; lateSide: number };

// Devine le type de tracé (route) à partir de la trajectoire post-snap, repère TB (attaque vers +x).
function classifyRoute(data: Row[] | undefined, snapIdx: number): RouteClass | null {
  if (!Array.isArray(data)) return null;
  const snap = sample(data, snapIdx);
  if (!snap) return null;
  const pts: Vec2[] = [];
  for (let i = snapIdx; i < data.length; i++)
    if (validRow(data[i])) pts.push({ x: data[i]![0], y: data[i]![1] });
  if (pts.length < 3) return null;
  const start = pts[0];
  let depth = 0,
    maxLat = 0,
    endLat = 0;
  for (const p of pts) {
    depth = Math.max(depth, p.x - start.x);
    if (Math.abs(p.y - start.y) > Math.abs(maxLat)) maxLat = p.y - start.y;
  }
  const end = pts[pts.length - 1];
  endLat = end.y - start.y;
  const endDepth = end.x - start.x;
  const lateSide = Math.sign(maxLat) || 1;
  // Direction du départ du terrain (vers quel bord) pour nommer in/out
  const toOut =
    Math.abs(start.y - FIELD_W / 2) < FIELD_W / 2 ? (start.y > FIELD_W / 2 ? 1 : -1) : 1;
  const breaksOut = Math.sign(endLat) === toOut;
  let name: string;
  if (depth < 1.5 && Math.abs(maxLat) < 2) name = "Screen";
  else if (depth < 4 && Math.abs(maxLat) >= 3) name = "Slant";
  else if (depth >= 16 && Math.abs(endLat) < 5) name = "Go / Fly";
  else if (depth >= 10 && Math.abs(endLat) >= 6 && !breaksOut) name = "Post";
  else if (depth >= 10 && Math.abs(endLat) >= 6 && breaksOut) name = "Corner";
  else if (Math.abs(endLat) >= 5 && endDepth < depth - 2) name = breaksOut ? "Out" : "In / Dig";
  else if (endDepth < depth - 2 && Math.abs(endLat) < 5) name = "Curl / Comeback";
  else if (depth >= 4 && depth < 10 && Math.abs(maxLat) >= 4) name = breaksOut ? "Out" : "In";
  else if (depth < 7) name = "Hitch";
  else name = "Seam";
  return { name, depth: Math.round(depth * 10) / 10, lateSide };
}

// Phrase courte "ce qu'il fait" selon le rôle, pour la bulle.
function roleAction(role: string | null, pos?: string): string {
  switch (role) {
    case "Pass":
      return "Fait la passe";
    case "Pass Block":
      return "Protège le QB";
    case "Pass Route":
      return "Part en route";
    case "Pass Rush":
      return "Rush le passeur";
    case "Coverage":
      return "Couvre son homme";
    default:
      return pos ? pos : "En action";
  }
}

// ---------------------------------------------------------------- moteur impératif
interface Avatar {
  yaw: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
}

interface PlayerObj {
  id: string;
  ours: boolean;
  data: Row[];
  av: Avatar;
  hit: THREE.Mesh;
  sprite: THREE.Sprite;
  tex: THREE.CanvasTexture;
  bubble: THREE.Sprite;
  bubbleTex: THREE.CanvasTexture | null;
  bubbleKey: string | null;
  mark: THREE.Group | null;
  phase: number;
  cur?: { x: number; y: number; s: number; o: number | null } | null;
  misalign?: string | null;
}

interface GhostObj {
  av: Avatar;
  line: THREE.Line;
  lineGeo: THREE.BufferGeometry;
  role: string | null;
  snap: SampleResult;
  maxDepth: number;
  phase: number;
}

interface RouteItem {
  id: string;
  name: string;
  depth: number;
  color: number;
  jersey: number | null;
  playerName: string | null;
  pos?: string;
}

interface Engine {
  setRep: (r: Rep | null, t: PlayTracking | null, s: Session | null) => void;
  setFrame: (f: number) => void;
  setSelected: (id: string | null) => void;
  setCamera: (p: CameraPreset) => void;
  setGhost: (b: boolean) => void;
  setBubbles: (b: boolean) => void;
  setRoutes: (b: boolean) => void;
  setMisalign: (b: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

function createView3D(
  container: HTMLElement,
  {
    onSelectPlayer,
    onRoutes,
  }: {
    onSelectPlayer?: (id: string) => void;
    onRoutes?: (routes: RouteInfo[]) => void;
  } = {},
): Engine {
  const root = document.createElement("div");
  root.className = "v3d-root";
  root.style.position = "absolute";
  root.style.inset = "0";
  container.appendChild(root);
  const tip = document.createElement("div");
  tip.className = "v3d-tip";
  root.appendChild(tip);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "v3d-canvas";
  renderer.domElement.style.display = "block";
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyTex = makeSkyTexture();
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0x111a2c, 110, 260);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 600);
  // Vue d'ensemble du terrain par défaut (3/4 en légère plongée), pas de zoom serré.
  camera.position.set(FIELD_L / 2, 55, 48);
  const camTarget = new THREE.Vector3(FIELD_L / 2, 0, -FIELD_W / 2);
  camera.lookAt(camTarget);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49; // interdit de passer sous le terrain
  controls.minDistance = 6;
  controls.maxDistance = 240;
  controls.enablePan = true;
  controls.screenSpacePanning = false; // pan dans le plan du terrain (comme Google Maps)
  controls.panSpeed = 0.9;
  controls.rotateSpeed = 0.85;
  controls.zoomToCursor = true; // zoom vers le curseur
  controls.target.copy(camTarget);
  // Souris : glisser = rotation (inclinaison), clic droit = déplacement, molette = zoom.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  // Tactile : 1 doigt = rotation, 2 doigts = zoom + déplacement.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enabled = true;

  // --- lumières (ambiance stade de nuit)
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1f3a1c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
  sun.position.set(40, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xbcd4ff, 0.55);
  fill.position.set(80, 50, -90);
  scene.add(fill);

  // --- terrain
  const statics = new THREE.Group();
  scene.add(statics);
  const fieldTex = makeFieldTexture(renderer);
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_L, FIELD_W),
    new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.95, metalness: 0 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(FIELD_L / 2, 0, -FIELD_W / 2);
  field.receiveShadow = true;
  statics.add(field);
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_L + 30, FIELD_W + 26),
    new THREE.MeshStandardMaterial({ color: 0x1f5a26, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(FIELD_L / 2, -0.02, -FIELD_W / 2);
  apron.receiveShadow = true;
  statics.add(apron);
  // tribunes simplifiées
  const standMat = new THREE.MeshStandardMaterial({ color: 0x151c2b, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b2a4a, roughness: 0.6, emissive: 0x06182c });
  const standDefs: [number, number, number, number][] = [
    [FIELD_L / 2, -FIELD_W / 2 + (FIELD_W / 2 + 15), FIELD_L + 30, 0],
    [FIELD_L / 2, -FIELD_W / 2 - (FIELD_W / 2 + 15), FIELD_L + 30, Math.PI],
    [-17, -FIELD_W / 2, FIELD_W + 26, Math.PI / 2],
    [FIELD_L + 17, -FIELD_W / 2, FIELD_W + 26, -Math.PI / 2],
  ];
  for (const [x, z, len, rot] of standDefs) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.4), wallMat);
    wall.position.set(0, 0.7, 0);
    g.add(wall);
    for (let k = 0; k < 6; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len + k * 4, 1.6, 3), standMat);
      step.position.set(0, 1.4 + k * 1.6 + 0.8, 1.8 + k * 3);
      g.add(step);
    }
    statics.add(g);
  }
  // pylônes d'éclairage
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  for (const [x, z] of [
    [-10, 22],
    [130, 22],
    [-10, -FIELD_W - 22],
    [130, -FIELD_W - 22],
  ]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 34, 8), poleMat);
    pole.position.set(x, 17, z);
    statics.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 0.6), lampMat);
    lamp.position.set(x, 35, z);
    lamp.lookAt(FIELD_L / 2, 0, -FIELD_W / 2);
    statics.add(lamp);
  }

  // lignes de scrimmage / à gagner
  const lineGeo = new THREE.PlaneGeometry(0.32, FIELD_W);
  const losMat = new THREE.MeshBasicMaterial({
    color: 0x2f7bff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const fdMat = new THREE.MeshBasicMaterial({
    color: 0xffd400,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const losLine = new THREE.Mesh(lineGeo, losMat);
  const fdLine = new THREE.Mesh(lineGeo, fdMat);
  for (const l of [losLine, fdLine]) {
    l.rotation.x = -Math.PI / 2;
    l.position.set(-100, 0.02, -FIELD_W / 2);
    l.renderOrder = 2;
    l.visible = false;
    scene.add(l);
  }

  // --- géométries/matériaux partagés pour avatars
  const G = {
    leg: new THREE.CapsuleGeometry(0.12, 0.62, 4, 10),
    arm: new THREE.CapsuleGeometry(0.085, 0.46, 4, 8),
    torso: new THREE.CapsuleGeometry(0.27, 0.42, 6, 14),
    pads: new THREE.SphereGeometry(0.3, 16, 10),
    helmet: new THREE.SphereGeometry(0.21, 20, 14),
    mask: new THREE.TorusGeometry(0.13, 0.025, 6, 14, Math.PI),
    hit: new THREE.CylinderGeometry(0.65, 0.65, 2.4, 10),
    ring: new THREE.RingGeometry(0.78, 1.0, 56),
    disc: new THREE.CircleGeometry(0.78, 40),
    ball: new THREE.SphereGeometry(1, 20, 14),
    mark: new THREE.PlaneGeometry(1.7, 1.7),
    markEdge: new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.7, 1.7)),
  };
  const mkMats = (
    jersey: THREE.ColorRepresentation,
    pants: THREE.ColorRepresentation,
    helmet: THREE.ColorRepresentation,
  ) => ({
    jersey: new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.65 }),
    pants: new THREE.MeshStandardMaterial({ color: pants, roughness: 0.7 }),
    helmet: new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.25, metalness: 0.35 }),
    mask: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.5 }),
  });
  type MatSet = ReturnType<typeof mkMats>;
  const M = {
    ours: mkMats(OURS, 0xb8b2a7, 0xc8102e),
    them: mkMats(THEM, 0xe2e8f0, 0x334155),
    hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    ghost: new THREE.MeshStandardMaterial({
      color: GHOST,
      emissive: GHOST,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      roughness: 0.4,
    }),
    ring: new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    disc: new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.18, depthWrite: false }),
    trail: new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.75, depthWrite: false }),
    trailPast: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    ball: new THREE.MeshStandardMaterial({ color: 0x7a3b12, roughness: 0.55 }),
    dash: new THREE.LineDashedMaterial({ color: GHOST, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.9 }),
    markOkFill: new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    markOkEdge: new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95 }),
    markBadFill: new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    markBadEdge: new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.98 }),
  };

  function buildAvatar(mats: MatSet | null, { ghost = false }: { ghost?: boolean } = {}): Avatar {
    const m: MatSet = ghost
      ? ({ jersey: M.ghost, pants: M.ghost, helmet: M.ghost, mask: M.ghost } as unknown as MatSet)
      : (mats as MatSet);
    const yaw = new THREE.Group();
    const body = new THREE.Group(); // penché vers l'avant (rotation.x)
    yaw.add(body);
    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = body,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost;
      parent.add(mesh);
      return mesh;
    };
    const legs: THREE.Group[] = [],
      arms: THREE.Group[] = [];
    for (const sx of [-0.16, 0.16]) {
      const p = new THREE.Group();
      p.position.set(sx, 0.95, 0);
      body.add(p);
      add(G.leg, m.pants, 0, -0.47, 0, p);
      legs.push(p);
    }
    const torso = add(G.torso, m.jersey, 0, 1.36, 0);
    torso.scale.set(1.1, 1, 0.78);
    const pads = add(G.pads, m.jersey, 0, 1.68, 0);
    pads.scale.set(1.75, 0.55, 1.05);
    for (const sx of [-0.45, 0.45]) {
      const p = new THREE.Group();
      p.position.set(sx, 1.62, 0);
      body.add(p);
      add(G.arm, m.jersey, 0, -0.3, 0, p);
      p.rotation.z = sx > 0 ? 0.12 : -0.12;
      arms.push(p);
    }
    add(G.helmet, m.helmet, 0, 2.0, 0.02);
    const mask = add(G.mask, m.mask, 0, 1.95, 0.17);
    mask.rotation.set(0, 0, Math.PI);
    mask.scale.set(1, 0.9, 1);
    return { yaw, body, legs, arms };
  }

  // --- état dynamique
  const dyn = new THREE.Group();
  scene.add(dyn);
  let players = new Map<string, PlayerObj>();
  let ghosts = new Map<string, GhostObj>();
  let ball: THREE.Mesh | null = null;
  let ballData: ([number, number] | null)[] | null = null;
  let rep: Rep | null = null,
    track: PlayTracking | null = null,
    session: Session | null = null;
  let frame = 0,
    lastFrame = 0,
    nFrames = 1;
  let snapIdx = 0;
  let passF = -1,
    passA = -1;
  let losX = 60,
    ballSnapY = FIELD_W / 2;
  let selected: string | null = null;
  let preset: CameraPreset = "free";
  let ghostOn = false;
  let snapCam = true;
  let bubblesOn = false;
  let routesOn = false;
  let misalignOn = false;
  const routesGroup = new THREE.Group();
  scene.add(routesGroup);
  let routeList: RouteItem[] = [];
  let misaligned = new Map<string, { dx: number; dy: number; label: string }>();

  const selGroup = new THREE.Group();
  const ring = new THREE.Mesh(G.ring, M.ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.renderOrder = 3;
  const disc = new THREE.Mesh(G.disc, M.disc);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  disc.renderOrder = 3;
  selGroup.add(ring, disc);
  selGroup.visible = false;
  scene.add(selGroup);
  let trail: THREE.Mesh | null = null,
    trailPast: THREE.Mesh | null = null;

  function playerInfo(id: string) {
    return (session && session.players && (session.players[id] || session.players[String(id)])) || null;
  }
  function isOurs(id: string): boolean {
    const p = playerInfo(id);
    if (p) return p.ours === true || p.team === ((session && session.team) || "TB");
    return !!(rep && rep.players && rep.players[id]);
  }
  function repRole(id: string): string | null {
    return rep && rep.players && rep.players[id] ? rep.players[id].role : null;
  }
  function repPos(id: string): string | undefined {
    return (rep && rep.players && rep.players[id] && rep.players[id].pos) || undefined;
  }

  function disposeObj(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !Object.values(G).includes(mesh.geometry as (typeof G)[keyof typeof G]))
        mesh.geometry.dispose();
    });
  }

  function clearDynamic() {
    for (const p of players.values()) {
      if (p.tex) p.tex.dispose();
      if (p.sprite) (p.sprite.material as THREE.Material).dispose();
      if (p.bubbleTex) p.bubbleTex.dispose();
      if (p.bubble) (p.bubble.material as THREE.Material).dispose();
    }
    for (const gh of ghosts.values()) if (gh.lineGeo) gh.lineGeo.dispose();
    clearRoutes();
    disposeObj(dyn);
    dyn.clear();
    players = new Map();
    ghosts = new Map();
    ball = null;
    clearTrail();
  }
  function clearRoutes() {
    for (const o of routesGroup.children) {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (o as THREE.Mesh | THREE.Sprite).material as
        | (THREE.Material & { map?: THREE.Texture | null })
        | undefined;
      if (mat) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    }
    routesGroup.clear();
  }
  function clearTrail() {
    for (const t of [trail, trailPast]) {
      if (t) {
        t.geometry.dispose();
        scene.remove(t);
      }
    }
    trail = trailPast = null;
  }

  function eventFrame(names: string[]): number {
    const evs = rep && Array.isArray(rep.events) ? rep.events : [];
    for (const e of evs) if (e && names.includes(e.name) && typeof e.frame === "number") return e.frame - 1;
    return -1;
  }

  let ballXY: Row[] | null = null; // cache [x,y] rows
  function ballRows(): Row[] | null {
    if (!ballXY && ballData)
      ballXY = ballData.map((b) =>
        Array.isArray(b) && typeof b[0] === "number" ? [b[0], b[1], 0, 0] : null,
      );
    return ballXY;
  }

  function setRep(r: Rep | null, t: PlayTracking | null, s: Session | null) {
    clearDynamic();
    rep = r || null;
    track = t || null;
    session = s || null;
    const pl = (track && track.players) || {};
    ballData = track && Array.isArray(track.ball) ? track.ball : null;
    ballXY = null;
    nFrames = Math.max(
      1,
      num(track && track.nFrames, 0) ||
        num(rep && rep.nFrames, 0) ||
        Math.max(1, ...Object.values(pl).map((a) => (Array.isArray(a) ? a.length : 1))),
    );
    snapIdx = Math.max(0, num(rep && rep.snapFrame, 1) - 1);
    const se = eventFrame(["ball_snap", "autoevent_ballsnap"]);
    if (se >= 0 && !(rep && rep.snapFrame)) snapIdx = se;
    passF = eventFrame(["pass_forward", "autoevent_passforward"]);
    passA = eventFrame([
      "pass_arrived",
      "pass_outcome_caught",
      "pass_outcome_incomplete",
      "interception",
      "pass_outcome_touchdown",
    ]);
    if (passA <= passF) passA = -1;
    // losX / position du ballon au snap
    const bs = ballData ? sample(ballRows(), snapIdx) : null;
    losX = typeof (rep && rep.losX) === "number" ? (rep as Rep).losX : bs ? bs.x : 60;
    ballSnapY = bs ? bs.y : FIELD_W / 2;
    const ytg = num(rep && rep.yardsToGo, 0);
    losLine.position.x = losX;
    losLine.visible = !!rep;
    fdLine.position.x = Math.min(110, losX + ytg);
    fdLine.visible = !!rep && ytg > 0;

    for (const [id, data] of Object.entries(pl)) {
      if (!Array.isArray(data)) continue;
      const ours = isOurs(id);
      const av = buildAvatar(ours ? M.ours : M.them);
      av.yaw.userData.nflId = id;
      const hit = new THREE.Mesh(G.hit, M.hit);
      hit.position.y = 1.2;
      hit.userData.nflId = id;
      av.yaw.add(hit);
      const info = playerInfo(id);
      const tex = makeNumberTexture(info ? info.jersey : null, ours ? OURS : "#475569");
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          depthWrite: false,
          depthTest: false,
          transparent: true,
          sizeAttenuation: false,
        }),
      );
      sprite.scale.set(SPR, SPR, 1);
      sprite.position.y = 2.75;
      sprite.renderOrder = 5;
      av.yaw.add(sprite);
      // bulle d'explication (sprite séparé, ajouté à dyn pour rester face caméra)
      const bubble = new THREE.Sprite(
        new THREE.SpriteMaterial({
          depthWrite: false,
          depthTest: false,
          transparent: true,
          sizeAttenuation: true,
          opacity: 0,
        }),
      );
      bubble.renderOrder = 7;
      bubble.visible = false;
      dyn.add(bubble);
      // carré de placement au sol (vert = bien placé, rouge = mal placé) — pour les joueurs TB
      let mark: THREE.Group | null = null;
      if (ours) {
        mark = new THREE.Group();
        const fillM = new THREE.Mesh(G.mark, M.markOkFill);
        const edge = new THREE.LineSegments(G.markEdge, M.markOkEdge);
        fillM.rotation.x = -Math.PI / 2;
        fillM.position.y = 0.05;
        fillM.renderOrder = 3;
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.06;
        edge.renderOrder = 4;
        mark.add(fillM, edge);
        mark.userData = { fill: fillM, edge };
        mark.visible = false;
        dyn.add(mark);
      }
      dyn.add(av.yaw);
      players.set(String(id), {
        id: String(id),
        ours,
        data: data as Row[],
        av,
        hit,
        sprite,
        tex,
        bubble,
        bubbleTex: null,
        bubbleKey: null,
        mark,
        phase: Math.random() * 6,
      });
    }

    // --- tracés d'attaque (routes) : classer + préparer les lignes au sol
    computeRoutes();
    // --- mauvais placement aléatoire (déterministe par essai)
    computeMisalign();
    // fantômes (TB seulement)
    for (const p of players.values()) {
      if (!p.ours) continue;
      const role = repRole(p.id);
      if (role !== "Pass Block" && role !== "Pass" && role !== "Pass Route") continue;
      const snap = sample(p.data, snapIdx);
      if (!snap) continue;
      let maxDepth = 0;
      for (let i = snapIdx; i < p.data.length; i++)
        if (validRow(p.data[i])) maxDepth = Math.max(maxDepth, p.data[i]![0] - snap.x);
      const av = buildAvatar(null, { ghost: true });
      av.yaw.visible = false;
      dyn.add(av.yaw);
      const gLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(gLineGeo, M.dash);
      line.visible = false;
      dyn.add(line);
      ghosts.set(p.id, { av, line, lineGeo: gLineGeo, role, snap, maxDepth, phase: 0 });
    }
    // ballon
    if (ballData) {
      ball = new THREE.Mesh(G.ball, M.ball);
      ball.scale.set(0.16, 0.16, 0.27);
      ball.castShadow = true;
      dyn.add(ball);
    }
    if (selected && !players.has(String(selected))) selected = null;
    buildTrail();
    snapCam = true;
    lastFrame = frame = clamp(frame, 0, nFrames - 1);
    update(0);
  }

  function buildTrail() {
    clearTrail();
    if (!selected) return;
    const p = players.get(String(selected));
    if (!p) return;
    const pts: THREE.Vector3[] = [];
    for (const r of p.data)
      if (validRow(r)) {
        const v = W(r[0], r[1], 0.06);
        if (!pts.length || pts[pts.length - 1].distanceToSquared(v) > 0.0025) pts.push(v);
      }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    trail = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(400, pts.length * 3), 0.09, 6, false),
      M.trail,
    );
    trail.renderOrder = 2;
    scene.add(trail);
  }

  // ------------------------------------------------------------ tracés d'attaque (routes)
  const ROUTE_COLORS: Record<string, number> = {
    "Go / Fly": 0x38bdf8,
    Post: 0xa78bfa,
    Corner: 0xf472b6,
    Out: 0xfbbf24,
    "In / Dig": 0x34d399,
    In: 0x34d399,
    Slant: 0xf87171,
    "Curl / Comeback": 0xfb923c,
    Hitch: 0x60a5fa,
    Seam: 0x22d3ee,
    Screen: 0x94a3b8,
  };
  function routeColor(name: string): number {
    return ROUTE_COLORS[name] != null ? ROUTE_COLORS[name] : 0xfacc15;
  }

  function computeRoutes() {
    routeList = [];
    for (const p of players.values()) {
      if (!p.ours) continue;
      if (repRole(p.id) !== "Pass Route") continue;
      const r = classifyRoute(p.data, snapIdx);
      if (!r) continue;
      const info = playerInfo(p.id);
      routeList.push({
        id: p.id,
        name: r.name,
        depth: r.depth,
        color: routeColor(r.name),
        jersey: info ? info.jersey : null,
        playerName: info ? info.name : null,
        pos: repPos(p.id) || (info ? info.position : undefined),
      });
    }
    routeList.sort((a, b) => b.depth - a.depth);
    if (typeof onRoutes === "function")
      onRoutes(
        routeList.map((r) => ({
          id: r.id,
          name: r.name,
          depth: r.depth,
          color: "#" + r.color.toString(16).padStart(6, "0"),
          jersey: r.jersey,
          playerName: r.playerName,
          pos: r.pos,
        })),
      );
    drawRoutes();
  }

  function drawRoutes() {
    clearRoutes();
    if (!routesOn) return;
    for (const r of routeList) {
      const p = players.get(r.id);
      if (!p) continue;
      const pts: THREE.Vector3[] = [];
      for (let i = snapIdx; i < p.data.length; i++) {
        const row = p.data[i];
        if (validRow(row)) {
          const v = W(row[0], row[1], 0.08);
          if (!pts.length || pts[pts.length - 1].distanceToSquared(v) > 0.01) pts.push(v);
        }
      }
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.min(220, pts.length * 3), 0.11, 6, false),
        new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      tube.renderOrder = 2;
      routesGroup.add(tube);
      // pointe de flèche en bout de route
      const end = pts[pts.length - 1],
        prev = pts[Math.max(0, pts.length - 4)];
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 0.9, 10),
        new THREE.MeshBasicMaterial({ color: r.color, depthWrite: false }),
      );
      head.position.copy(end);
      head.position.y = 0.4;
      const dir = new THREE.Vector3().subVectors(end, prev).setY(0);
      if (dir.lengthSq() > 1e-4) {
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        head.quaternion.copy(q);
      }
      head.renderOrder = 3;
      routesGroup.add(head);
      // étiquette du nom de tracé
      const { tex, w, h } = makeBubbleTexture(r.name, null, {
        accent: "#" + r.color.toString(16).padStart(6, "0"),
      });
      const lbl = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }),
      );
      const sc = 0.012;
      lbl.scale.set(w * sc, h * sc, 1);
      lbl.position.copy(end);
      lbl.position.y = 1.4;
      lbl.renderOrder = 8;
      routesGroup.add(lbl);
    }
  }

  // ------------------------------------------------------------ mauvais placement aléatoire
  // Hash déterministe (essai + joueur) -> toujours le même résultat pour un même essai.
  function hashStr(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }
  function computeMisalign() {
    misaligned = new Map();
    const repId = rep && rep.id != null ? String(rep.id) : "0";
    for (const p of players.values()) {
      if (!p.ours) continue;
      const role = repRole(p.id);
      if (role !== "Pass Route" && role !== "Pass Block") continue;
      const h = hashStr(repId + ":" + p.id);
      if (h > 0.28) continue; // ~28% des éligibles sont "mal placés"
      const a = hashStr("a" + repId + p.id),
        b = hashStr("b" + repId + p.id);
      const dx = (a - 0.5) * 2.4; // décalage avant/arrière (yards)
      const dy = (b - 0.5) * 3.2; // décalage latéral (yards)
      let label: string;
      if (role === "Pass Block") label = Math.abs(dx) > Math.abs(dy) ? "Mauvais recul" : "Split trop large";
      else label = dx < -0.4 ? "En retard sur la ligne" : Math.abs(dy) > 1 ? "Alignement décalé" : "Mal aligné";
      misaligned.set(p.id, { dx, dy, label });
    }
  }
  function misalignOffset(p: PlayerObj, f: number) {
    if (!misalignOn) return null;
    const m = misaligned.get(p.id);
    if (!m) return null;
    // Le décalage est plein avant le snap, puis se résorbe sur ~1s après le snap.
    let k = 1;
    if (f > snapIdx) k = clamp(1 - (f - snapIdx) / 10, 0, 1);
    return { dx: m.dx * k, dy: m.dy * k, label: m.label, active: k > 0.15 };
  }

  // ------------------------------------------------------------ mise à jour par frame
  function ballHeight(f: number): number {
    if (passF >= 0 && passA > passF) {
      if (f < snapIdx) return 0.18;
      if (f <= passF) return 1.25;
      if (f < passA) {
        const t = (f - passF) / (passA - passF);
        const a = sample(ballRows(), passF);
        const b = sample(ballRows(), passA);
        const dist = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 10;
        const peak = clamp(dist * 0.14, 0.6, 11);
        return 1.9 + (1.3 - 1.9) * t + 4 * peak * t * (1 - t);
      }
      return 1.3;
    }
    return f < snapIdx ? 0.18 : 1.0;
  }

  const tmpV = new THREE.Vector3();
  function placePlayer(p: PlayerObj, f: number, df: number) {
    const st = sample(p.data, f);
    if (!st) {
      p.av.yaw.visible = false;
      p.cur = null;
      return;
    }
    p.av.yaw.visible = true;
    const mo = misalignOffset(p, f);
    const px = st.x + (mo ? mo.dx : 0);
    const py = st.y + (mo ? mo.dy : 0);
    p.cur = { x: px, y: py, s: st.s, o: st.o };
    p.misalign = mo && mo.active ? mo.label : null;
    p.av.yaw.position.copy(W(px, py));
    const o = st.o == null ? 90 : st.o;
    p.av.yaw.rotation.y = Math.PI - THREE.MathUtils.degToRad(o);
    const s = st.s;
    p.av.body.rotation.x = clamp(s / 9, 0, 1) * 0.38;
    if (Math.abs(df) < 3) p.phase += df * s * 0.85;
    const amp = s > 1 ? clamp((s - 1) / 6, 0, 1) * 0.75 : 0;
    const sw = Math.sin(p.phase) * amp;
    p.av.legs[0].rotation.x = sw;
    p.av.legs[1].rotation.x = -sw;
    p.av.arms[0].rotation.x = -sw * 0.8;
    p.av.arms[1].rotation.x = sw * 0.8;
    p.av.body.position.y = amp > 0 ? Math.abs(Math.cos(p.phase)) * 0.05 * amp : 0;
  }

  function ghostPos(gh: GhostObj, f: number): { x: number; y: number; s: number } {
    const el = (f - snapIdx) / 10; // secondes depuis le snap
    const { snap } = gh;
    if (el <= 0) return { x: snap.x, y: snap.y, s: 0 };
    if (gh.role === "Pass Route") {
      const d = Math.min(Math.max(gh.maxDepth, 0), el * 7.5);
      return { x: snap.x + d, y: snap.y, s: d < gh.maxDepth ? 7.5 : 0 };
    }
    const depth = gh.role === "Pass" ? 6 : 2;
    const k = smooth(clamp(el, 0, 1));
    return { x: snap.x - depth * k, y: snap.y, s: el < 1 ? depth : 0 };
  }

  function updateGhosts(f: number, df: number) {
    for (const [id, gh] of ghosts) {
      const p = players.get(id);
      const show = ghostOn && p && p.cur;
      gh.av.yaw.visible = !!show;
      gh.line.visible = false;
      if (!show || !p || !p.cur) continue;
      const g = ghostPos(gh, f);
      gh.av.yaw.position.copy(W(g.x, g.y));
      gh.av.yaw.rotation.y = Math.PI / 2; // face au +x (vers l'attaque)
      if (Math.abs(df) < 3) gh.phase += df * g.s * 0.85;
      const sw = g.s > 1 ? Math.sin(gh.phase) * 0.6 : 0;
      gh.av.legs[0].rotation.x = sw;
      gh.av.legs[1].rotation.x = -sw;
      gh.av.body.rotation.x = gh.role === "Pass Route" && g.s > 1 ? 0.3 : 0;
      const gap = Math.hypot(g.x - p.cur.x, g.y - p.cur.y);
      if (gap > 1) {
        const pos = gh.lineGeo.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, p.cur.x, 0.12, -p.cur.y);
        pos.setXYZ(1, g.x, 0.12, -g.y);
        pos.needsUpdate = true;
        gh.lineGeo.computeBoundingSphere();
        (gh.line as THREE.Line).computeLineDistances();
        gh.line.visible = true;
      }
    }
  }

  function placeBall(f: number) {
    if (!ball) return;
    const rows = ballRows();
    const st = sample(rows, f);
    if (!st) {
      ball.visible = false;
      return;
    }
    ball.visible = true;
    ball.position.copy(W(st.x, st.y, ballHeight(f)));
    const nx = sample(rows, Math.min(nFrames - 1, f + 0.5));
    if (nx && Math.hypot(nx.x - st.x, nx.y - st.y) > 0.02) {
      tmpV.copy(W(nx.x, nx.y, ballHeight(Math.min(nFrames - 1, f + 0.5))));
      ball.lookAt(tmpV);
    } else {
      ball.rotation.set(0, Math.PI / 2, 0);
    }
  }

  function update(df: number) {
    const f = frame;
    for (const p of players.values()) placePlayer(p, f, df);
    placeBall(f);
    updateGhosts(f, df);
    const sp = selected ? players.get(String(selected)) : null;
    if (sp && sp.cur) {
      selGroup.visible = true;
      selGroup.position.set(sp.cur.x, 0, -sp.cur.y);
    } else selGroup.visible = false;
    for (const p of players.values()) {
      const k = sp === p ? SPR * 1.45 : SPR;
      p.sprite.scale.set(k, k, 1);
      p.sprite.renderOrder = sp === p ? 6 : 5;
    }
    updateBubbles();
    updateMarks();
  }

  // Carrés de placement au sol : vert = bien placé, rouge = mal placé.
  function updateMarks() {
    for (const p of players.values()) {
      if (!p.mark) continue;
      const show = misalignOn && p.cur && p.av.yaw.visible;
      p.mark.visible = !!show;
      if (!show || !p.cur) continue;
      p.mark.position.set(p.cur.x, 0, -p.cur.y);
      const bad = !!p.misalign;
      const ud = p.mark.userData as { fill: THREE.Mesh; edge: THREE.LineSegments };
      ud.fill.material = bad ? M.markBadFill : M.markOkFill;
      ud.edge.material = bad ? M.markBadEdge : M.markOkEdge;
      // légère pulsation sur les mal placés pour attirer l'œil
      const k = bad ? 1 + Math.sin(t * 5) * 0.08 : 1;
      p.mark.scale.set(k, k, k);
    }
  }

  // Met à jour le contenu + la position des bulles d'explication au-dessus des joueurs.
  function updateBubbles() {
    for (const p of players.values()) {
      const show = bubblesOn && p.cur && p.av.yaw.visible;
      if (!show || !p.cur) {
        if (p.bubble.visible) p.bubble.visible = false;
        continue;
      }
      const role = repRole(p.id);
      const info = playerInfo(p.id);
      const warn = !!p.misalign;
      // titre: action ou alerte de placement ; détail: numéro/poste ou route
      let title: string, detail: string;
      if (warn) {
        title = p.misalign as string;
        detail = info ? `#${info.jersey} · ${repPos(p.id) || info.position || ""}` : "";
      } else {
        title = roleAction(role, info ? info.position : undefined);
        if (role === "Pass Route") {
          const r = routeList.find((x) => x.id === p.id);
          detail = r ? `Tracé : ${r.name}` : info ? `#${info.jersey}` : "";
        } else {
          detail = info ? `#${info.jersey} ${info.name || ""}`.trim() : "";
        }
      }
      const key = (warn ? "W|" : "") + title + "|" + detail;
      if (key !== p.bubbleKey) {
        if (p.bubbleTex) p.bubbleTex.dispose();
        const { tex, w, h } = makeBubbleTexture(title, detail, {
          warn,
          accent: warn ? undefined : p.ours ? "#fb7185" : "#38bdf8",
        });
        p.bubble.material.map = tex;
        p.bubble.material.needsUpdate = true;
        p.bubbleTex = tex;
        p.bubbleKey = key;
        const sc = 0.011;
        p.bubble.scale.set(w * sc, h * sc, 1);
        p.bubble.userData.aspect = { w: w * sc, h: h * sc };
      }
      p.bubble.visible = true;
      p.bubble.material.opacity = 1;
      p.bubble.position.set(p.cur.x, 3.4 + (p.bubble.userData.aspect as { h: number }).h / 2, -p.cur.y);
    }
  }
  // pastilles: s'effacent quand la caméra est tout près (vues à hauteur d'homme)
  const sprW = new THREE.Vector3();
  function fadeSprites() {
    for (const p of players.values()) {
      p.sprite.getWorldPosition(sprW);
      const d = sprW.distanceTo(camera.position);
      p.sprite.material.opacity = clamp((d - 3) / 4, 0, 1);
      p.sprite.visible = p.sprite.material.opacity > 0.02;
      // avatar collé à la caméra: on le masque pour ne pas boucher la vue
      if (p.cur) {
        const near =
          Math.hypot(camera.position.x - p.cur.x, camera.position.z + p.cur.y) < 2.2 &&
          camera.position.y < 4;
        p.av.body.visible = !near;
      }
    }
    for (const gh of ghosts.values()) {
      if (!gh.av.yaw.visible) continue;
      const gp = gh.av.yaw.position;
      gh.av.body.visible = !(
        Math.hypot(camera.position.x - gp.x, camera.position.z - gp.z) < 2.2 && camera.position.y < 4
      );
    }
  }

  // ------------------------------------------------------------ caméras
  function findQB(): PlayerObj | null {
    const cands: PlayerObj[] = [];
    for (const p of players.values()) {
      const info = playerInfo(p.id);
      if ((info && info.position === "QB") || repRole(p.id) === "Pass") cands.push(p);
    }
    const wantOurs = !rep || rep.side !== "defense";
    return cands.find((p) => p.ours === wantOurs) || cands[0] || null;
  }
  function findReceiver(): PlayerObj | null {
    if (selected && players.has(String(selected))) return players.get(String(selected))!;
    const offOurs = !rep || rep.side !== "defense";
    let best: PlayerObj | null = null;
    for (const p of players.values()) {
      const info = playerInfo(p.id);
      if (info && info.position === "WR" && p.ours === offOurs) {
        best = p;
        break;
      }
      if (!best && repRole(p.id) === "Pass Route") best = p;
    }
    return best || findQB();
  }
  function facing(p: PlayerObj): Vec2 {
    // direction de course lissée (sinon +x)
    const a = sample(p.data, Math.max(0, frame - 4));
    const b = p.cur;
    if (a && b) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.hypot(dx, dy);
      if (d > 0.6) return { x: dx / d, y: dy / d };
    }
    return { x: 1, y: 0 };
  }

  const desiredPos = new THREE.Vector3();
  const desiredTgt = new THREE.Vector3();
  const recvDir: Vec2 = { x: 1, y: 0 };
  let maddenX = 60;
  function computeCamera(): boolean {
    const cy = FIELD_W / 2;
    switch (preset) {
      case "qb": {
        const q = findQB();
        const qx = q && q.cur ? q.cur.x : losX - 5;
        const qy = q && q.cur ? q.cur.y : ballSnapY;
        desiredPos.copy(W(qx - 9, qy, 4.6));
        desiredTgt.copy(W(qx + 14, qy, 0.2));
        break;
      }
      case "line":
        desiredPos.copy(W(losX - 6.5, ballSnapY + 2.5, 2.3));
        desiredTgt.copy(W(losX + 10, ballSnapY, 0.9));
        break;
      case "receiver": {
        const r = findReceiver();
        if (r && r.cur) {
          const d = facing(r);
          recvDir.x += (d.x - recvDir.x) * 0.08;
          recvDir.y += (d.y - recvDir.y) * 0.08;
          const n = Math.hypot(recvDir.x, recvDir.y) || 1;
          const ux = recvDir.x / n,
            uy = recvDir.y / n;
          desiredPos.copy(W(r.cur.x - ux * 7, r.cur.y - uy * 7, 3.2));
          desiredTgt.copy(W(r.cur.x + ux * 8, r.cur.y + uy * 8, 1.0));
        } else {
          desiredPos.copy(W(losX - 10, cy, 4));
          desiredTgt.copy(W(losX + 10, cy, 0));
        }
        break;
      }
      case "free":
        return false;
      case "madden": {
        // Caméra broadcast style Madden : haute, sur la touche, qui suit l'action.
        const act = actionCenter();
        // lissage du suivi horizontal
        maddenX += (act.x - maddenX) * 0.12;
        const lead = clamp((act.x - losX) * 0.25, -6, 6); // anticipe la progression
        desiredPos.copy(W(maddenX - 4 + lead, -16, 17)); // derrière la touche basse (y<0), en hauteur
        desiredTgt.copy(W(maddenX + 6, cy - 4, 1.2));
        break;
      }
      case "top":
      default:
        desiredPos.copy(W(losX + 6, cy - 13, 46));
        desiredTgt.copy(W(losX + 6, cy, 0));
    }
    return true;
  }

  // Barycentre de l'action pour la caméra Madden.
  function actionCenter(): Vec2 {
    const rows = ballRows();
    const b = rows ? sample(rows, frame) : null;
    if (b) return { x: b.x, y: b.y };
    let sx = 0,
      sy = 0,
      n = 0;
    for (const p of players.values())
      if (p.cur) {
        sx += p.cur.x;
        sy += p.cur.y;
        n++;
      }
    return n ? { x: sx / n, y: sy / n } : { x: losX, y: FIELD_W / 2 };
  }

  // ------------------------------------------------------------ boucle
  const clock = new THREE.Clock();
  let raf = 0;
  let t = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, clock.getDelta());
    t += dt;
    if (frame !== lastFrame) {
      const df = frame - lastFrame;
      lastFrame = frame;
      update(df);
    }
    // anneau pulsé
    if (selGroup.visible) {
      const k = 1 + Math.sin(t * 4) * 0.08;
      ring.scale.set(k, k, k);
      M.ring.opacity = 0.75 + Math.sin(t * 4) * 0.2;
    }
    if (computeCamera()) {
      controls.enabled = false;
      const a = snapCam ? 1 : 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(desiredPos, a);
      camTarget.lerp(desiredTgt, a);
      camera.lookAt(camTarget);
      snapCam = false;
    } else {
      controls.enabled = true;
      controls.update();
    }
    // ombres centrées sur l'action
    sun.target.position.set(losX + 5, 0, -FIELD_W / 2);
    sun.position.set(losX - 25, 70, 25);
    fadeSprites();
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ interactions
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev: PointerEvent): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits: THREE.Object3D[] = [];
    for (const p of players.values()) if (p.av.yaw.visible) hits.push(p.hit);
    const res = raycaster.intersectObjects(hits, false);
    return res.length ? (res[0].object.userData.nflId as string) : null;
  }
  let downX = 0,
    downY = 0,
    downT = 0;
  function onDown(ev: PointerEvent) {
    downX = ev.clientX;
    downY = ev.clientY;
    downT = performance.now();
  }
  function onUp(ev: PointerEvent) {
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6 || performance.now() - downT > 600) return;
    const id = pick(ev);
    if (id != null) {
      setSelected(id);
      if (typeof onSelectPlayer === "function") onSelectPlayer(id);
    }
  }
  let hoverRaf = 0;
  function onMove(ev: PointerEvent) {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const id = pick(ev);
      renderer.domElement.style.cursor = id != null ? "pointer" : "";
      if (id != null) {
        const info = playerInfo(id);
        const rp = rep && rep.players && rep.players[id];
        const name = info ? `${info.jersey != null ? "#" + info.jersey + " " : ""}${info.name || ""}` : `#${id}`;
        const extra = [info && info.position, rp && rp.role].filter(Boolean).join(" · ");
        tip.textContent = extra ? `${name} — ${extra}` : name;
        const rect = root.getBoundingClientRect();
        tip.style.transform = `translate(${ev.clientX - rect.left + 14}px, ${ev.clientY - rect.top + 12}px)`;
        tip.classList.add("on");
      } else tip.classList.remove("on");
    });
  }
  function onLeave() {
    tip.classList.remove("on");
  }
  const el = renderer.domElement;
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);

  function resize() {
    const w = Math.max(1, root.clientWidth || container.clientWidth || 1);
    const h = Math.max(1, root.clientHeight || container.clientHeight || 1);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 60 : 45;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(root);
  else window.addEventListener("resize", resize);
  resize();
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------ API
  function setFrame(f: number) {
    const v = Number(f);
    if (!isFinite(v)) return;
    frame = clamp(v, 0, Math.max(0, nFrames - 1));
  }
  function setSelected(id: string | null) {
    const s = id == null ? null : String(id);
    if (s === selected) return;
    selected = s && players.size && !players.has(s) ? null : s;
    buildTrail();
    update(0);
  }
  function setCamera(p: CameraPreset) {
    const valid: CameraPreset[] = ["top", "qb", "line", "receiver", "free", "madden"];
    const next: CameraPreset = valid.includes(p) ? p : "top";
    if (next === "free") {
      // Reprend la main en mode libre: cible = centre de l'action, recule si trop près du sol.
      const act = actionCenter();
      controls.target.set(act.x, 0, -act.y);
      const d = camera.position.distanceTo(controls.target);
      if (d < 18 || camera.position.y < 8) {
        // vue d'ensemble 3/4 agréable
        camera.position.set(act.x, 46, -act.y + 42);
      }
      controls.update();
    }
    if (next === "madden") {
      maddenX = actionCenter().x;
      snapCam = true;
    }
    preset = next;
  }
  function setGhost(b: boolean) {
    ghostOn = !!b;
    update(0);
  }
  function setBubbles(b: boolean) {
    bubblesOn = !!b;
    update(0);
  }
  function setRoutes(b: boolean) {
    routesOn = !!b;
    drawRoutes();
  }
  function setMisalign(b: boolean) {
    misalignOn = !!b;
    update(0);
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    if (ro) ro.disconnect();
    else window.removeEventListener("resize", resize);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    controls.dispose();
    clearDynamic();
    const mats = new Set<THREE.Material>(),
      geos = new Set<THREE.BufferGeometry>(),
      texs = new Set<THREE.Texture>([fieldTex, skyTex]);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      if (mesh.material)
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => mats.add(m));
    });
    Object.values(G).forEach((g) => geos.add(g));
    for (const k of ["ours", "them"] as const) Object.values(M[k]).forEach((m) => mats.add(m));
    for (const [k, m] of Object.entries(M))
      if (k !== "ours" && k !== "them") mats.add(m as THREE.Material);
    for (const m of mats) {
      const mm = m as THREE.Material & { map?: THREE.Texture | null };
      if (mm.map) texs.add(mm.map);
      m.dispose();
    }
    for (const g of geos) g.dispose();
    for (const tx of texs) tx.dispose();
    scene.clear();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* ignore */
    }
    root.remove();
  }

  return { setRep, setFrame, setSelected, setCamera, setGhost, setBubbles, setRoutes, setMisalign, resize, dispose };
}

// ================================================================ Composant React
export function View3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  // Store (via sélecteurs). La scène n'est pas recréée à chaque frame : le frame
  // est poussé dans le moteur via setFrame, qui met un champ lu par la boucle rAF.
  const rep = useStore((s) => s.rep);
  const tracking = useStore((s) => s.tracking);
  const session = useStore((s) => s.session);
  const frame = useStore((s) => s.frame);
  const selected = useStore((s) => s.selected);
  const camera = useStore((s) => s.camera);
  const toggles = useStore((s) => s.toggles);
  const select = useStore((s) => s.select);
  const setRoutes = useStore((s) => s.setRoutes);

  // Resolve the tracking slice for the current rep (keyed by playId, fallback id).
  const track: PlayTracking | null = rep
    ? tracking?.[String(rep.playId)] ?? tracking?.[String(rep.id)] ?? null
    : null;

  // --- montage unique de la scène three.js
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createView3D(container, {
      onSelectPlayer: (id) => select(id),
      onRoutes: (routes) => setRoutes(routes),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // montage unique ; les données circulent via les effets ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- rep / tracking / session -> reconstruit les acteurs (pas la scène)
  useEffect(() => {
    engineRef.current?.setRep(rep, track, session);
    // track dérivé de rep+tracking, inclus comme dép.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep, track, session]);

  // --- frame : poussé sans recréer la scène (lu dans la boucle rAF interne)
  useEffect(() => {
    engineRef.current?.setFrame(frame);
  }, [frame]);

  // --- sélection
  useEffect(() => {
    engineRef.current?.setSelected(selected);
  }, [selected]);

  // --- caméra (preset)
  useEffect(() => {
    engineRef.current?.setCamera(camera);
  }, [camera]);

  // --- toggles {ghost, bubbles, routes, misalign}
  useEffect(() => {
    engineRef.current?.setGhost(toggles.ghost);
  }, [toggles.ghost]);
  useEffect(() => {
    engineRef.current?.setBubbles(toggles.bubbles);
  }, [toggles.bubbles]);
  useEffect(() => {
    engineRef.current?.setRoutes(toggles.routes);
  }, [toggles.routes]);
  useEffect(() => {
    engineRef.current?.setMisalign(toggles.misalign);
  }, [toggles.misalign]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}

export default View3D;
