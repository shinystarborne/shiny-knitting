/**
 * Drawing colourwork charts. One routine draws a chart through a `Painter`,
 * so the editor's canvas, a PNG and a PDF's vector pages are the same
 * drawing: squares, symbols, the grid with a heavier line every 10, numbers,
 * a yoke's shaping rounds and long floats. The previews -- the chart tiled,
 * and a yoke seen from above -- are for the screen only, and draw on a
 * canvas directly.
 */
import { inkOn, range, stitchMask, stsInRow, shapingRounds, usage, type Float, type Grid } from "./chart";

/** Draws in a box whose origin is top left, y going down, in whatever unit the painter uses. */
export interface Painter {
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): void;
  poly(points: [number, number][], colour: string, fill: boolean, width?: number): void;
  /** Text centred on `y`, from, around or to `x`. */
  text(x: number, y: number, text: string, size: number, colour: string, align?: "left" | "center" | "right", bold?: boolean): void;
  measure(text: string, size: number, bold?: boolean): number;
}

/** The paper the chart is drawn on, and its lines: a printed chart's, on screen too. */
export const PAPER = "#ffffff";
export const NO_STITCH = "#c4c4c4";
const THIN = "#a3a3a3";
const HEAVY = "#3b3b3b";
const SHAPING = "#c0392b";
const FLOAT = "#e8590c";
const NUMBERS = "#555555";

export interface Layout {
  /** The top left of the grid itself. */
  x: number;
  y: number;
  /** One square. */
  cw: number;
  ch: number;
  /** The columns and rows drawn, [from, to); all by default. */
  cols?: [number, number];
  rows?: [number, number];
  numbers?: boolean;
  /** The width of the thin lines; the heavy ones are twice it. */
  line?: number;
  floats?: Float[];
  mask?: Uint8Array;
  /** A heavy line round what is drawn, as round a page's part of a chart; on by default. */
  frame?: boolean;
}

/** Room the numbers take beside and below the grid, for squares of this size. */
export function margins(g: Grid, cw: number, ch: number): { left: number; right: number; bottom: number; font: number } {
  const font = numberFont(cw, ch);
  const side = font * 2.3;
  return {
    left: g.flat ? side : 0,
    right: side + (g.kind === "yoke" && g.sections.length > 1 ? font * 3.6 : 0),
    bottom: font * 1.9,
    font,
  };
}

function numberFont(cw: number, ch: number): number {
  return Math.max(4.5, Math.min(11, Math.min(cw, ch) * 0.6));
}

