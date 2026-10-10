/**
 * Colourwork charts: the grid, its colours, a round yoke's shaping, and the
 * chart written out row by row. No DOM, so the harness checks it directly.
 *
 * Rows are kept in the order they are knitted: row 0 is the first row or
 * round, drawn at the bottom as charts are. Columns are kept left to right as
 * drawn, so stitch 1 is the last column: a right-side row, and every round,
 * is read from the right.
 *
 * A round yoke (a lopapeysa's) is one repeat, knitted `repeats` times around.
 * Towards the neck each repeat has fewer stitches: its sections say from which
 * round on, and which columns go at each step. A column gone is a square with
 * no stitch, drawn grey, so the motif's columns stay lined up above and below
 * the shaping rounds, as on a printed Lopi chart. Squares keep their colour
 * when the shaping moves off them, so changing it loses nothing drawn.
 */
import type { ChartColour, ChartData, ChartSection } from "../api";

export const MAX_SIDE = 400;
export const MAX_COLOURS = 16;

/** A chart being edited: its squares as colour indices, a byte each. */
export interface Grid extends Omit<ChartData, "cells"> {
  cells: Uint8Array;
}

/** Colours offered in turn as a chart gets more: the undyed sheep's colours first, as in a lopapeysa. */
export const PALETTE: ChartColour[] = [
  { name: "Natural white", hex: "#efe8da" },
  { name: "Black sheep", hex: "#2f2a26" },
  { name: "Light grey", hex: "#b8b4ad" },
  { name: "Dark grey", hex: "#625d58" },
  { name: "Oatmeal", hex: "#c8b597" },
  { name: "Red", hex: "#a8322d" },
  { name: "Blue", hex: "#2f5283" },
  { name: "Mustard", hex: "#c9982c" },
  { name: "Moss", hex: "#6a7a39" },
  { name: "Rose", hex: "#d58c8c" },
  { name: "Sky", hex: "#8db4d6" },
  { name: "Brown", hex: "#7a4f32" },
];

// ---------- making, reading and writing ----------

export function decode(d: ChartData): Grid {
  const cells = new Uint8Array(d.width * d.height);
  for (let i = 0; i < cells.length; i++) cells[i] = parseInt(d.cells[i] ?? "0", 16) || 0;
  return { ...d, colours: d.colours.map((c) => ({ ...c })), sections: d.sections.map((s) => ({ ...s, cols: [...s.cols] })), gauge: { ...d.gauge }, cells };
}

export function encode(g: Grid): ChartData {
  let cells = "";
  for (const c of g.cells) cells += c.toString(16);
  const { cells: _, ...rest } = g;
  return { ...rest, colours: g.colours.map((c) => ({ ...c })), sections: g.sections.map((s) => ({ ...s, cols: [...s.cols] })), gauge: { ...g.gauge }, cells };
}

export function clone(g: Grid): Grid {
  return decode(encode(g));
}

export interface NewChart {
  kind: "standard" | "yoke";
  width: number;
  height: number;
  /** A yoke's repeats around. */
  repeats?: number;
  /** A yoke's usual shaping, three decrease rounds, put in to start from. */
  shaped?: boolean;
  flat?: boolean;
}

/** An empty chart in the background colour, with a second colour to draw in. */
export function newGrid(o: NewChart): Grid {
  const width = clampInt(o.width, 1, MAX_SIDE);
  const height = clampInt(o.height, 1, MAX_SIDE);
  const yoke = o.kind === "yoke";
  const g: Grid = {
    kind: o.kind,
    width,
    height,
    cells: new Uint8Array(width * height),
    colours: PALETTE.slice(0, 2).map((c) => ({ ...c })),
    flat: !yoke && !!o.flat,
    repeats: yoke ? clampInt(o.repeats ?? 18, 1, 300) : 1,
    topDown: false,
    sections: [],
    gauge: { sts: 0, rows: 0 },
    symbols: false,
    floatLimit: 5,
    notes: "",
  };
  if (yoke) g.sections = o.shaped ? suggestShaping(width, height) : [{ row: 0, sts: width, cols: [] }];
  normalize(g);
  return g;
}

