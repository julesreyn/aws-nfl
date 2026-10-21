import type { Grade, Side } from "@/types";

export const GRADE_LABEL: Record<Grade, string> = {
  green: "Validé",
  orange: "À revoir",
  red: "À corriger",
};
export const SIDE_LABEL: Record<Side, string> = {
  offense: "Attaque",
  defense: "Défense",
};

export const GRADE_COLOR: Record<Grade, string> = {
  green: "var(--grade-green)",
  orange: "var(--grade-orange)",
  red: "var(--grade-red)",
};

export function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

// Interpolate a tracking row ([x,y,s,o] or [x,y]) at fractional frame f.
export function sampleRow(arr: (number[] | null)[] | undefined, f: number): number[] | null {
  if (!arr || !arr.length) return null;
  const n = arr.length;
  const fc = Math.max(0, Math.min(n - 1, f));
  const i = Math.floor(fc);
  const t = fc - i;
  const a = arr[i];
  const b = arr[Math.min(n - 1, i + 1)];
  if (!a) return b ?? null;
  if (!b || t === 0) return a;
  const out = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  if (a.length > 2) {
    out.push((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t);
    out.push(lerpAngle(a[3] ?? 0, b[3] ?? 0, t));
  }
  return out;
}

export const fmtSeconds = (f: number) => (f / 10).toFixed(1).replace(".", ",") + " s";
