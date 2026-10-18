import type { Yarn } from "../api";
import { yarnPhotoUrl } from "../covers";

/**
 * Colours from a photo: its main colours picked out, as a palette for a
 * colourwork chart, and the stash's yarns nearest each one by the colour of
 * their photos. Worked out here, in the app: nothing is sent anywhere.
 * Colours are compared as the eye sees them (CIELAB), not as RGB numbers.
 */

/** One colour picked out, and how much of the photo is it (0–1). */
export interface PhotoColour {
  hex: string;
  share: number;
}

type Rgb = [number, number, number];
type Lab = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** sRGB to CIELAB (D65). */
export function rgbToLab([r, g, b]: Rgb): Lab {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** How far apart two colours look: 0 the same, about 2 just noticeable, over 20 plainly different. */
export function colourDistance(a: string, b: string): number {
  const [p, q] = [rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * The main colours of some pixels (RGBA, as a canvas gives them): grouped
 * into up to `count` colours by k-means in CIELAB, each its group's average;
 * ones that look alike merged, slivers (under 2%) left out, the most of the
 * photo first. The same pixels always give the same colours.
 */
export function mainColours(pixels: Uint8ClampedArray, count = 6): PhotoColour[] {
  const points: Lab[] = [];
  const rgbs: Rgb[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    rgbs.push(rgb);
    points.push(rgbToLab(rgb));
  }
  if (!points.length) return [];
  const dist = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Started apart: the first point, then each time the one farthest from those chosen.
  const centres: Lab[] = [points[0]];
  const nearest = points.map((p) => dist(p, centres[0]));
  while (centres.length < Math.min(count, points.length)) {
    let far = 0;
    for (let i = 1; i < points.length; i++) if (nearest[i] > nearest[far]) far = i;
    if (nearest[far] === 0) break;
    centres.push(points[far]);
    for (let i = 0; i < points.length; i++) nearest[i] = Math.min(nearest[i], dist(points[i], points[far]));
  }
  const group = new Array<number>(points.length).fill(0);
  for (let round = 0; round < 12; round++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      for (let c = 1; c < centres.length; c++) if (dist(points[i], centres[c]) < dist(points[i], centres[best])) best = c;
      if (best !== group[i]) moved = true;
      group[i] = best;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[group[i]];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!moved && round) break;
  }
  // Each group's colour: the average of its pixels as they are.
  const totals = centres.map(() => [0, 0, 0, 0]);
  rgbs.forEach((rgb, i) => {
    const t = totals[group[i]];
    t[0] += rgb[0];
    t[1] += rgb[1];
    t[2] += rgb[2];
    t[3]++;
  });
  let found = totals.filter((t) => t[3]).map((t) => ({ hex: rgbToHex([t[0] / t[3], t[1] / t[3], t[2] / t[3]]), weight: t[3] }));
  // Alike ones are one colour.
  found.sort((a, b) => b.weight - a.weight);
  const merged: { hex: string; weight: number }[] = [];
  for (const f of found) {
    const like = merged.find((m) => colourDistance(m.hex, f.hex) < 10);
    if (like) like.weight += f.weight;
    else merged.push({ ...f });
  }
  found = merged;
  return found
    .map((f) => ({ hex: f.hex, share: f.weight / points.length }))
    .filter((f) => f.share >= 0.02)
    .sort((a, b) => b.share - a.share);
}

/** A picture's pixels, scaled down so the longer side is `side`; null when it cannot be read. */
export async function pixelsOf(source: Blob | string, side = 120, crop = 1): Promise<Uint8ClampedArray | null> {
  try {
    const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
    const bitmap = await createImageBitmap(blob);
    try {
      // The middle `crop` of it: a yarn's photo has the yarn in the middle and the table round it.
      const sw = bitmap.width * crop;
      const sh = bitmap.height * crop;
      const scale = Math.min(1, side / Math.max(sw, sh));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

const yarnColours = new Map<string, Promise<string | null>>();

/**
 * A yarn's colour, from its photo: the main colour of the middle of it.
 * Null when it has no photo. Remembered while the app runs, by photo.
 */
export function yarnColour(y: Yarn): Promise<string | null> {
  if (!y.photoPath) return Promise.resolve(null);
  const key = `${y.id}:${y.photoPath}`;
  let found = yarnColours.get(key);
  if (!found) {
    found = (async () => {
      const url = await yarnPhotoUrl(y.id);
      const pixels = url ? await pixelsOf(url, 80, 0.6) : null;
      return pixels ? (mainColours(pixels, 3)[0]?.hex ?? null) : null;
    })();
    yarnColours.set(key, found);
  }
  return found;
}

/** The yarns nearest a colour, nearest first, as far as `within` apart. */
export function nearestYarns(hex: string, coloured: { yarn: Yarn; hex: string }[], count = 3, within = 30): { yarn: Yarn; hex: string; distance: number }[] {
  return coloured
    .map((c) => ({ ...c, distance: colourDistance(hex, c.hex) }))
    .filter((c) => c.distance <= within)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

/** How alike, in words: for a yarn offered for a colour. */
export function likeness(distance: number): string {
  return distance < 6 ? "very close" : distance < 14 ? "close" : "near";
}

/** A plain name for a colour, for a chart's legend: "dark red", "light grey", "teal". */
export function colourName(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
  }
  if (sat < 0.12 || light < 0.08 || light > 0.94) {
    if (light < 0.12) return "black";
    if (light > 0.9) return "white";
    return light < 0.35 ? "dark grey" : light > 0.7 ? "light grey" : "grey";
  }
  const names: [number, string][] = [[15, "red"], [40, "orange"], [65, "yellow"], [80, "lime"], [160, "green"], [190, "teal"], [250, "blue"], [290, "purple"], [335, "pink"], [360, "red"]];
  let name = names.find(([upTo]) => hue < upTo)![1];
  // Dark orange and yellow are browns, and a pale red is pink; as a knitter
  // says it, a pale warm yellow is cream, and a deep one mustard.
  if ((name === "orange" || name === "yellow") && light < 0.4) name = "brown";
  if (name === "red" && light > 0.75) name = "pink";
  if (hue >= 25 && hue < 70 && light > 0.82) return "cream";
  if (name === "yellow" && light < 0.55) return "mustard";
  return light < 0.3 ? `dark ${name}` : light > 0.72 ? `light ${name}` : name;
}