/** The next colour to offer: the first of the palette not in the chart yet. */
export function nextColour(g: Grid): ChartColour {
  const used = new Set(g.colours.map((c) => c.hex));
  const free = PALETTE.find((c) => !used.has(c.hex));
  return free ? { ...free } : { name: `Colour ${g.colours.length + 1}`, hex: "#888888" };
}

/** Takes out a colour, its squares going to the background colour; the colours after it move up one. */
export function removeColour(g: Grid, index: number): void {
  if (index <= 0 || index >= g.colours.length) return;
  g.colours.splice(index, 1);
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] === index) g.cells[i] = 0;
    else if (g.cells[i] > index) g.cells[i]--;
  }
}

// ---------- a yoke's shaping ----------

/**
 * A round yoke's usual shaping, bottom-up: three decrease rounds taking the
 * repeat to about two fifths of its width at the neck, each a little bigger
 * than the one before, placed as in Elizabeth Zimmermann's percentage system:
 * the first halfway up, the last near the neck.
 */
export function suggestShaping(width: number, height: number, steps = 3, neck = 0.42): ChartSection[] {
  const sections: ChartSection[] = [{ row: 0, sts: width, cols: [] }];
  const ratio = neck ** (1 / steps);
  let last = width;
  for (let s = 1; s <= steps; s++) {
    const sts = Math.max(1, Math.min(last - 1, Math.round(width * ratio ** s)));
    const row = Math.round(height * (steps === 1 ? 0.5 : 0.5 + (0.4 * (s - 1)) / (steps - 1)));
    if (sts < 1 || sts >= last || row <= sections[sections.length - 1].row || row >= height) continue;
    sections.push({ row, sts, cols: [] });
    last = sts;
  }
  return sections;
}

/** Gives a yoke the usual shaping, whichever way it is knitted, in place of what it had. */
export function usualShaping(g: Grid): void {
  const s = suggestShaping(g.width, g.height);
  if (g.topDown) {
    // The same rounds counted from the other end: the neck's section first.
    const ends = s.map((_, i) => (i + 1 < s.length ? s[i + 1].row : g.height));
    g.sections = s.map((x, i) => ({ row: g.height - ends[i], sts: x.sts, cols: [] })).reverse();
  } else {
    g.sections = s;
  }
  normalize(g);
}

/**
 * Which of `present` columns go when `drop` of them do: spread evenly, and
 * placed alike in every part, so a symmetrical motif stays symmetrical.
 */
export function spreadColumns(present: number[], drop: number): number[] {
  const p = present.length;
  if (drop <= 0) return [];
  if (drop >= p) return [...present];
  const out: number[] = [];
  for (let k = 0; k < drop; k++) out.push(present[Math.floor(((k + 0.5) * p) / drop)]);
  return out;
}

/** The sections from the widest to the narrowest: bottom-up in the order knitted, top-down the other way. */
function widestFirst(g: Grid): ChartSection[] {
  return g.topDown ? [...g.sections].reverse() : [...g.sections];
}

/**
 * Makes a yoke's sections add up after any change: in order from the first
 * round, the repeat the whole chart at its widest and smaller towards the
 * neck, and each step's columns ones there were, else spread anew. A
 * standard chart has none.
 */
