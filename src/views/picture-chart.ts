/**
 * A picture made into a colourwork chart: shrunk to a square a stitch, its
 * colours brought down to a few of its own, each square the nearest of them. No DOM, so
 * the harness checks it directly; the dialog is in picture-chart-dialog.ts.
 *
 * Stitches are wider than tall, so a picture `width` stitches wide needs more
 * rows than it has stitches to keep its shape: as many more as the gauge has
 * rows to stitches (4 to 3 when there is no gauge, as most yarn knits).
 * Rows are kept as charts keep them: row 0 is the picture's bottom.
 */
import { MAX_SIDE, newGrid, type Grid } from "./chart";
import { colourName, hexToRgb, kMeans, labDistance, rgbToHex, rgbToLab, type Lab, type Rgb } from "./photo-colours";

/** Narrower than this is not a picture. */
export const MIN_WIDTH = 4;
/** More colours than this is not knitted in colourwork. */
export const MAX_PICTURE_COLOURS = 12;

/** A stitch's width to its height: the gauge's rows to its stitches, else 4 to 3. */
export function stitchAspect(gauge: { sts: number; rows: number }): number {
  return gauge.sts > 0 && gauge.rows > 0 ? gauge.rows / gauge.sts : 4 / 3;
}

/** The rows a picture `pw` × `ph` needs at `width` stitches to keep its shape. */
export function rowsFor(pw: number, ph: number, width: number, aspect: number): number {
  return Math.max(1, Math.round((ph * width * aspect) / pw));
}

/**
 * Each square's colour: the average of the picture's pixels (RGBA, as a
 * canvas gives them, `pw` × `ph`) under it. Row 0 is the picture's bottom.
 */
export function squareColours(pixels: Uint8ClampedArray, pw: number, ph: number, width: number, rows: number): Rgb[] {
  const out: Rgb[] = new Array(width * rows);
  for (let r = 0; r < rows; r++) {
    const fromTop = rows - 1 - r;
    const y0 = Math.floor((fromTop * ph) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((fromTop + 1) * ph) / rows));
    for (let c = 0; c < width; c++) {
      const x0 = Math.floor((c * pw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * pw) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * pw + x) * 4;
          red += pixels[i];
          green += pixels[i + 1];
          blue += pixels[i + 2];
          n++;
        }
      }
      out[r * width + c] = n ? [red / n, green / n, blue / n] : [255, 255, 255];
    }
  }
  return out;
}

export interface PictureOptions {
  /** How many colours, at most. */
  count: number;
  /** Colours to choose from (a stash's yarns), in place of the picture's own. */
  palette?: string[];
  /** A square with no neighbour of its colour (above, below or beside) given the colour most round it. */
  tidy: boolean;
}

export interface PictureColours {
  /** The colours, the most used first: the first is the background. */
  colours: string[];
  /** Each colour's place in the palette given, when one was. */
  from: number[];
  /** Each square's colour, by its place in `colours`. */
  cells: Uint8Array;
  /** How many squares each colour has. */
  counts: number[];
}

/**
 * The squares brought down to `count` colours: the picture's own main colours
 * (k-means in CIELAB, each the square nearest its group's middle), or, from a palette, the one
 * nearest each of those; then each square the colour nearest it, as the eye
 * sees it. No dithering: a knitted picture wants areas, not speckles.
 */