/** Draws the chart, or the part of it in `cols` and `rows`. */
export function drawChart(p: Painter, g: Grid, l: Layout): void {
  const [c0, c1] = l.cols ?? [0, g.width];
  const [r0, r1] = l.rows ?? [0, g.height];
  const mask = l.mask ?? stitchMask(g);
  const thin = l.line ?? Math.max(0.5, Math.min(l.cw, l.ch) / 22);
  const xOf = (c: number) => l.x + (c - c0) * l.cw;
  // The highest row at the top.
  const yOf = (r: number) => l.y + (r1 - 1 - r) * l.ch;
  const w = (c1 - c0) * l.cw;
  const h = (r1 - r0) * l.ch;

  // Squares, a run of one colour at a time.
  for (let r = r0; r < r1; r++) {
    let start = c0;
    for (let c = c0 + 1; c <= c1; c++) {
      const i = r * g.width + c;
      const prev = r * g.width + c - 1;
      const same = c < c1 && mask[i] === mask[prev] && (!mask[i] || g.cells[i] === g.cells[prev]);
      if (same) continue;
      const fill = mask[prev] ? g.colours[g.cells[prev]].hex : NO_STITCH;
      p.rect(xOf(start), yOf(r), (c - start) * l.cw, l.ch, fill);
      start = c;
    }
  }

  if (g.symbols) {
    const s = Math.min(l.cw, l.ch);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * g.width + c;
        if (!mask[i] || !g.cells[i]) continue;
        const colour = g.colours[g.cells[i]];
        drawSymbol(p, g.cells[i], xOf(c) + l.cw / 2, yOf(r) + l.ch / 2, s, inkOn(colour.hex));
      }
    }
  }

  // The grid: thin lines, heavier every 10 counted from stitch 1 and row 1, and round the edge.
  const frame = l.frame ?? true;
  for (let c = c0; c <= c1; c++) {
    const heavy = (frame && (c === c0 || c === c1)) || c === 0 || c === g.width || (g.width - c) % 10 === 0;
    p.line(xOf(c), l.y, xOf(c), l.y + h, heavy ? thin * 2.2 : thin, heavy ? HEAVY : THIN);
  }
  for (let r = r0; r <= r1; r++) {
    const heavy = (frame && (r === r0 || r === r1)) || r % 10 === 0 || r === g.height;
    const y = l.y + (r1 - r) * l.ch;
    p.line(l.x, y, l.x + w, y, heavy ? thin * 2.2 : thin, heavy ? HEAVY : THIN);
  }

  for (const f of l.floats ?? []) {
    if (f.row < r0 || f.row >= r1) continue;
    const y = yOf(f.row) + l.ch * 0.78;
    // A float that goes round the edge is drawn as two lines.
    let from = f.cols[0];
    for (let k = 1; k <= f.cols.length; k++) {
      if (k < f.cols.length && f.cols[k] === f.cols[k - 1] + 1) continue;
      const a = Math.max(from, c0);
      const b = Math.min(f.cols[k - 1] + 1, c1);
      if (b > a) p.line(xOf(a) + l.cw * 0.15, y, xOf(b) - l.cw * 0.15, y, Math.max(thin * 2.5, l.ch * 0.12), FLOAT);
      from = f.cols[k];
    }
  }

  const m = margins(g, l.cw, l.ch);
  for (const s of shapingRounds(g)) {
    if (s.row < r0 || s.row >= r1) continue;
    const y = yOf(s.row) + l.ch;
    p.line(l.x, y, l.x + w, y, thin * 2.6, SHAPING);
    if (l.numbers) p.text(l.x + w + m.font * 2.6, y - l.ch / 2, `${s.to} sts`, m.font * 0.9, SHAPING, "left", true);
  }

  if (!l.numbers) return;
  const f = m.font;
  // Every row numbered where there is room, else every fifth.
  const everyRow = l.ch >= f * 1.05 ? 1 : 5;
  for (let r = r0; r < r1; r++) {
    const n = r + 1;
    if (everyRow > 1 && n !== 1 && n % everyRow) continue;
    const y = yOf(r) + l.ch / 2;
    // Worked flat, a row's number is where it starts: right-side rows at the right.
    if (!g.flat || r % 2 === 0) p.text(l.x + w + f * 0.4, y, String(n), f, NUMBERS, "left");
    else p.text(l.x - f * 0.4, y, String(n), f, NUMBERS, "right");
  }
  const widest = p.measure(String(g.width), f);
  const everyCol = l.cw >= widest + f * 0.3 ? 1 : l.cw * 5 >= widest + f * 0.3 ? 5 : 10;
  for (let c = c0; c < c1; c++) {
    const n = g.width - c;
    if (everyCol > 1 && n !== 1 && n % everyCol) continue;
    p.text(xOf(c) + l.cw / 2, l.y + h + f * 0.95, String(n), f, NUMBERS, "center");
  }
}

/**
 * A colour's symbol, for a chart printed without colour or read by someone
 * who tells colours apart badly. Shapes rather than letters, so a PDF needs
 * no font for them. The background colour has none.
 */
export function drawSymbol(p: Painter, index: number, cx: number, cy: number, size: number, ink: string): void {
  const r = size * 0.28;
  const w = Math.max(0.6, size * 0.09);
  const pts = (n: number, rad: number, turn = 0): [number, number][] =>
    range(n).map((k) => [cx + rad * Math.cos(turn + (2 * Math.PI * k) / n), cy + rad * Math.sin(turn + (2 * Math.PI * k) / n)]);
  switch ((index - 1) % 15) {
    case 0: return p.poly(pts(12, r * 0.55), ink, true);
    case 1: p.line(cx - r, cy - r, cx + r, cy + r, w, ink); return p.line(cx - r, cy + r, cx + r, cy - r, w, ink);
    case 2: return p.line(cx - r, cy + r, cx + r, cy - r, w, ink);
    case 3: return p.poly(pts(16, r * 0.8), ink, false, w);
    case 4: return p.poly(pts(3, r, -Math.PI / 2), ink, true);
    case 5: return p.line(cx - r, cy - r, cx + r, cy + r, w, ink);
    case 6: p.line(cx - r, cy, cx + r, cy, w, ink); return p.line(cx, cy - r, cx, cy + r, w, ink);
    case 7: return p.poly(pts(4, r), ink, true);
    case 8: return p.line(cx - r, cy, cx + r, cy, w, ink);
    case 9: return p.poly(pts(4, r * 1.05, Math.PI / 4), ink, false, w);
    case 10: return p.line(cx, cy - r, cx, cy + r, w, ink);
    case 11: p.line(cx - r, cy - r * 0.4, cx + r, cy - r * 0.4, w, ink); return p.line(cx - r, cy + r * 0.4, cx + r, cy + r * 0.4, w, ink);
    case 12: return p.poly(pts(4, r * 0.8, Math.PI / 4), ink, true);
    case 13: return p.poly(pts(3, r, Math.PI / 2), ink, false, w);
    default: return p.poly(pts(4, r), ink, false, w);
  }
}