export function normalize(g: Grid): void {
  if (g.kind !== "yoke") {
    g.sections = [];
    g.repeats = 1;
    g.topDown = false;
    return;
  }
  g.flat = false;
  // In order, one per round, within the chart, starting at the first.
  const byRow = new Map<number, ChartSection>();
  for (const s of g.sections) {
    const row = Math.round(s.row);
    if (row >= 0 && row < g.height) byRow.set(row, { row, sts: Math.round(s.sts), cols: s.cols.map(Math.round) });
  }
  let sections = [...byRow.values()].sort((a, b) => a.row - b.row);
  if (!sections.length || sections[0].row !== 0) sections.unshift({ row: 0, sts: g.topDown ? 1 : g.width, cols: [] });
  // From the widest: the whole chart, then each smaller than the last.
  const ordered = g.topDown ? sections.reverse() : sections;
  ordered[0].sts = g.width;
  ordered[0].cols = [];
  const kept: ChartSection[] = [ordered[0]];
  let present = range(g.width);
  for (const s of ordered.slice(1)) {
    const wider = kept[kept.length - 1];
    if (s.sts < 1 || s.sts >= wider.sts) continue;
    const drop = wider.sts - s.sts;
    const cols = [...new Set(s.cols)];
    const fits = cols.length === drop && cols.every((c) => present.includes(c));
    s.cols = fits ? cols.sort((a, b) => a - b) : spreadColumns(present, drop);
    present = present.filter((c) => !s.cols.includes(c));
    kept.push(s);
  }
  if (g.topDown) kept.reverse();
  // Top-down the first section is the narrowest, and a first round dropped as
  // out of order would leave the chart starting part-way up: start it at 0.
  kept[0].row = 0;
  g.sections = kept;
}

/** The index of the section a row is in. */
export function sectionIndex(g: Grid, row: number): number {
  let at = 0;
  g.sections.forEach((s, i) => {
    if (s.row <= row) at = i;
  });
  return at;
}

/** Stitches in each repeat of a row: the chart's width, or less where a yoke narrows. */
export function stsInRow(g: Grid, row: number): number {
  return g.kind === "yoke" && g.sections.length ? g.sections[sectionIndex(g, row)].sts : g.width;
}

/** Stitches in a whole row or round. */
export function totalInRow(g: Grid, row: number): number {
  return stsInRow(g, row) * (g.kind === "yoke" ? g.repeats : 1);
}

/** Which squares are stitches (1) and which are none (0), for every square. */
export function stitchMask(g: Grid): Uint8Array {
  const mask = new Uint8Array(g.width * g.height).fill(1);
  if (g.kind !== "yoke" || g.sections.length < 2) return mask;
  // The columns each section lacks: its own and those of every wider one.
  const gone = new Map<ChartSection, Set<number>>();
  const lacking = new Set<number>();
  for (const s of widestFirst(g)) {
    for (const c of s.cols) lacking.add(c);
    gone.set(s, new Set(lacking));
  }
  g.sections.forEach((s, i) => {
    const end = i + 1 < g.sections.length ? g.sections[i + 1].row : g.height;
    const cols = gone.get(s)!;
    for (let y = s.row; y < end; y++) for (const c of cols) mask[y * g.width + c] = 0;
  });
  return mask;
}

/** Shaping rounds: the first round of each section after the first, and whether it decreases. */
export function shapingRounds(g: Grid): { row: number; from: number; to: number }[] {
  if (g.kind !== "yoke") return [];
  return g.sections.slice(1).map((s, i) => ({ row: s.row, from: g.sections[i].sts, to: s.sts }));
}

// ---------- editing ----------

/** The squares of a straight line, end to end. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The squares of a rectangle between two corners: its outline, or all of it. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const out: [number, number][] = [];
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [b, t] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = b; y <= t; y++) for (let x = l; x <= r; x++) if (filled || y === b || y === t || x === l || x === r) out.push([x, y]);
  return out;
}

/** The squares joined to one, in its colour, a stitch to a stitch: what a fill paints. */
export function fillArea(g: Grid, mask: Uint8Array, x: number, y: number): number[] {
  const start = y * g.width + x;
  if (!mask[start]) return [];
  const colour = g.cells[start];
  const seen = new Uint8Array(g.cells.length);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const cx = i % g.width;
    const near = [cx > 0 ? i - 1 : -1, cx < g.width - 1 ? i + 1 : -1, i - g.width, i + g.width];
    for (const n of near) {
      if (n < 0 || n >= g.cells.length || seen[n] || !mask[n] || g.cells[n] !== colour) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return out;
}

/** The square mirrored across the middle of the chart, for drawing both halves of a motif at once. */
export function mirrorX(g: Grid, x: number): number {
  return g.width - 1 - x;
}

export interface Resize {
  width: number;
  height: number;
  /** Columns are added or taken at the left; else at the right. */
  atLeft: boolean;
  /** Rows are added or taken at the bottom (before the first row); else at the top. */
  atBottom: boolean;
}

/** The chart at another size; new squares in the background colour. A yoke's shaping moves with its rows and columns. */
export function resized(g: Grid, r: Resize): Grid {
  const width = clampInt(r.width, 1, MAX_SIDE);
  const height = clampInt(r.height, 1, MAX_SIDE);
  const dx = r.atLeft ? width - g.width : 0;
  const dy = r.atBottom ? height - g.height : 0;
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ox = x - dx;
      const oy = y - dy;
      if (ox >= 0 && ox < g.width && oy >= 0 && oy < g.height) cells[y * width + x] = g.cells[oy * g.width + ox];
    }
  }
  const out: Grid = { ...clone(g), width, height, cells };
  out.sections = g.sections.map((s) => ({ row: s.row === 0 ? 0 : Math.max(1, s.row + dy), sts: s.sts, cols: s.cols.map((c) => c + dx) }));
  normalize(out);
  return out;
}