export function pictureColours(squares: Rgb[], width: number, rows: number, o: PictureOptions): PictureColours {
  const labs = squares.map(rgbToLab);
  const count = Math.max(1, Math.min(MAX_PICTURE_COLOURS, Math.round(o.count)));
  const { centres, group } = kMeans(labs, o.palette?.length ? Math.min(count, o.palette.length) : count);
  const sizes = centres.map(() => 0);
  for (const g of group) sizes[g]++;
  let hexes: string[];
  let from: number[] = [];
  if (o.palette?.length) {
    // The biggest group chooses first, so the main colour gets the nearest yarn.
    const palette = o.palette.map((h) => rgbToLab(hexToRgb(h)));
    const order = centres.map((_, c) => c).filter((c) => sizes[c]).sort((a, b) => sizes[b] - sizes[a] || a - b);
    const taken = new Set<number>();
    for (const c of order) {
      let best = -1;
      palette.forEach((p, j) => {
        if (!taken.has(j) && (best < 0 || labDistance(centres[c], p) < labDistance(centres[c], palette[best]))) best = j;
      });
      if (best < 0) break;
      taken.add(best);
      from.push(best);
    }
    hexes = from.map((j) => o.palette![j]);
  } else {
    // Each group's colour is one of its squares, the nearest its middle: a
    // colour in the picture, not a blend of two (white and navy are not lilac).
    const nearest = centres.map(() => -1);
    labs.forEach((lab, i) => {
      const c = group[i];
      if (nearest[c] < 0 || labDistance(lab, centres[c]) < labDistance(labs[nearest[c]], centres[c])) nearest[c] = i;
    });
    hexes = [...new Set(nearest.filter((i) => i >= 0).map((i) => rgbToHex(squares[i])))];
  }
  if (!hexes.length) return { colours: [], from: [], cells: new Uint8Array(width * rows), counts: [] };
  // Each square the nearest colour.
  const targets: Lab[] = hexes.map((h) => rgbToLab(hexToRgb(h)));
  let cells: Uint8Array = new Uint8Array(labs.length);
  labs.forEach((lab, i) => {
    let best = 0;
    let bestDist = labDistance(lab, targets[0]);
    for (let c = 1; c < targets.length; c++) {
      const d = labDistance(lab, targets[c]);
      if (d < bestDist) [best, bestDist] = [c, d];
    }
    cells[i] = best;
  });
  if (o.tidy) cells = tidied(cells, width, rows);
  // Unused ones left out, the most used first.
  const counts = hexes.map(() => 0);
  for (const c of cells) counts[c]++;
  const order = hexes.map((_, i) => i).filter((i) => counts[i]).sort((a, b) => counts[b] - counts[a] || a - b);
  const place = new Uint8Array(hexes.length);
  order.forEach((old, i) => (place[old] = i));
  for (let i = 0; i < cells.length; i++) cells[i] = place[cells[i]];
  return {
    colours: order.map((i) => hexes[i]),
    from: from.length ? order.map((i) => from[i]) : [],
    cells,
    counts: order.map((i) => counts[i]),
  };
}

/**
 * Single squares tidied: one with no neighbour of its colour above, below or
 * beside it takes the colour most of its eight neighbours have (the first
 * found on a tie). Read from the squares as they were, so one pass.
 */
export function tidied(cells: Uint8Array, width: number, rows: number): Uint8Array {
  const out = cells.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const beside: number[] = [];
      if (x > 0) beside.push(i - 1);
      if (x < width - 1) beside.push(i + 1);
      if (y > 0) beside.push(i - width);
      if (y < rows - 1) beside.push(i + width);
      if (!beside.length || beside.some((j) => cells[j] === cells[i])) continue;
      const tally = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if ((dx || dy) && nx >= 0 && nx < width && ny >= 0 && ny < rows) {
            const c = cells[ny * width + nx];
            tally.set(c, (tally.get(c) ?? 0) + 1);
          }
        }
      }
      let best = -1;
      for (const [c, n] of tally) if (best < 0 || n > tally.get(best)!) best = c;
      out[i] = best;
    }
  }
  return out;
}

/** Names for colours, plainly ("dark red"), a second of the same name numbered ("grey 2"). */
export function colourNames(hexes: string[]): string[] {
  const seen = new Map<string, number>();
  return hexes.map((h) => {
    const name = colourName(h);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} ${n}` : name;
  });
}

/** The chart: a standard one, its colours named, at the gauge given. */
export function pictureGrid(p: PictureColours, width: number, rows: number, o: { flat: boolean; gauge: { sts: number; rows: number } }): Grid {
  const g = newGrid({ kind: "standard", width: Math.min(width, MAX_SIDE), height: Math.min(rows, MAX_SIDE), flat: o.flat });
  const names = colourNames(p.colours);
  g.colours = p.colours.map((hex, i) => ({ name: names[i], hex }));
  if (g.cells.length === p.cells.length) g.cells = p.cells.slice();
  g.gauge = { sts: o.gauge.sts, rows: o.gauge.rows };
  return g;
}