/**
 * The legend: each colour's square (with its symbol), name and stitches,
 * flowing across `width`. Returns the height it took.
 */
export function drawLegend(p: Painter, g: Grid, x: number, y: number, width: number, size: number, counts = usage(g)): number {
  const box = size * 1.5;
  const gap = size * 0.6;
  const lineH = box + size * 0.7;
  let cx = x;
  let cy = y;
  g.colours.forEach((c, i) => {
    const label = `${c.name}  ${counts[i] ?? 0} sts`;
    const itemW = box + gap + p.measure(label, size) + size * 2;
    if (cx > x && cx + itemW > x + width) {
      cx = x;
      cy += lineH;
    }
    p.rect(cx, cy, box, box, c.hex);
    p.poly([[cx, cy], [cx + box, cy], [cx + box, cy + box], [cx, cy + box]], HEAVY, false, Math.max(0.5, size / 14));
    if (g.symbols && i) drawSymbol(p, i, cx + box / 2, cy + box / 2, box, inkOn(c.hex));
    p.text(cx + box + gap, cy + box / 2, c.name, size, "#1a1a1a", "left");
    p.text(cx + box + gap + p.measure(`${c.name}  `, size), cy + box / 2, `${counts[i] ?? 0} sts`, size * 0.9, NUMBERS, "left");
    cx += itemW;
  });
  if (g.kind === "yoke" && g.sections.length > 1) {
    cy += lineH;
    p.rect(x, cy, box, box, NO_STITCH);
    p.text(x + box + gap, cy + box / 2, "No stitch", size, "#1a1a1a", "left");
    const sx = x + box + gap + p.measure("No stitch", size) + size * 2;
    p.line(sx, cy + box / 2, sx + box, cy + box / 2, size * 0.2, SHAPING);
    p.text(sx + box + gap, cy + box / 2, "Shaping round: the one just above the line", size, "#1a1a1a", "left");
  }
  return cy + lineH - y;
}

// ---------- on a canvas ----------

export class CanvasPainter implements Painter {
  constructor(private ctx: CanvasRenderingContext2D) {}

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): void {
    const c = this.ctx;
    c.strokeStyle = colour;
    c.lineWidth = width;
    c.lineCap = "butt";
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  poly(points: [number, number][], colour: string, fill: boolean, width = 1): void {
    const c = this.ctx;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    if (fill) {
      c.fillStyle = colour;
      c.fill();
    } else {
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.stroke();
    }
  }

  text(x: number, y: number, text: string, size: number, colour: string, align: "left" | "center" | "right" = "left", bold = false): void {
    const c = this.ctx;
    c.font = font(size, bold);
    c.fillStyle = colour;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(text, x, y);
  }

  measure(text: string, size: number, bold = false): number {
    this.ctx.font = font(size, bold);
    return this.ctx.measureText(text).width;
  }
}

function font(size: number, bold: boolean): string {
  return `${bold ? "600 " : ""}${size}px system-ui, "Segoe UI", sans-serif`;
}

/** Sizes a canvas to `w` × `h` CSS pixels, sharp on a high-density screen, and returns its context drawing in CSS pixels. */
export function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A stitch's width over its height as knitted: stitches are wider than rows are tall. 4:3 without a gauge. */
export function knittedAspect(g: Grid): number {
  return g.gauge.sts > 0 && g.gauge.rows > 0 ? g.gauge.rows / g.gauge.sts : 4 / 3;
}

/** A small picture of the chart, for its card: squares only, the shape as knitted. */
export function drawThumbnail(canvas: HTMLCanvasElement, g: Grid, maxW: number, maxH: number): void {
  const aspect = knittedAspect(g);
  const ch = Math.min(maxH / g.height, maxW / (g.width * aspect));
  const cw = ch * aspect;
  const ctx = sizeCanvas(canvas, Math.max(1, cw * g.width), Math.max(1, ch * g.height));
  drawChart(new CanvasPainter(ctx), g, { x: 0, y: 0, cw, ch, line: cw > 6 ? 0.5 : 0.01 });
}

/**
 * The chart tiled, as an allover pattern knits up: how the repeats meet, at
 * the shape stitches have. Fills the canvas's width.
 */
export function drawTiles(canvas: HTMLCanvasElement, g: Grid, width: number, height: number): void {
  const ctx = sizeCanvas(canvas, width, height);
  const aspect = knittedAspect(g);
  // Big enough to see, small enough for two or three repeats each way.
  const ch = Math.max(1, Math.min(10, width / (g.width * aspect * 2.2), height / (g.height * 1.6)));
  const cw = ch * aspect;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  const across = Math.ceil(width / (cw * g.width)) + 1;
  const up = Math.ceil(height / (ch * g.height)) + 1;
  for (let ty = 0; ty < up; ty++) {
    for (let tx = 0; tx < across; tx++) {
      for (let r = 0; r < g.height; r++) {
        const y = height - (ty * g.height + r + 1) * ch;
        if (y > height || y + ch < 0) continue;
        for (let c = 0; c < g.width; c++) {
          ctx.fillStyle = g.colours[g.cells[r * g.width + c]].hex;
          // A hair over, so no seam shows between squares.
          ctx.fillRect((tx * g.width + c) * cw, y, cw + 0.4, ch + 0.4);
        }
      }
    }
  }
}