/** Moves the picture by whole squares, what leaves one side coming back at the other: lines a repeat up. */
export function shifted(g: Grid, dx: number, dy: number): void {
  const old = g.cells.slice();
  const w = g.width;
  const h = g.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g.cells[(((y + dy) % h) + h) % h * w + ((((x + dx) % w) + w) % w)] = old[y * w + x];
  }
}

/** Mirrors the picture left to right, or top to bottom. The shaping stays where it is. */
export function flipped(g: Grid, across: "x" | "y"): void {
  const old = g.cells.slice();
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const [sx, sy] = across === "x" ? [g.width - 1 - x, y] : [x, g.height - 1 - y];
      g.cells[y * g.width + x] = old[sy * g.width + sx];
    }
  }
}

/**
 * Turns a yoke from bottom-up to top-down or back, keeping the yoke as it
 * looks worn: the chart turns upside down (a top-down chart is read from the
 * neck), and its shaping with it.
 */
export function turnedRound(g: Grid): void {
  const w = g.width;
  const h = g.height;
  const old = g.cells.slice();
  for (let i = 0; i < old.length; i++) g.cells[old.length - 1 - i] = old[i];
  const ends = g.sections.map((_, i) => (i + 1 < g.sections.length ? g.sections[i + 1].row : h));
  g.sections = g.sections
    .map((s, i) => ({ row: h - ends[i], sts: s.sts, cols: s.cols.map((c) => w - 1 - c).sort((a, b) => a - b) }))
    .reverse();
  g.topDown = !g.topDown;
  normalize(g);
}

// ---------- a block of squares: selected, copied, pasted ----------

/** Squares from column `x0` to `x1` and row `y0` to `y1`, both ends in, rows counted from the first knitted. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Squares copied out of a chart: their colours, kept with them so they paste
 * into another chart as the same colours. A square with no stitch (a yoke's
 * grey) is -1, and pastes as nothing.
 */
export interface Block {
  width: number;
  height: number;
  /** Row by row from the bottom, as a chart's squares are. */
  cells: Int16Array;
  colours: ChartColour[];
}

/** The box between two squares, whichever corners they are, kept within the chart. */
export function rectBetween(g: Grid, a: [number, number], b: [number, number]): Rect {
  const clampX = (v: number) => Math.max(0, Math.min(g.width - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(g.height - 1, v));
  return {
    x0: clampX(Math.min(a[0], b[0])),
    x1: clampX(Math.max(a[0], b[0])),
    y0: clampY(Math.min(a[1], b[1])),
    y1: clampY(Math.max(a[1], b[1])),
  };
}

/** The squares in a box, as a block to paste. */
export function copyBlock(g: Grid, mask: Uint8Array, r: Rect): Block {
  const width = r.x1 - r.x0 + 1;
  const height = r.y1 - r.y0 + 1;
  const cells = new Int16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (r.y0 + y) * g.width + r.x0 + x;
      cells[y * width + x] = mask[i] ? g.cells[i] : -1;
    }
  }
  return { width, height, cells, colours: g.colours.map((c) => ({ ...c })) };
}

/** Fills a box with the background colour, stitches only; returns the squares changed. */
export function clearRect(g: Grid, mask: Uint8Array, r: Rect): number[] {
  const changed: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * g.width + x;
      if (mask[i] && g.cells[i] !== 0) {
        g.cells[i] = 0;
        changed.push(i);
      }
    }
  }
  return changed;
}

/** A block mirrored left to right, or top to bottom: the other half of a motif. */
export function flippedBlock(b: Block, across: "x" | "y"): Block {
  const cells = new Int16Array(b.cells.length);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const [sx, sy] = across === "x" ? [b.width - 1 - x, y] : [x, b.height - 1 - y];
      cells[y * b.width + x] = b.cells[sy * b.width + sx];
    }
  }
  return { ...b, cells };
}

/**
 * Which of the chart's colours each of a block's is: the same colour if the
 * chart has it, else added (as the chart can take more), else the nearest it
 * has. Adds what it needs to the chart.
 */
export function blockColours(g: Grid, b: Block): number[] {
  const used = new Set<number>();
  for (const c of b.cells) if (c >= 0) used.add(c);
  return b.colours.map((colour, i) => {
    if (!used.has(i)) return 0;
    const same = g.colours.findIndex((c) => c.hex.toLowerCase() === colour.hex.toLowerCase());
    if (same >= 0) return same;
    if (g.colours.length < MAX_COLOURS) {
      g.colours.push({ ...colour });
      return g.colours.length - 1;
    }
    return nearestColour(g, colour.hex);
  });
}