/**
 * A round yoke seen from above, the neck in the middle: each round a ring,
 * its stitches spread round it, the repeat as many times as it goes round.
 * Knitted from the hem up the rounds go one way round; from the neck down
 * the chart is upside down to the yoke worn, so they go the other.
 */
export function drawRing(canvas: HTMLCanvasElement, g: Grid, size: number): void {
  const ctx = sizeCanvas(canvas, size, size);
  ctx.clearRect(0, 0, size, size);
  const mask = stitchMask(g);
  const rowH = 1 / knittedAspect(g);
  const neckRow = g.topDown ? 0 : g.height - 1;
  const neck = (g.repeats * stsInRow(g, neckRow)) / (2 * Math.PI);
  const outer = neck + g.height * rowH;
  const scale = (size / 2 - 2) / outer;
  const cx = size / 2;
  const cy = size / 2;
  const dir = g.topDown ? -1 : 1;
  for (let k = 0; k < g.height; k++) {
    const row = g.topDown ? k : g.height - 1 - k;
    const r0 = (neck + k * rowH) * scale;
    const r1 = (neck + (k + 1) * rowH) * scale + 0.4;
    const cols = range(g.width).filter((c) => mask[row * g.width + c]).reverse();
    const total = cols.length * g.repeats;
    const step = (2 * Math.PI) / total;
    let i = 0;
    for (let rep = 0; rep < g.repeats; rep++) {
      let start = 0;
      for (let n = 1; n <= cols.length; n++) {
        const colour = (j: number) => g.cells[row * g.width + cols[j]];
        if (n < cols.length && colour(n) === colour(start)) continue;
        const a = Math.PI / 2 + dir * (i + start) * step;
        const b = Math.PI / 2 + dir * (i + n) * step;
        ctx.fillStyle = g.colours[colour(start)].hex;
        ctx.beginPath();
        ctx.arc(cx, cy, r1, Math.min(a, b), Math.max(a, b) + 0.004);
        ctx.arc(cx, cy, r0, Math.max(a, b) + 0.004, Math.min(a, b), true);
        ctx.closePath();
        ctx.fill();
        start = n;
      }
      i += cols.length;
    }
  }
}

/**
 * The chart as a PNG, to save or put on a board: its name, the chart with
 * numbers, and the legend, on white. `aspect` draws the squares as knitted.
 */
export async function chartPng(name: string, g: Grid, o: { maxSide?: number; asKnitted?: boolean; subtitle?: string } = {}): Promise<Blob> {
  const aspect = o.asKnitted ? knittedAspect(g) : 1;
  const maxSide = o.maxSide ?? 5000;
  const ch = Math.max(4, Math.min(26, Math.floor(maxSide / Math.max(g.height, g.width * aspect))));
  const cw = ch * aspect;
  const m = margins(g, cw, ch);
  const pad = 24;
  const titleSize = 20;
  const legendSize = 13;
  const gridW = cw * g.width;
  const gridH = ch * g.height;
  const width = Math.max(gridW + m.left + m.right + pad * 2, 420);
  const measureCtx = document.createElement("canvas").getContext("2d")!;
  const legendH = drawLegend(new Measurer(new CanvasPainter(measureCtx)), g, pad, 0, width - pad * 2, legendSize);
  const top = pad + titleSize + (o.subtitle ? 22 : 8) + 10;
  const height = top + gridH + m.bottom + 18 + legendH + pad;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d")!;
  const p = new CanvasPainter(ctx);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  p.text(pad, pad + titleSize / 2, name, titleSize, "#1a1a1a", "left", true);
  if (o.subtitle) p.text(pad, pad + titleSize + 12, o.subtitle, 12, NUMBERS, "left");
  const gx = pad + m.left + Math.max(0, (width - pad * 2 - m.left - m.right - gridW) / 2);
  drawChart(p, g, { x: gx, y: top, cw, ch, numbers: true });
  drawLegend(p, g, pad, top + gridH + m.bottom + 18, width - pad * 2, legendSize);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be made."))), "image/png"));
}

/** A painter that only measures: for working out how much room a drawing takes. */
export class Measurer implements Painter {
  constructor(private inner: Painter) {}
  rect(): void {}
  line(): void {}
  poly(): void {}
  text(): void {}
  measure(text: string, size: number, bold?: boolean): number {
    return this.inner.measure(text, size, bold);
  }
}