function nearestColour(g: Grid, hex: string): number {
  const rgb = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r, gr, b] = rgb(hex);
  let best = 0;
  let bestD = Infinity;
  g.colours.forEach((c, i) => {
    const [r2, g2, b2] = rgb(c.hex);
    const d = (r - r2) ** 2 + (gr - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Pastes a block with its top-left square at column `left`, row `top` (the
 * highest row it covers): stitches only, nothing off the chart, nothing where
 * the block had no stitch. Returns the squares changed.
 */
export function pasteBlock(g: Grid, mask: Uint8Array, b: Block, left: number, top: number): number[] {
  const map = blockColours(g, b);
  const bottom = top - b.height + 1;
  const changed: number[] = [];
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const c = b.cells[y * b.width + x];
      const gx = left + x;
      const gy = bottom + y;
      if (c < 0 || gx < 0 || gx >= g.width || gy < 0 || gy >= g.height) continue;
      const i = gy * g.width + gx;
      if (!mask[i] || g.cells[i] === map[c]) continue;
      g.cells[i] = map[c];
      changed.push(i);
    }
  }
  return changed;
}

// ---------- reading it ----------

/** Stitches in each colour, all the way round for a yoke. */
export function usage(g: Grid, mask = stitchMask(g)): number[] {
  const n = new Array(g.colours.length).fill(0);
  for (let i = 0; i < g.cells.length; i++) if (mask[i]) n[g.cells[i]]++;
  const times = g.kind === "yoke" ? g.repeats : 1;
  return n.map((v) => v * times);
}

/** A run of one colour long enough that the others float behind it for too long. */
export interface Float {
  row: number;
  /** Its squares' columns, in order along the row. */
  cols: number[];
}

/**
 * The floats longer than `limit` stitches: on a row of two colours or more,
 * a run of one colour is how far the others are carried behind. In the
 * round (and a yoke's repeats) the row joins up, so a run can go round from
 * the left edge to the right.
 */
export function longFloats(g: Grid, limit = g.floatLimit, mask = stitchMask(g)): Float[] {
  if (limit <= 0) return [];
  const out: Float[] = [];
  const round = g.kind === "yoke" || !g.flat;
  for (let y = 0; y < g.height; y++) {
    const cols: number[] = [];
    for (let x = 0; x < g.width; x++) if (mask[y * g.width + x]) cols.push(x);
    const colour = (c: number) => g.cells[y * g.width + c];
    if (new Set(cols.map(colour)).size < 2) continue;
    // Runs, left to right; in the round, the last joins the first if they match.
    const runs: number[][] = [];
    for (const c of cols) {
      const last = runs[runs.length - 1];
      if (last && colour(last[0]) === colour(c)) last.push(c);
      else runs.push([c]);
    }
    if (round && runs.length > 1 && colour(runs[0][0]) === colour(runs[runs.length - 1][0])) {
      const first = runs.shift()!;
      runs[runs.length - 1].push(...first);
    }
    for (const run of runs) if (run.length > limit) out.push({ row: y, cols: run });
  }
  return out;
}

/** What a chart is, in a line: "Round yoke, 12 sts × 40 rounds, 18 repeats, knitted from the hem up". */
export function describe(g: Grid): string {
  if (g.kind === "yoke") {
    return `Round yoke: a ${g.width}-stitch repeat, ${g.repeats} times around, ${g.height} rounds, knitted ${g.topDown ? "from the neck down" : "from the hem up"}`;
  }
  return `${g.width} stitches × ${g.height} ${g.flat ? "rows, worked flat" : "rounds, in the round"}`;
}

/** One line of the chart in words: one row, or several alike. */
export interface WrittenRow {
  /** First and last row, counted from 1. */
  from: number;
  to: number;
  label: string;
  text: string;
}

/**
 * The chart written out, row by row, as a knitter reads it: a right-side row
 * and every round from the right, a wrong-side row from the left, and a
 * colour's stitches counted ("k3 Natural white, k1 Black sheep"). A yoke's
 * round is its repeat between stars, as many times as it goes round; on a
 * shaping round the decreases are k2tog (k3tog for two squares gone at once)
 * worked into the stitch beside the grey square, and the increases are made
 * (M1) where a square begins. Rows alike one after another are written once.
 */
export function writeOut(g: Grid): WrittenRow[] {
  const mask = stitchMask(g);
  const yoke = g.kind === "yoke";
  const lines: WrittenRow[] = [];
  const shaping = new Map(shapingRounds(g).map((s) => [s.row, s]));
  for (let y = 0; y < g.height; y++) {
    const rs = !g.flat || y % 2 === 0;
    const op = rs ? "k" : "p";
    const here = (x: number) => !!mask[y * g.width + x];
    const before = (x: number) => (y > 0 ? !!mask[(y - 1) * g.width + x] : here(x));
    // Each gone column is knitted together with the stitch beside it: the one
    // to its right if there is one, which comes before it reading from the
    // right, else the one to its left.
    const together = new Map<number, number>();
    const made = new Set<number>();
    for (let x = 0; x < g.width; x++) {
      if (before(x) && !here(x)) {
        let partner = -1;
        for (let r = x + 1; r < g.width && partner < 0; r++) if (here(r)) partner = r;
        for (let l = x - 1; l >= 0 && partner < 0; l--) if (here(l)) partner = l;
        if (partner >= 0) together.set(partner, (together.get(partner) ?? 1) + 1);
      }
      if (!before(x) && here(x)) made.add(x);
    }
    const order = [...range(g.width)].filter(here);
    if (rs) order.reverse();
    const parts: string[] = [];
    let run: { colour: number; n: number } | null = null;
    const flush = () => {
      if (run) parts.push(`${op}${run.n} ${g.colours[run.colour].name}`);
      run = null;
    };
    for (const x of order) {
      const colour = g.cells[y * g.width + x];
      const name = g.colours[colour].name;
      if (made.has(x)) {
        flush();
        parts.push(`M1 ${name}`);
      } else if (together.has(x)) {
        flush();
        parts.push(`${op}${together.get(x)}tog ${name}`);
      } else if (run && run.colour === colour) {
        run.n++;
      } else {
        flush();
        run = { colour, n: 1 };
      }
    }
    flush();
    const colours = new Set(order.map((x) => g.cells[y * g.width + x]));
    const plain = !made.size && !together.size;
    let text =
      plain && colours.size === 1
        ? `${rs ? "knit" : "purl"} all in ${g.colours[[...colours][0]].name}`
        : yoke && g.repeats > 1
          ? `*${parts.join(", ")}* ${g.repeats} times`
          : parts.join(", ");
    text = `${text}.`;
    const shape = shaping.get(y);
    const total = totalInRow(g, y);
    const label = (from: number, to: number) => {
      const many = from !== to;
      const word = g.flat ? (many ? "Rows" : "Row") : many ? "Rounds" : "Round";
      const which = many ? `${word} ${from}–${to}` : `${word} ${from}`;
      if (shape) {
        const from = shape.from * g.repeats;
        return `${which}, ${shape.to < shape.from ? "decrease" : "increase"} round (${from} → ${total} sts)`;
      }
      if (g.flat) return `${which} (${rs ? "RS" : "WS"})`;
      return yoke ? `${which} (${total} sts)` : which;
    };
    const last = lines[lines.length - 1];
    // Alike rows run together: not across a shaping round, nor flat (where
    // the side changes every row).
    if (last && last.text === text && !shape && !g.flat && last.label.indexOf("round (") < 0) {
      last.to = y + 1;
      last.label = label(last.from, last.to);
    } else {
      lines.push({ from: y + 1, to: y + 1, label: label(y + 1, y + 1), text });
    }
  }
  return lines;
}

/** Where the next row to knit is in a chart: not reached yet, knitted (a yoke's), or a row of it, in a repeat. */
export type ChartPlace = { kind: "before"; rowsToGo: number } | { kind: "done" } | { kind: "row"; row: number; repeat: number };

/**
 * Where the next row to knit is, with `done` of the project's rows knitted
 * and the chart's first row knitted on the project's row `start` (from 1).
 * A standard chart repeats up the work; a yoke's is knitted once.
 */
export function chartPlace(g: Grid, done: number, start: number): ChartPlace {
  const next = Math.max(0, done) + 1 - Math.max(1, start);
  if (next < 0) return { kind: "before", rowsToGo: -next };
  if (g.kind === "yoke" && next >= g.height) return { kind: "done" };
  return { kind: "row", row: (next % g.height) + 1, repeat: Math.floor(next / g.height) + 1 };
}

/** One row of the chart in words (rows from 1), from its written-out lines. */
export function rowInWords(g: Grid, row: number, lines = writeOut(g)): WrittenRow | undefined {
  return lines.find((l) => l.from <= row && row <= l.to);
}

/** How the chart is read, for the top of the words. */
export function readingNote(g: Grid): string {
  if (g.kind === "yoke") {
    return `Knitted in the round ${g.topDown ? "from the neck down" : "from the hem up"}, every round read from the right. The ${g.width}-stitch repeat goes ${g.repeats} times around; a grey square is no stitch.`;
  }
  return g.flat
    ? "Worked flat: right-side rows (odd numbers) are knitted and read from the right, wrong-side rows (even numbers) purled and read from the left."
    : "Worked in the round: every round is knitted and read from the right.";
}

/** A colour as the legend names it: with its yarn, when one is chosen. */
export function colourLabel(c: ChartColour): string {
  return c.yarn ? `${c.name} (${c.yarn})` : c.name;
}

/** The chart in words, as one text: a heading, how to read it, the colours, the rows. */
export function writtenText(name: string, g: Grid): string {
  const counts = usage(g);
  return [
    name,
    describe(g),
    readingNote(g),
    `Colours: ${g.colours.map((c, i) => `${colourLabel(c)}: ${counts[i]} sts`).join("; ")}.`,
    "",
    ...writeOut(g).map((r) => `${r.label}: ${r.text}`),
    ...(g.notes.trim() ? ["", g.notes.trim()] : []),
  ].join("\n");
}

/** How big it comes out at the chart's gauge, in cm; null without one. */
export function knittedSize(g: Grid): { width: number; height: number; widest: number; neck: number } | null {
  if (!(g.gauge.sts > 0) || !(g.gauge.rows > 0)) return null;
  const spc = g.gauge.sts / 10;
  const counts = g.kind === "yoke" ? g.sections.map((s) => s.sts * g.repeats) : [g.width];
  return { width: g.width / spc, height: g.height / (g.gauge.rows / 10), widest: Math.max(...counts) / spc, neck: Math.min(...counts) / spc };
}

// ---------- small helpers ----------

export function range(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i);
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
}

/** Black or white, whichever reads on a colour. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a1a1a" : "#ffffff";
}
